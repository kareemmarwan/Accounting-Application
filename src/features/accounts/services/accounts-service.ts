import {
  buildAdjustmentEntry,
  buildDepositEntry,
  buildTransferEntry,
  buildWithdrawalEntry,
  type AdjustmentResult,
  type DepositResult,
  type TransferResult,
  type WithdrawalResult
} from "@/core/accounting/engine";
import type {
  EntrySourceType,
  FinancialAccountRef,
  JournalLine
} from "@/core/accounting/types";
import {
  getDB,
  type LocalFinancialAccount,
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
  accountAdjustFormSchema,
  accountOperationFormSchema,
  accountTransferFormSchema,
  deriveAccountAdjust,
  deriveAccountOperation,
  deriveAccountTransfer,
  financialAccountFormSchema,
  financialAccountUpdateSchema,
  deriveFinancialAccount,
  normalizeAccountProvider,
  type AccountAdjustFormInput,
  type AccountOperationFormInput,
  type AccountTransferFormInput,
  type FinancialAccountFormInput,
  type FinancialAccountUpdateInput
} from "@/core/validation/account";

export interface AccountContext {
  businessId: string;
  createdBy?: string;
}

export interface CreateAccountResult {
  account: LocalFinancialAccount;
  entry: LocalJournalEntry | null;
  entryLines: LocalJournalEntryLine[];
}

export interface UpdateAccountResult {
  account: LocalFinancialAccount;
}

export interface AccountOperationResult {
  account: LocalFinancialAccount;
  entry: LocalJournalEntry;
  entryLines: LocalJournalEntryLine[];
}

export interface TransferAccountsResult {
  fromAccount: LocalFinancialAccount;
  toAccount: LocalFinancialAccount;
  entry: LocalJournalEntry;
  entryLines: LocalJournalEntryLine[];
}

export interface AdjustAccountResult {
  account: LocalFinancialAccount;
  entry: LocalJournalEntry | null;
  entryLines: LocalJournalEntryLine[];
  diffMinor: number;
}

export class AccountNotFoundError extends Error {
  constructor() {
    super("الحساب المالي غير موجود أو تم حذفه");
    this.name = "AccountNotFoundError";
  }
}

export class AccountInactiveError extends Error {
  constructor() {
    super("الحساب غير نشط — أعد تنشيطه أولاً");
    this.name = "AccountInactiveError";
  }
}

export class AccountHasBalanceError extends Error {
  constructor() {
    super("لا يمكن حذف حساب برصيد غير صفري — صفّره أولاً عبر تسوية أو سحب");
    this.name = "AccountHasBalanceError";
  }
}

function mapEngineError(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return fallback;
}

async function loadActiveAccount(
  db: MusaedDB,
  accountId: string
): Promise<LocalFinancialAccount> {
  const account = await db.financialAccounts.get(accountId);
  if (!account || account.deletedAt) {
    throw new AccountNotFoundError();
  }
  if (!account.isActive) {
    throw new AccountInactiveError();
  }
  return account;
}

function toRef(account: LocalFinancialAccount): FinancialAccountRef {
  return { id: account.id, type: account.type };
}

function entryLinesFrom(
  engineLines: JournalLine[],
  ctx: AccountContext,
  entryId: string
): LocalJournalEntryLine[] {
  return engineLines.map((line) => ({
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
}

function makeEntry(
  ctx: AccountContext,
  occurredAt: string,
  description: string,
  sourceType: EntrySourceType,
  sourceId: string
): LocalJournalEntry {
  return {
    id: newId(),
    entryNumber: tempDocNumber(),
    occurredAt,
    description,
    sourceType,
    sourceId,
    status: "posted",
    reversalOfEntryId: null,
    ...makeSyncFields({ businessId: ctx.businessId })
  };
}

export async function createFinancialAccount(
  input: FinancialAccountFormInput,
  ctx: AccountContext,
  db: MusaedDB = getDB()
): Promise<CreateAccountResult> {
  const parsed = financialAccountFormSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "بيانات الحساب غير صالحة");
  }
  const data = parsed.data;
  const { openingBalanceMinor } = deriveFinancialAccount(data);

  const accountId = newId();
  const createdAt = nowIso();

  const account: LocalFinancialAccount = {
    id: accountId,
    name: data.name,
    type: data.type,
    provider: normalizeAccountProvider(data.provider),
    currency: "ILS",
    openingBalanceMinor,
    currentBalanceMinor: openingBalanceMinor,
    totalDepositsMinor: 0,
    totalWithdrawalsMinor: 0,
    isActive: true,
    ...makeSyncFields({ businessId: ctx.businessId }),
    updatedAt: createdAt
  };

  let entry: LocalJournalEntry | null = null;
  let entryLines: LocalJournalEntryLine[] = [];

  if (openingBalanceMinor > 0) {
    let engineResult: DepositResult;
    try {
      engineResult = buildDepositEntry({
        depositId: accountId,
        occurredAt: createdAt,
        amount: openingBalanceMinor,
        account: { id: accountId, type: data.type }
      });
    } catch (error) {
      throw new Error(mapEngineError(error, "تعذر إنشاء قيد الرصيد الافتتاحي"));
    }

    entry = makeEntry(
      ctx,
      createdAt,
      `رصيد افتتاحي — ${data.name}`,
      "opening",
      accountId
    );
    entryLines = entryLinesFrom(engineResult.entry.lines, ctx, entry.id);
  }

  await db.transaction(
    "rw",
    [db.financialAccounts, db.journalEntries, db.journalEntryLines, db.outbox],
    async () => {
      await db.financialAccounts.put(account);
      if (entry) {
        await db.journalEntries.put(entry);
        await db.journalEntryLines.bulkPut(entryLines);
      }

      await enqueueOp({
        db,
        businessId: ctx.businessId,
        opType: "entity.upsert",
        entityType: "financialAccounts",
        entityId: accountId,
        payload: {
          clientOpId: accountId,
          createdAt,
          entity: "financialAccounts",
          op: "create",
          account: {
            id: accountId,
            name: data.name,
            type: data.type,
            provider: normalizeAccountProvider(data.provider),
            currency: account.currency,
            openingBalanceMinor,
            currentBalanceMinor: openingBalanceMinor,
            isActive: true
          },
          openingEntry:
            openingBalanceMinor > 0
              ? {
                  occurredAt: createdAt,
                  amountMinor: openingBalanceMinor,
                  accountId,
                  sourceType: "opening"
                }
              : null
        }
      });
    }
  );

  return { account, entry, entryLines };
}

export async function updateFinancialAccount(
  accountId: string,
  input: FinancialAccountUpdateInput,
  ctx: AccountContext,
  db: MusaedDB = getDB()
): Promise<UpdateAccountResult> {
  const parsed = financialAccountUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "بيانات التعديل غير صالحة");
  }
  const data = parsed.data;

  const existing = await db.financialAccounts.get(accountId);
  if (!existing || existing.deletedAt) {
    throw new AccountNotFoundError();
  }

  const createdAt = nowIso();
  const opId = newId();
  const updated: LocalFinancialAccount = {
    ...existing,
    name: data.name,
    provider: normalizeAccountProvider(data.provider) ?? existing.provider,
    updatedAt: createdAt,
    version: existing.version + 1
  };

  await db.transaction("rw", [db.financialAccounts, db.outbox], async () => {
    await db.financialAccounts.put(updated);
    await enqueueOp({
      db,
      businessId: ctx.businessId,
      opType: "entity.upsert",
      entityType: "financialAccounts",
      entityId: accountId,
      payload: {
        clientOpId: opId,
        createdAt,
        entity: "financialAccounts",
        op: "update",
        id: accountId,
        name: data.name,
        provider: normalizeAccountProvider(data.provider),
        isActive: updated.isActive,
        version: updated.version
      }
    });
  });

  return { account: updated };
}

export async function setFinancialAccountActive(
  accountId: string,
  isActive: boolean,
  ctx: AccountContext,
  db: MusaedDB = getDB()
): Promise<UpdateAccountResult> {
  const existing = await db.financialAccounts.get(accountId);
  if (!existing || existing.deletedAt) {
    throw new AccountNotFoundError();
  }

  const createdAt = nowIso();
  const opId = newId();
  const updated: LocalFinancialAccount = {
    ...existing,
    isActive,
    updatedAt: createdAt,
    version: existing.version + 1
  };

  await db.transaction("rw", [db.financialAccounts, db.outbox], async () => {
    await db.financialAccounts.put(updated);
    await enqueueOp({
      db,
      businessId: ctx.businessId,
      opType: "entity.upsert",
      entityType: "financialAccounts",
      entityId: accountId,
      payload: {
        clientOpId: opId,
        createdAt,
        entity: "financialAccounts",
        op: "update",
        id: accountId,
        isActive,
        version: updated.version
      }
    });
  });

  return { account: updated };
}

export async function deleteFinancialAccount(
  accountId: string,
  ctx: AccountContext,
  db: MusaedDB = getDB()
): Promise<void> {
  const existing = await db.financialAccounts.get(accountId);
  if (!existing || existing.deletedAt) {
    throw new AccountNotFoundError();
  }
  if (existing.currentBalanceMinor !== 0) {
    throw new AccountHasBalanceError();
  }

  const createdAt = nowIso();
  const opId = newId();
  const updated: LocalFinancialAccount = {
    ...existing,
    isActive: false,
    deletedAt: createdAt,
    updatedAt: createdAt,
    version: existing.version + 1
  };

  await db.transaction("rw", [db.financialAccounts, db.outbox], async () => {
    await db.financialAccounts.put(updated);
    await enqueueOp({
      db,
      businessId: ctx.businessId,
      opType: "entity.soft_delete",
      entityType: "financialAccounts",
      entityId: accountId,
      payload: {
        clientOpId: opId,
        createdAt,
        entity: "financialAccounts",
        id: accountId,
        deletedAt: createdAt,
        version: updated.version
      }
    });
  });
}

export async function depositToAccount(
  input: AccountOperationFormInput,
  ctx: AccountContext,
  db: MusaedDB = getDB()
): Promise<AccountOperationResult> {
  const parsed = accountOperationFormSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "بيانات الإيداع غير صالحة");
  }
  const data = parsed.data;
  const { amountMinor } = deriveAccountOperation(data);
  const account = await loadActiveAccount(db, data.accountId);

  const occurredAt = new Date(data.occurredAt).toISOString();
  const depositId = newId();

  let engineResult: DepositResult;
  try {
    engineResult = buildDepositEntry({
      depositId,
      occurredAt,
      amount: amountMinor,
      account: toRef(account)
    });
  } catch (error) {
    throw new Error(mapEngineError(error, "تعذر تسجيل الإيداع"));
  }

  const createdAt = nowIso();
  const description = `إيداع — ${account.name}${data.notes ? ` — ${data.notes}` : ""}`;
  const entry = makeEntry(ctx, occurredAt, description, "deposit", depositId);
  const entryLines = entryLinesFrom(engineResult.entry.lines, ctx, entry.id);

  await db.transaction(
    "rw",
    [db.financialAccounts, db.journalEntries, db.journalEntryLines, db.outbox],
    async () => {
      await db.financialAccounts.put({
        ...account,
        currentBalanceMinor: account.currentBalanceMinor + amountMinor,
        totalDepositsMinor: account.totalDepositsMinor + amountMinor,
        updatedAt: createdAt,
        version: account.version + 1
      });
      await db.journalEntries.put(entry);
      await db.journalEntryLines.bulkPut(entryLines);

      await enqueueOp({
        db,
        businessId: ctx.businessId,
        opType: "deposit.create",
        entityType: "financialAccounts",
        entityId: account.id,
        payload: {
          clientOpId: depositId,
          createdAt,
          deposit: {
            id: depositId,
            accountId: account.id,
            amountMinor,
            occurredAt,
            notes: data.notes
          }
        }
      });
    }
  );

  const accountAfter = await db.financialAccounts.get(account.id);
  return {
    account: accountAfter ?? account,
    entry,
    entryLines
  };
}

export async function withdrawFromAccount(
  input: AccountOperationFormInput,
  ctx: AccountContext,
  db: MusaedDB = getDB()
): Promise<AccountOperationResult> {
  const parsed = accountOperationFormSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "بيانات السحب غير صالحة");
  }
  const data = parsed.data;
  const { amountMinor } = deriveAccountOperation(data);
  const account = await loadActiveAccount(db, data.accountId);

  const occurredAt = new Date(data.occurredAt).toISOString();
  const withdrawalId = newId();

  let engineResult: WithdrawalResult;
  try {
    engineResult = buildWithdrawalEntry({
      withdrawalId,
      occurredAt,
      amount: amountMinor,
      currentBalance: account.currentBalanceMinor,
      account: toRef(account)
    });
  } catch (error) {
    throw new Error(mapEngineError(error, "تعذر تسجيل السحب"));
  }

  const createdAt = nowIso();
  const description = `سحب — ${account.name}${data.notes ? ` — ${data.notes}` : ""}`;
  const entry = makeEntry(ctx, occurredAt, description, "withdrawal", withdrawalId);
  const entryLines = entryLinesFrom(engineResult.entry.lines, ctx, entry.id);

  await db.transaction(
    "rw",
    [db.financialAccounts, db.journalEntries, db.journalEntryLines, db.outbox],
    async () => {
      await db.financialAccounts.put({
        ...account,
        currentBalanceMinor: account.currentBalanceMinor - amountMinor,
        totalWithdrawalsMinor: account.totalWithdrawalsMinor + amountMinor,
        updatedAt: createdAt,
        version: account.version + 1
      });
      await db.journalEntries.put(entry);
      await db.journalEntryLines.bulkPut(entryLines);

      await enqueueOp({
        db,
        businessId: ctx.businessId,
        opType: "withdrawal.create",
        entityType: "financialAccounts",
        entityId: account.id,
        payload: {
          clientOpId: withdrawalId,
          createdAt,
          withdrawal: {
            id: withdrawalId,
            accountId: account.id,
            amountMinor,
            occurredAt,
            notes: data.notes
          }
        }
      });
    }
  );

  const accountAfter = await db.financialAccounts.get(account.id);
  return {
    account: accountAfter ?? account,
    entry,
    entryLines
  };
}

export async function transferBetweenAccounts(
  input: AccountTransferFormInput,
  ctx: AccountContext,
  db: MusaedDB = getDB()
): Promise<TransferAccountsResult> {
  const parsed = accountTransferFormSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "بيانات التحويل غير صالحة");
  }
  const data = parsed.data;
  const { amountMinor } = deriveAccountTransfer(data);

  const fromAccount = await loadActiveAccount(db, data.fromAccountId);
  const toAccount = await loadActiveAccount(db, data.toAccountId);

  const occurredAt = new Date(data.occurredAt).toISOString();
  const transferId = newId();

  let engineResult: TransferResult;
  try {
    engineResult = buildTransferEntry({
      transferId,
      occurredAt,
      amount: amountMinor,
      fromAccount: toRef(fromAccount),
      toAccount: toRef(toAccount)
    });
  } catch (error) {
    throw new Error(mapEngineError(error, "تعذر تسجيل التحويل"));
  }

  const createdAt = nowIso();
  const description = `تحويل من ${fromAccount.name} إلى ${toAccount.name}${
    data.notes ? ` — ${data.notes}` : ""
  }`;
  const entry = makeEntry(ctx, occurredAt, description, "transfer", transferId);
  const entryLines = entryLinesFrom(engineResult.entry.lines, ctx, entry.id);

  await db.transaction(
    "rw",
    [db.financialAccounts, db.journalEntries, db.journalEntryLines, db.outbox],
    async () => {
      await db.financialAccounts.put({
        ...fromAccount,
        currentBalanceMinor: fromAccount.currentBalanceMinor - amountMinor,
        totalWithdrawalsMinor: fromAccount.totalWithdrawalsMinor + amountMinor,
        updatedAt: createdAt,
        version: fromAccount.version + 1
      });
      await db.financialAccounts.put({
        ...toAccount,
        currentBalanceMinor: toAccount.currentBalanceMinor + amountMinor,
        totalDepositsMinor: toAccount.totalDepositsMinor + amountMinor,
        updatedAt: createdAt,
        version: toAccount.version + 1
      });
      await db.journalEntries.put(entry);
      await db.journalEntryLines.bulkPut(entryLines);

      await enqueueOp({
        db,
        businessId: ctx.businessId,
        opType: "transfer.create",
        entityType: "financialAccounts",
        entityId: transferId,
        payload: {
          clientOpId: transferId,
          createdAt,
          transfer: {
            id: transferId,
            fromAccountId: fromAccount.id,
            toAccountId: toAccount.id,
            amountMinor,
            occurredAt,
            notes: data.notes
          }
        }
      });
    }
  );

  const fromAfter = await db.financialAccounts.get(fromAccount.id);
  const toAfter = await db.financialAccounts.get(toAccount.id);
  return {
    fromAccount: fromAfter ?? fromAccount,
    toAccount: toAfter ?? toAccount,
    entry,
    entryLines
  };
}

export async function adjustAccountBalance(
  input: AccountAdjustFormInput,
  ctx: AccountContext,
  db: MusaedDB = getDB()
): Promise<AdjustAccountResult> {
  const parsed = accountAdjustFormSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "بيانات التسوية غير صالحة");
  }
  const data = parsed.data;
  const { countedBalanceMinor } = deriveAccountAdjust(data);
  const account = await loadActiveAccount(db, data.accountId);

  const occurredAt = new Date(data.occurredAt).toISOString();
  const adjustmentId = newId();

  let engineResult: AdjustmentResult;
  try {
    engineResult = buildAdjustmentEntry({
      adjustmentId,
      occurredAt,
      countedBalance: countedBalanceMinor,
      currentBalance: account.currentBalanceMinor,
      account: toRef(account)
    });
  } catch (error) {
    throw new Error(mapEngineError(error, "تعذر تسجيل التسوية"));
  }

  if (engineResult.diff === 0 || !engineResult.entry) {
    return { account, entry: null, entryLines: [], diffMinor: 0 };
  }

  const diffMinor = engineResult.diff;
  const createdAt = nowIso();
  const description = `تسوية رصيد — ${account.name}${
    data.notes ? ` — ${data.notes}` : ""
  }`;
  const entry = makeEntry(ctx, occurredAt, description, "adjustment", adjustmentId);
  const entryLines = entryLinesFrom(engineResult.entry.lines, ctx, entry.id);

  await db.transaction(
    "rw",
    [db.financialAccounts, db.journalEntries, db.journalEntryLines, db.outbox],
    async () => {
      await db.financialAccounts.put({
        ...account,
        currentBalanceMinor: account.currentBalanceMinor + diffMinor,
        updatedAt: createdAt,
        version: account.version + 1
      });
      await db.journalEntries.put(entry);
      await db.journalEntryLines.bulkPut(entryLines);

      await enqueueOp({
        db,
        businessId: ctx.businessId,
        opType: "adjustment.create",
        entityType: "financialAccounts",
        entityId: adjustmentId,
        payload: {
          clientOpId: adjustmentId,
          createdAt,
          adjustment: {
            id: adjustmentId,
            accountId: account.id,
            countedBalanceMinor,
            currentBalanceMinor: account.currentBalanceMinor,
            diffMinor,
            occurredAt,
            notes: data.notes
          }
        }
      });
    }
  );

  const accountAfter = await db.financialAccounts.get(account.id);
  return {
    account: accountAfter ?? account,
    entry,
    entryLines,
    diffMinor
  };
}

export interface AccountStatementRow {
  entryId: string;
  entryNumber: string;
  occurredAt: string;
  sourceType: EntrySourceType;
  description: string;
  amountMinor: number;
  balanceAfterMinor: number;
}

export interface AccountStatement {
  account: LocalFinancialAccount;
  openingBalanceMinor: number;
  currentBalanceMinor: number;
  rows: AccountStatementRow[];
}

export const STATEMENT_SOURCE_LABELS: Record<EntrySourceType, string> = {
  sale: "بيع",
  purchase: "شراء",
  expense: "مصروف",
  debt_payment: "دفعة",
  transfer: "تحويل",
  deposit: "إيداع",
  withdrawal: "سحب",
  opening: "افتتاحي",
  adjustment: "تسوية",
  reversal: "قيد عكسي"
};

export async function buildAccountStatement(
  accountId: string,
  db: MusaedDB = getDB()
): Promise<AccountStatement> {
  const account = await db.financialAccounts.get(accountId);
  if (!account || account.deletedAt) {
    throw new AccountNotFoundError();
  }

  const lines = await db.journalEntryLines
    .where("financialAccountId")
    .equals(accountId)
    .toArray();
  const entries = await db.journalEntries.toArray();
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));

  const rows: AccountStatementRow[] = [];
  for (const line of lines) {
    const entry = entryById.get(line.entryId);
    if (!entry || entry.deletedAt || entry.status !== "posted") {
      continue;
    }
    rows.push({
      entryId: entry.id,
      entryNumber: entry.entryNumber,
      occurredAt: entry.occurredAt,
      sourceType: entry.sourceType,
      description: entry.description,
      amountMinor: line.debitMinor - line.creditMinor,
      balanceAfterMinor: 0
    });
  }

  rows.sort((a, b) => {
    const timeDiff = Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
    if (timeDiff !== 0) return timeDiff;
    const entryA = entryById.get(a.entryId);
    const entryB = entryById.get(b.entryId);
    return Date.parse(entryA?.updatedAt ?? "") - Date.parse(entryB?.updatedAt ?? "");
  });

  const totalDelta = rows.reduce((sum, row) => sum + row.amountMinor, 0);
  let running = account.currentBalanceMinor - totalDelta;
  const openingBalanceMinor = running;
  for (const row of rows) {
    running += row.amountMinor;
    row.balanceAfterMinor = running;
  }

  return {
    account,
    openingBalanceMinor,
    currentBalanceMinor: account.currentBalanceMinor,
    rows
  };
}
