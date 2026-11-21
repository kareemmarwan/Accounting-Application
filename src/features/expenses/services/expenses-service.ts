import { buildExpenseEntry, type ExpenseResult } from "@/core/accounting/engine";
import type {
  CashPaymentMethod,
  FinancialAccountRef
} from "@/core/accounting/types";
import {
  getDB,
  type LocalExpense,
  type LocalJournalEntry,
  type LocalJournalEntryLine,
  type MusaedDB
} from "@/core/db/db";
import { saveLocalAttachment } from "@/core/db/attachments";
import {
  enqueueOp,
  makeSyncFields,
  newId,
  nowIso,
  tempDocNumber
} from "@/core/db/repositories";
import {
  deriveExpense,
  expenseFormSchema,
  type ExpenseFormInput
} from "@/core/validation/expense";

export interface CreateExpenseContext {
  businessId: string;
  accountRef: FinancialAccountRef;
  createdBy?: string;
  receiptFile?: File | null;
}

export interface CreateExpenseResult {
  expense: LocalExpense;
  entry: LocalJournalEntry;
  entryLines: LocalJournalEntryLine[];
  receiptAttachmentId: string | null;
}

export class ExpenseCategoryNotFoundError extends Error {
  constructor() {
    super("تصنيف المصروف غير موجود — أعد مزامنة التصنيفات");
    this.name = "ExpenseCategoryNotFoundError";
  }
}

export class ExpenseCategoryGlMismatchError extends Error {
  constructor(glCode: string) {
    super(`الحساب المحاسبي للتصنيف غير صالح: ${glCode}`);
    this.name = "ExpenseCategoryGlMismatchError";
  }
}

function mapEngineError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "تعذر تسجيل المصروف";
}

export async function createExpense(
  input: ExpenseFormInput,
  ctx: CreateExpenseContext,
  db: MusaedDB = getDB()
): Promise<CreateExpenseResult> {
  const parsed = expenseFormSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "بيانات المصروف غير صالحة"
    );
  }
  const data = parsed.data;
  const { amountMinor, paymentMethod } = deriveExpense(data);

  if (!ctx.accountRef.id || ctx.accountRef.id !== data.accountId) {
    throw new Error("حساب الدفع المحدد غير مطابق للمعرّف المُدخل");
  }

  const category = await db.expenseCategories.get(data.categoryId);
  if (!category || category.businessId !== ctx.businessId) {
    throw new ExpenseCategoryNotFoundError();
  }

  const expenseId = newId();
  const op = {
    expenseId,
    occurredAt: new Date(data.occurredAt).toISOString(),
    glCode: category.glCode,
    amount: amountMinor,
    account: ctx.accountRef,
    paymentMethod: paymentMethod as CashPaymentMethod
  };

  let engineResult: ExpenseResult;
  try {
    engineResult = buildExpenseEntry(op);
  } catch (error) {
    if (error instanceof Error && /غير معروف/.test(error.message)) {
      throw new ExpenseCategoryGlMismatchError(category.glCode);
    }
    throw new Error(mapEngineError(error));
  }

  const createdAt = nowIso();

  const expense: LocalExpense = {
    id: expenseId,
    title: data.title,
    categoryId: category.id,
    glCode: category.glCode,
    amountMinor,
    occurredAt: op.occurredAt,
    paymentMethod,
    accountId: ctx.accountRef.id,
    receiptPath: null,
    notes: data.notes,
    status: "posted",
    createdBy: ctx.createdBy ?? "",
    postedAt: createdAt,
    ...makeSyncFields({ businessId: ctx.businessId })
  };

  let receiptAttachmentId: string | null = null;
  if (ctx.receiptFile) {
    receiptAttachmentId = await saveLocalAttachment({
      businessId: ctx.businessId,
      entityId: expenseId,
      entityType: "expenses",
      file: ctx.receiptFile
    });
    expense.receiptPath = receiptAttachmentId;
  }

  const entryId = newId();
  const entry: LocalJournalEntry = {
    id: entryId,
    entryNumber: tempDocNumber(),
    occurredAt: op.occurredAt,
    description: `مصروف: ${category.name} — ${data.title}`,
    sourceType: "expense",
    sourceId: expenseId,
    status: "posted",
    reversalOfEntryId: null,
    ...makeSyncFields({ businessId: ctx.businessId })
  };

  const entryLines: LocalJournalEntryLine[] = engineResult.entry.lines.map(
    (line) => ({
      id: newId(),
      businessId: ctx.businessId,
      entryId,
      glCode: line.glCode,
      debitMinor: line.debit,
      creditMinor: line.credit,
      financialAccountId: line.financialAccountId ?? null,
      partyType: null,
      partyId: null
    })
  );

  await db.transaction(
    "rw",
    [db.expenses, db.financialAccounts, db.journalEntries, db.journalEntryLines, db.attachmentsMeta, db.outbox],
    async () => {
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
      await db.journalEntries.put(entry);
      await db.journalEntryLines.bulkPut(entryLines);
      await db.expenses.put(expense);

      await enqueueOp({
        db,
        businessId: ctx.businessId,
        opType: "expense.create",
        entityType: "expenses",
        entityId: expenseId,
        payload: {
          clientOpId: expenseId,
          createdAt,
          expense: {
            id: expenseId,
            title: data.title,
            categoryId: category.id,
            glCode: category.glCode,
            amountMinor,
            occurredAt: op.occurredAt,
            paymentMethod,
            accountId: ctx.accountRef.id,
            receiptAttachmentId: expense.receiptPath,
            notes: data.notes
          }
        }
      });
    }
  );

  return { expense, entry, entryLines, receiptAttachmentId };
}
