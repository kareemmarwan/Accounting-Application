import { buildManualDebtEntry, type ReversalResult } from "@/core/accounting/engine";
import { toMinor, type Minor } from "@/core/accounting/money";
import { getDB, type LocalDebt, type LocalJournalEntry, type LocalJournalEntryLine, type LocalParty, type MusaedDB, type SyncStatus } from "@/core/db/db";
import {
  enqueueOp,
  makeSyncFields,
  newId,
  nowIso,
  tempDocNumber
} from "@/core/db/repositories";
import {
  contactFormSchema,
  manualDebtSchema,
  type ContactFormInput,
  type ContactType,
  type ManualDebtInput
} from "@/core/validation/contact";

export class ContactNotFoundError extends Error {
  constructor() {
    super("الجهة غير موجودة أو تم حذفها");
    this.name = "ContactNotFoundError";
  }
}

export class ContactHasBalanceError extends Error {
  constructor(balance: Minor) {
    super(
      `لا يمكن حذف جهة برصيد غير صفري — الرصيد الحالي: ${balance / 100}. سدّد الدين أو صفّر الرصيد أولاً`
    );
    this.name = "ContactHasBalanceError";
  }
}

export interface ContactContext {
  businessId: string;
}

function partyTable(db: MusaedDB, type: ContactType) {
  return type === "customer" ? db.customers : db.suppliers;
}

function firstIssue(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return fallback;
}

export async function createContact(
  input: ContactFormInput,
  type: ContactType,
  ctx: ContactContext,
  db: MusaedDB = getDB()
): Promise<LocalParty> {
  const parsed = contactFormSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "بيانات الجهة غير صالحة");
  }

  const createdAt = nowIso();
  const party: LocalParty = {
    id: newId(),
    name: parsed.data.name,
    phone: parsed.data.phone,
    whatsapp: parsed.data.whatsapp,
    address: parsed.data.address,
    notes: parsed.data.notes,
    currentBalanceMinor: 0,
    totalTransactionsMinor: 0,
    lastTransactionAt: null,
    ...makeSyncFields({ businessId: ctx.businessId })
  };

  await db.transaction(
    "rw",
    [partyTable(db, type), db.outbox],
    async () => {
      await partyTable(db, type).put(party);
      await enqueueOp({
        db,
        businessId: ctx.businessId,
        opType: "entity.upsert",
        entityType: type === "customer" ? "customers" : "suppliers",
        entityId: party.id,
        payload: {
          clientOpId: party.id,
          createdAt,
          entityType: type === "customer" ? "customers" : "suppliers",
          row: {
            id: party.id,
            name: party.name,
            phone: party.phone,
            whatsapp: party.whatsapp,
            address: party.address,
            notes: party.notes,
            current_balance: "0",
            total_transactions: "0",
            last_transaction_at: null
          }
        }
      });
    }
  );

  return party;
}

export async function updateContact(
  partyId: string,
  input: ContactFormInput,
  type: ContactType,
  db: MusaedDB = getDB()
): Promise<LocalParty> {
  const table = partyTable(db, type);
  const existing = await table.get(partyId);
  if (!existing || existing.deletedAt) {
    throw new ContactNotFoundError();
  }

  const parsed = contactFormSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "بيانات الجهة غير صالحة");
  }

  const updatedAt = nowIso();
  const updated: LocalParty = {
    ...existing,
    name: parsed.data.name,
    phone: parsed.data.phone,
    whatsapp: parsed.data.whatsapp,
    address: parsed.data.address,
    notes: parsed.data.notes,
    updatedAt,
    version: existing.version + 1
  };

  await db.transaction(
    "rw",
    [table, db.outbox],
    async () => {
      await table.put(updated);
      await enqueueOp({
        db,
        businessId: existing.businessId,
        opType: "entity.upsert",
        entityType: type === "customer" ? "customers" : "suppliers",
        entityId: updated.id,
        payload: {
          clientOpId: newId(),
          createdAt: updatedAt,
          entityType: type === "customer" ? "customers" : "suppliers",
          row: {
            id: updated.id,
            name: updated.name,
            phone: updated.phone,
            whatsapp: updated.whatsapp,
            address: updated.address,
            notes: updated.notes
          },
          expectedVersion: existing.version
        }
      });
    }
  );

  return updated;
}

export async function softDeleteContact(
  partyId: string,
  type: ContactType,
  db: MusaedDB = getDB()
): Promise<void> {
  const table = partyTable(db, type);
  const existing = await table.get(partyId);
  if (!existing || existing.deletedAt) {
    throw new ContactNotFoundError();
  }
  if (existing.currentBalanceMinor !== 0) {
    throw new ContactHasBalanceError(existing.currentBalanceMinor);
  }

  const updatedAt = nowIso();
  await db.transaction(
    "rw",
    [table, db.outbox],
    async () => {
      await table.put({
        ...existing,
        deletedAt: updatedAt,
        updatedAt,
        version: existing.version + 1,
        syncStatus: "pending" as SyncStatus
      });
      await enqueueOp({
        db,
        businessId: existing.businessId,
        opType: "entity.soft_delete",
        entityType: type === "customer" ? "customers" : "suppliers",
        entityId: partyId,
        payload: {
          clientOpId: newId(),
          createdAt: updatedAt,
          entityType: type === "customer" ? "customers" : "suppliers",
          entityId: partyId
        }
      });
    }
  );
}

export async function createManualDebt(
  input: ManualDebtInput,
  type: ContactType,
  ctx: ContactContext,
  db: MusaedDB = getDB()
): Promise<{ debt: LocalDebt; entry: LocalJournalEntry; entryLines: LocalJournalEntryLine[] }> {
  const parsed = manualDebtSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(firstIssue(parsed.error.issues[0], "بيانات الدين غير صالحة"));
  }
  const data = parsed.data;

  const table = partyTable(db, type);
  const party = await table.get(data.partyId);
  if (!party || party.deletedAt) {
    throw new ContactNotFoundError();
  }

  const amount = toMinor(data.amount);
  const occurredAt = new Date(data.occurredAt).toISOString();

  let engineResult: ReversalResult;
  try {
    engineResult = buildManualDebtEntry({
      debtId: data.partyId,
      direction: type === "customer" ? "receivable" : "payable",
      partyId: data.partyId,
      occurredAt,
      amount
    });
  } catch (error) {
    throw new Error(firstIssue(error, "تعذر تسجيل الدين اليدوي"));
  }

  const debtId = newId();
  const createdAt = nowIso();
  const direction = type === "customer" ? "receivable" : "payable";

  const debt: LocalDebt = {
    id: debtId,
    direction,
    partyId: data.partyId,
    sourceType: "manual",
    sourceId: null,
    amountMinor: amount,
    paidAmountMinor: 0,
    remainingAmountMinor: amount,
    dueDate: null,
    status: "open",
    notes: data.notes,
    createdAt,
    ...makeSyncFields({ businessId: ctx.businessId })
  };

  const entryId = newId();
  const entry: LocalJournalEntry = {
    id: entryId,
    entryNumber: tempDocNumber(),
    occurredAt,
    description: data.notes || (type === "customer" ? "دين يدوي — عميل" : "دين يدوي — مورد"),
    sourceType: "opening",
    sourceId: debtId,
    status: "posted",
    reversalOfEntryId: null,
    ...makeSyncFields({ businessId: ctx.businessId })
  };

  const entryLines: LocalJournalEntryLine[] = engineResult.entry.lines.map((line) => ({
    id: newId(),
    businessId: ctx.businessId,
    entryId,
    glCode: line.glCode,
    debitMinor: line.debit,
    creditMinor: line.credit,
    financialAccountId: line.financialAccountId ?? null,
    partyType: line.partyType ?? null,
    partyId: line.partyId ?? null
  }));

  await db.transaction(
    "rw",
    [db.debts, table, db.journalEntries, db.journalEntryLines, db.outbox],
    async () => {
      await db.debts.put(debt);
      await table.put({
        ...party,
        currentBalanceMinor: party.currentBalanceMinor + amount,
        lastTransactionAt: occurredAt,
        updatedAt: createdAt,
        version: party.version + 1
      });
      await db.journalEntries.put(entry);
      await db.journalEntryLines.bulkPut(entryLines);
      await enqueueOp({
        db,
        businessId: ctx.businessId,
        opType: "manual_debt.create",
        entityType: "debts",
        entityId: debtId,
        payload: {
          clientOpId: debtId,
          createdAt,
          debt: {
            id: debtId,
            direction,
            partyId: data.partyId,
            occurredAt,
            amountMinor: amount,
            notes: data.notes
          }
        }
      });
    }
  );

  return { debt, entry, entryLines };
}

export interface LedgerRow {
  kind: "sale" | "purchase" | "manual_debt" | "payment";
  occurredAt: string;
  label: string;
  ref: string;
  deltaMinor: number;
  balanceAfterMinor: number;
}

export interface ContactLedger {
  direction: "receivable" | "payable";
  openingBalanceMinor: number;
  currentBalanceMinor: number;
  totalTransactionsMinor: number;
  rows: LedgerRow[];
}

const SALE_SOURCE_LABEL = "بيع آجل";
const PURCHASE_SOURCE_LABEL = "شراء آجل";

export async function buildContactLedger(
  partyId: string,
  type: ContactType,
  db: MusaedDB = getDB()
): Promise<ContactLedger> {
  const table = partyTable(db, type);
  const party = await table.get(partyId);
  if (!party) {
    throw new ContactNotFoundError();
  }

  const direction: "receivable" | "payable" = type === "customer" ? "receivable" : "payable";
  const rows: LedgerRow[] = [];

  const debts = await db.debts
    .where("partyId")
    .equals(partyId)
    .filter((debt) => debt.direction === direction && !debt.deletedAt)
    .toArray();

  for (const debt of debts) {
    if (debt.sourceType === "manual") {
      rows.push({
        kind: "manual_debt",
        occurredAt: debt.createdAt,
        label: "دين يدوي",
        ref: debt.id.slice(0, 8),
        deltaMinor: debt.amountMinor,
        balanceAfterMinor: 0
      });
    }
  }

  if (type === "customer") {
    const sales = await db.sales
      .where("customerId")
      .equals(partyId)
      .filter((sale) => !sale.deletedAt && sale.status !== "void")
      .toArray();
    for (const sale of sales) {
      if (sale.remainingAmountMinor > 0) {
        rows.push({
          kind: "sale",
          occurredAt: sale.occurredAt,
          label: `${SALE_SOURCE_LABEL} — ${sale.saleNumber}`,
          ref: sale.id.slice(0, 8),
          deltaMinor: sale.remainingAmountMinor,
          balanceAfterMinor: 0
        });
      }
    }
  } else {
    const purchases = await db.purchases
      .where("supplierId")
      .equals(partyId)
      .filter((purchase) => !purchase.deletedAt && purchase.status !== "void")
      .toArray();
    for (const purchase of purchases) {
      if (purchase.remainingAmountMinor > 0) {
        rows.push({
          kind: "purchase",
          occurredAt: purchase.occurredAt,
          label: `${PURCHASE_SOURCE_LABEL} — ${purchase.purchaseNumber}`,
          ref: purchase.id.slice(0, 8),
          deltaMinor: purchase.remainingAmountMinor,
          balanceAfterMinor: 0
        });
      }
    }
  }

  const debtIds = new Set(debts.map((debt) => debt.id));
  const payments = await db.debtPayments
    .filter((payment) => debtIds.has(payment.debtId) && !payment.deletedAt)
    .toArray();
  for (const payment of payments) {
    rows.push({
      kind: "payment",
      occurredAt: payment.occurredAt,
      label: type === "customer" ? "دفعة مستلمة" : "دفعة مسددة",
      ref: payment.id.slice(0, 8),
      deltaMinor: -payment.amountMinor,
      balanceAfterMinor: 0
    });
  }

  rows.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));

  const totalDelta = rows.reduce((sum, row) => sum + row.deltaMinor, 0);
  let running = party.currentBalanceMinor - totalDelta;
  const openingBalanceMinor = running;
  for (const row of rows) {
    running += row.deltaMinor;
    row.balanceAfterMinor = running;
  }

  return {
    direction,
    openingBalanceMinor,
    currentBalanceMinor: party.currentBalanceMinor,
    totalTransactionsMinor: party.totalTransactionsMinor,
    rows
  };
}
