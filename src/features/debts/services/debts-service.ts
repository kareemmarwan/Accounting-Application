import {
  buildDebtPaymentEntry,
  validateDebtPaymentAmount,
  type DebtPaymentResult
} from "@/core/accounting/engine";
import type {
  DebtDirection,
  FinancialAccountRef
} from "@/core/accounting/types";
import {
  getDB,
  type LocalDebt,
  type LocalDebtPayment,
  type LocalJournalEntry,
  type LocalJournalEntryLine,
  type MusaedDB
} from "@/core/db/db";
import {
  enqueueOp,
  makeSyncFields,
  newId,
  nowIso,
  tempDocNumber
} from "@/core/db/repositories";
import {
  debtPaymentFormSchema,
  deriveDebtPayment,
  type DebtPaymentFormInput
} from "@/core/validation/debt-payment";

export interface CreateDebtPaymentContext {
  businessId: string;
  accountRef: FinancialAccountRef;
  createdBy?: string;
}

export interface CreateDebtPaymentResult {
  payment: LocalDebtPayment;
  debt: LocalDebt;
  entry: LocalJournalEntry;
  entryLines: LocalJournalEntryLine[];
}

export class DebtNotFoundError extends Error {
  constructor() {
    super("الدين غير موجود أو تم حذفه");
    this.name = "DebtNotFoundError";
  }
}

export class DebtSettledError extends Error {
  constructor() {
    super("هذا الدين مسدد بالكامل");
    this.name = "DebtSettledError";
  }
}

export class DebtPartyMissingError extends Error {
  constructor() {
    super("الدين غير مرتبط بجهة صالحة");
    this.name = "DebtPartyMissingError";
  }
}

function mapEngineError(error: unknown): string {  if (error instanceof Error) return error.message;
  return "تعذر تسجيل الدفعة";
}

export async function createDebtPayment(
  input: DebtPaymentFormInput,
  ctx: CreateDebtPaymentContext,
  db: MusaedDB = getDB()
): Promise<CreateDebtPaymentResult> {
  const parsed = debtPaymentFormSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "بيانات الدفعة غير صالحة"
    );
  }
  const data = parsed.data;
  const { amountMinor } = deriveDebtPayment(data);

  if (!ctx.accountRef.id || ctx.accountRef.id !== data.accountId) {
    throw new Error("حساب الاستلام/الدفع المحدد غير مطابق للمعرّف المُدخل");
  }

  const existingDebt = await db.debts.get(data.debtId);
  if (!existingDebt || existingDebt.deletedAt) {
    throw new DebtNotFoundError();
  }
  if (existingDebt.remainingAmountMinor <= 0) {
    throw new DebtSettledError();
  }
  if (!existingDebt.partyId) {
    throw new DebtPartyMissingError();
  }

  try {
    validateDebtPaymentAmount(amountMinor, existingDebt.remainingAmountMinor);
  } catch (error) {
    throw new Error(mapEngineError(error));
  }

  const paymentId = newId();
  const op = {
    paymentId,
    debtId: existingDebt.id,
    direction: existingDebt.direction,
    partyId: existingDebt.partyId,
    occurredAt: new Date(data.occurredAt).toISOString(),
    amount: amountMinor,
    account: ctx.accountRef,
    paymentMethod: data.paymentMethod
  };

  let engineResult: DebtPaymentResult;
  try {
    engineResult = buildDebtPaymentEntry(op);
  } catch (error) {
    throw new Error(mapEngineError(error));
  }

  const createdAt = nowIso();
  const debtDirection: DebtDirection = existingDebt.direction;

  const payment: LocalDebtPayment = {
    id: paymentId,
    debtId: existingDebt.id,
    amountMinor,
    occurredAt: op.occurredAt,
    accountId: ctx.accountRef.id,
    paymentMethod: data.paymentMethod,
    journalEntryId: null,
    notes: data.notes,
    createdBy: ctx.createdBy ?? "",
    ...makeSyncFields({ businessId: ctx.businessId })
  };

  const entryId = newId();
  const entry: LocalJournalEntry = {
    id: entryId,
    entryNumber: tempDocNumber(),
    occurredAt: op.occurredAt,
    description:
      debtDirection === "receivable"
        ? `دفعة من عميل — دين ${existingDebt.id.slice(0, 8)}`
        : `سداد لمورد — دين ${existingDebt.id.slice(0, 8)}`,
    sourceType: "debt_payment",
    sourceId: paymentId,
    status: "posted",
    reversalOfEntryId: null,
    ...makeSyncFields({ businessId: ctx.businessId })
  };
  payment.journalEntryId = entryId;

  const entryLines: LocalJournalEntryLine[] = engineResult.entry.lines.map(
    (line) => ({
      id: newId(),
      businessId: ctx.businessId,
      entryId,
      glCode: line.glCode,
      debitMinor: line.debit,
      creditMinor: line.credit,
      financialAccountId: line.financialAccountId ?? null,
      partyType: line.partyType ?? null,
      partyId: line.partyId ?? null
    })
  );

  const nextRemaining = existingDebt.remainingAmountMinor - amountMinor;
  const updatedDebt: LocalDebt = {
    ...existingDebt,
    paidAmountMinor: existingDebt.paidAmountMinor + amountMinor,
    remainingAmountMinor: nextRemaining,
    status: nextRemaining === 0 ? "settled" : "partial",
    updatedAt: createdAt,
    version: existingDebt.version + 1
  };

  await db.transaction(
    "rw",
    [db.debtPayments, db.debts, db.customers, db.suppliers, db.financialAccounts, db.journalEntries, db.journalEntryLines, db.outbox],
    async () => {
      if (debtDirection === "receivable") {
        const account = await db.financialAccounts.get(ctx.accountRef.id);
        if (!account) {
          throw new Error("حساب الاستلام غير موجود في القاعدة المحلية");
        }
        await db.financialAccounts.put({
          ...account,
          currentBalanceMinor: account.currentBalanceMinor + amountMinor,
          totalDepositsMinor: account.totalDepositsMinor + amountMinor,
          updatedAt: createdAt,
          version: account.version + 1
        });
        const customer = await db.customers.get(existingDebt.partyId!);
        if (customer) {
          await db.customers.put({
            ...customer,
            currentBalanceMinor: customer.currentBalanceMinor - amountMinor,
            lastTransactionAt: op.occurredAt,
            updatedAt: createdAt,
            version: customer.version + 1
          });
        }
      } else {
        const account = await db.financialAccounts.get(ctx.accountRef.id);
        if (!account) {
          throw new Error("حساب الدفع غير موجود في القاعدة المحلية");
        }
        await db.financialAccounts.put({
          ...account,
          currentBalanceMinor: account.currentBalanceMinor - amountMinor,
          totalWithdrawalsMinor: account.totalWithdrawalsMinor + amountMinor,
          updatedAt: createdAt,
          version: account.version + 1
        });
        const supplier = await db.suppliers.get(existingDebt.partyId!);
        if (supplier) {
          await db.suppliers.put({
            ...supplier,
            currentBalanceMinor: supplier.currentBalanceMinor - amountMinor,
            lastTransactionAt: op.occurredAt,
            updatedAt: createdAt,
            version: supplier.version + 1
          });
        }
      }

      await db.journalEntries.put(entry);
      await db.journalEntryLines.bulkPut(entryLines);
      await db.debts.put(updatedDebt);
      await db.debtPayments.put(payment);

      await enqueueOp({
        db,
        businessId: ctx.businessId,
        opType: "debt_payment.create",
        entityType: "debtPayments",
        entityId: paymentId,
        payload: {
          clientOpId: paymentId,
          createdAt,
          payment: {
            id: paymentId,
            debtId: existingDebt.id,
            direction: debtDirection,
            partyId: existingDebt.partyId,
            occurredAt: op.occurredAt,
            amountMinor,
            accountId: ctx.accountRef.id,
            paymentMethod: data.paymentMethod,
            notes: data.notes
          },
          debtUpdate: {
            id: existingDebt.id,
            paidAmountMinor: updatedDebt.paidAmountMinor,
            remainingAmountMinor: updatedDebt.remainingAmountMinor,
            status: updatedDebt.status
          }
        }
      });
    }
  );

  return { payment, debt: updatedDebt, entry, entryLines };
}

export interface StatementRow {
  type: "debt" | "payment";
  occurredAt: string;
  ref: string;
  amountMinor: number;
  balanceAfterMinor: number;
  note: string;
}

export interface PartyStatement {
  direction: DebtDirection;
  openingBalanceMinor: number;
  currentBalanceMinor: number;
  rows: StatementRow[];
}

const SOURCE_LABELS: Record<string, string> = {
  sale: "دين — بيع",
  purchase: "دين — شراء",
  manual: "دين — يدوي"
};

export async function buildPartyStatement(
  partyId: string,
  direction: DebtDirection,
  db: MusaedDB = getDB()
): Promise<PartyStatement> {
  const party =
    direction === "receivable"
      ? await db.customers.get(partyId)
      : await db.suppliers.get(partyId);
  if (!party) {
    throw new DebtPartyMissingError();
  }

  const debts = await db.debts
    .where("partyId")
    .equals(partyId)
    .filter((debt) => debt.direction === direction && !debt.deletedAt)
    .toArray();
  const payments = await db.debtPayments.toArray();

  const rows: StatementRow[] = [];
  for (const debt of debts) {
    rows.push({
      type: "debt",
      occurredAt: debt.createdAt,
      ref: debt.sourceId ? debt.sourceId.slice(0, 8) : debt.id.slice(0, 8),
      amountMinor: debt.amountMinor,
      balanceAfterMinor: 0,
      note: SOURCE_LABELS[debt.sourceType] ?? "دين"
    });
  }

  for (const debt of debts) {
    const debtPayments = payments
      .filter((p) => p.debtId === debt.id && !p.deletedAt)
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
    for (const payment of debtPayments) {
      rows.push({
        type: "payment",
        occurredAt: payment.occurredAt,
        ref: payment.id.slice(0, 8),
        amountMinor: -payment.amountMinor,
        balanceAfterMinor: 0,
        note: payment.notes || "دفعة"
      });
    }
  }

  rows.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));

  const totalDelta = rows.reduce((sum, row) => sum + row.amountMinor, 0);
  let running = party.currentBalanceMinor - totalDelta;
  const openingBalanceMinor = running;
  for (const row of rows) {
    running += row.amountMinor;
    row.balanceAfterMinor = running;
  }

  return {
    direction,
    openingBalanceMinor,
    currentBalanceMinor: party.currentBalanceMinor,
    rows
  };
}
