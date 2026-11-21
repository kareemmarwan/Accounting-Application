import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDB } from "@/core/db/db";
import type { ExpenseFormInput } from "@/core/validation/expense";
import {
  createExpense,
  type CreateExpenseContext
} from "./expenses-service";

const BUSINESS_ID = "b0000000-0000-0000-0000-000000000004";
const ACCOUNT_ID = "a0000000-0000-0000-0000-000000000004";
const CATEGORY_ID = "c1000000-0000-0000-0000-000000000004";

async function seed() {
  const db = getDB();
  const now = new Date().toISOString();
  await db.businesses.put({
    id: BUSINESS_ID,
    name: "بقالة تجريبية",
    businessType: "grocery",
    ownerId: "00000000-0000-0000-0000-00000000000a",
    currency: "ILS",
    phone: null,
    plan: "free",
    createdAt: now,
    updatedAt: now,
    version: 1
  });
  await db.financialAccounts.put({
    id: ACCOUNT_ID,
    businessId: BUSINESS_ID,
    name: "الصندوق الرئيسي",
    type: "cash",
    provider: null,
    currency: "ILS",
    openingBalanceMinor: 100000,
    currentBalanceMinor: 100000,
    totalDepositsMinor: 100000,
    totalWithdrawalsMinor: 0,
    isActive: true,
    updatedAt: now,
    syncStatus: "synced",
    version: 1,
    deletedAt: null
  });
  await db.expenseCategories.put({
    id: CATEGORY_ID,
    businessId: BUSINESS_ID,
    name: "كهرباء",
    glCode: "5110",
    isSystem: true,
    sortOrder: 20
  });
}

const ctx: CreateExpenseContext = {
  businessId: BUSINESS_ID,
  accountRef: { id: ACCOUNT_ID, type: "cash" }
};

function validInput(
  overrides: Partial<{ [K in keyof ExpenseFormInput]: ExpenseFormInput[K] }> = {}
): ExpenseFormInput {
  return {
    title: "فاتورة كهرباء يناير",
    categoryId: CATEGORY_ID,
    amount: "85.50",
    occurredAt: new Date("2026-01-05T14:00:00Z").toISOString(),
    paymentMethod: "cash",
    accountId: ACCOUNT_ID,
    notes: "",
    ...overrides
  };
}

describe("createExpense", () => {
  beforeEach(async () => {
    const db = getDB();
    await Promise.all(db.tables.map((table) => table.clear()));
    await seed();
  });

  it("مصروف نقدي: يخصم الصندوق ويقيد على حساب التصنيف 5110 متوازناً", async () => {
    const result = await createExpense(validInput(), ctx);

    expect(result.expense.amountMinor).toBe(8550);
    expect(result.expense.glCode).toBe("5110");

    const account = await getDB().financialAccounts.get(ACCOUNT_ID);
    expect(account?.currentBalanceMinor).toBe(100000 - 8550);
    expect(account?.totalWithdrawalsMinor).toBe(8550);

    const lines = await getDB()
      .journalEntryLines.where("entryId")
      .equals(result.entry.id)
      .toArray();
    const debit = lines.reduce((sum, line) => sum + line.debitMinor, 0);
    const credit = lines.reduce((sum, line) => sum + line.creditMinor, 0);
    expect(debit).toBe(credit);
    expect(debit).toBe(8550);
    expect(lines.find((line) => line.glCode === "5110")?.debitMinor).toBe(8550);
    expect(lines.find((line) => line.glCode === "1100")?.creditMinor).toBe(8550);

    const outboxItems = await getDB().outbox.toArray();
    expect(outboxItems).toHaveLength(1);
    expect(outboxItems[0]?.opType).toBe("expense.create");
    expect(outboxItems[0]?.entityId).toBe(result.expense.id);
  });

  it("مصروف بتحويل بنكي من حساب بنكي يقيد على 1200", async () => {
    const db = getDB();
    const bankId = "a0000000-0000-0000-0000-0000000000b4";
    await db.financialAccounts.put({
      id: bankId,
      businessId: BUSINESS_ID,
      name: "بنك فلسطين",
      type: "bank",
      provider: "bank_palestine",
      currency: "ILS",
      openingBalanceMinor: 500000,
      currentBalanceMinor: 500000,
      totalDepositsMinor: 500000,
      totalWithdrawalsMinor: 0,
      isActive: true,
      updatedAt: new Date().toISOString(),
      syncStatus: "synced",
      version: 1,
      deletedAt: null
    });

    const result = await createExpense(
      validInput({ paymentMethod: "bank_transfer", accountId: bankId }),
      {
        businessId: BUSINESS_ID,
        accountRef: { id: bankId, type: "bank" }
      }
    );

    const lines = await getDB()
      .journalEntryLines.where("entryId")
      .equals(result.entry.id)
      .toArray();
    expect(lines.find((line) => line.glCode === "1200")?.creditMinor).toBe(8550);

    const bank = await db.financialAccounts.get(bankId);
    expect(bank?.currentBalanceMinor).toBe(500000 - 8550);
  });

  it("يرفض تصنيفاً غير موجود", async () => {
    await expect(
      createExpense(
        validInput({ categoryId: "00000000-0000-0000-0000-000000000000" }),
        ctx
      )
    ).rejects.toThrow("تصنيف المصروف غير موجود");
  });

  it("يرفض مصروفاً بلا حساب دفع", async () => {
    await expect(
      createExpense(
        validInput(),
        { businessId: BUSINESS_ID, accountRef: { id: "", type: "cash" } }
      )
    ).rejects.toThrow();
  });

  it("يرفض مبلغاً صفراً", async () => {
    await expect(
      createExpense(validInput({ amount: "0.00" }), ctx)
    ).rejects.toThrow();
  });

  it("الإيصال: يحفظ blob وmeta ويربطه بالمصروف", async () => {
    const file = new File(["receipt-data"], "receipt.jpg", {
      type: "image/jpeg"
    });
    const result = await createExpense(validInput(), {
      ...ctx,
      receiptFile: file
    });

    expect(result.receiptAttachmentId).toBe(result.expense.receiptPath);

    const meta = await getDB().attachmentsMeta.get(result.receiptAttachmentId!);
    expect(meta?.entityType).toBe("expenses");
    expect(meta?.entityId).toBe(result.expense.id);
    expect(meta?.mimeType).toBe("image/jpeg");

    const blob = await getDB().attachmentBlobs.get(result.receiptAttachmentId!);
    expect(await blob!.blob.text()).toBe("receipt-data");
  });

  it("يرفض ملفاً أكبر من 10 ميغابايت", async () => {
    const bigFile = new File([new ArrayBuffer(10 * 1024 * 1024 + 1)], "big.jpg", {
      type: "image/jpeg"
    });
    await expect(
      createExpense(validInput(), { ...ctx, receiptFile: bigFile })
    ).rejects.toThrow("حجم الملف أكبر من الحد المسموح (10 ميغابايت)");
  });

  it("حالة المزامنة pending وترقيم مؤقت للقيد", async () => {
    const result = await createExpense(validInput(), ctx);
    expect(result.expense.syncStatus).toBe("pending");
    expect(result.entry.entryNumber).toMatch(/^L-[0-9a-f]{8}$/);
  });
});
