import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDB } from "@/core/db/db";
import type { DebtPaymentFormInput } from "@/core/validation/debt-payment";
import {
  buildPartyStatement,
  createDebtPayment,
  type CreateDebtPaymentContext
} from "./debts-service";

const BUSINESS_ID = "b0000000-0000-0000-0000-000000000003";
const ACCOUNT_ID = "a0000000-0000-0000-0000-000000000003";
const CUSTOMER_ID = "c0000000-0000-0000-0000-000000000003";
const SUPPLIER_ID = "d0000000-0000-0000-0000-000000000003";
const CUSTOMER_DEBT_ID = "e0000000-0000-0000-0000-000000000003";
const SUPPLIER_DEBT_ID = "f0000000-0000-0000-0000-000000000003";

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
  await db.customers.put({
    id: CUSTOMER_ID,
    businessId: BUSINESS_ID,
    name: "عميل",
    phone: "",
    address: "",
    notes: "",
    currentBalanceMinor: 30000,
    totalTransactionsMinor: 30000,
    lastTransactionAt: null,
    updatedAt: now,
    syncStatus: "synced",
    version: 1,
    deletedAt: null
  });
  await db.suppliers.put({
    id: SUPPLIER_ID,
    businessId: BUSINESS_ID,
    name: "مورد",
    phone: "",
    address: "",
    notes: "",
    currentBalanceMinor: 20000,
    totalTransactionsMinor: 20000,
    lastTransactionAt: null,
    updatedAt: now,
    syncStatus: "synced",
    version: 1,
    deletedAt: null
  });
  await db.debts.put({
    id: CUSTOMER_DEBT_ID,
    direction: "receivable",
    partyId: CUSTOMER_ID,
    sourceType: "sale",
    sourceId: "00000000-0000-0000-0000-0000000000b1",
    amountMinor: 30000,
    paidAmountMinor: 0,
    remainingAmountMinor: 30000,
    dueDate: null,
    status: "open",
    notes: "",
    createdAt: "2026-01-15T09:00:00Z",
    businessId: BUSINESS_ID,
    updatedAt: "2026-01-15T09:00:00Z",
    syncStatus: "pending",
    version: 1,
    deletedAt: null
  });
  await db.debts.put({
    id: SUPPLIER_DEBT_ID,
    direction: "payable",
    partyId: SUPPLIER_ID,
    sourceType: "purchase",
    sourceId: "00000000-0000-0000-0000-0000000000b2",
    amountMinor: 20000,
    paidAmountMinor: 0,
    remainingAmountMinor: 20000,
    dueDate: null,
    status: "open",
    notes: "",
    createdAt: "2026-01-15T09:00:00Z",
    businessId: BUSINESS_ID,
    updatedAt: "2026-01-15T09:00:00Z",
    syncStatus: "pending",
    version: 1,
    deletedAt: null
  });
}

const ctx: CreateDebtPaymentContext = {
  businessId: BUSINESS_ID,
  accountRef: { id: ACCOUNT_ID, type: "cash" }
};

function validInput(
  overrides: Partial<{ [K in keyof DebtPaymentFormInput]: DebtPaymentFormInput[K] }> = {}
): DebtPaymentFormInput {
  return {
    debtId: CUSTOMER_DEBT_ID,
    amount: "100.00",
    occurredAt: new Date("2026-01-20T12:00:00Z").toISOString(),
    paymentMethod: "cash",
    accountId: ACCOUNT_ID,
    notes: "",
    ...overrides
  };
}

describe("createDebtPayment", () => {
  beforeEach(async () => {
    const db = getDB();
    await Promise.all(db.tables.map((table) => table.clear()));
    await seed();
  });

  it("دفعة جزئية من عميل: تدخل الصندوق وتخفض رصيد العميل وتصير partial", async () => {
    const result = await createDebtPayment(
      validInput({ amount: "100.00" }),
      ctx
    );

    expect(result.debt.paidAmountMinor).toBe(10000);
    expect(result.debt.remainingAmountMinor).toBe(20000);
    expect(result.debt.status).toBe("partial");

    const account = await getDB().financialAccounts.get(ACCOUNT_ID);
    expect(account?.currentBalanceMinor).toBe(110000);
    expect(account?.totalDepositsMinor).toBe(110000);

    const customer = await getDB().customers.get(CUSTOMER_ID);
    expect(customer?.currentBalanceMinor).toBe(20000);

    const lines = await getDB()
      .journalEntryLines.where("entryId")
      .equals(result.entry.id)
      .toArray();
    const debit = lines.reduce((sum, line) => sum + line.debitMinor, 0);
    const credit = lines.reduce((sum, line) => sum + line.creditMinor, 0);
    expect(debit).toBe(credit);
    expect(debit).toBe(10000);

    const outboxItems = await getDB().outbox.toArray();
    expect(outboxItems).toHaveLength(1);
    expect(outboxItems[0]?.opType).toBe("debt_payment.create");
    expect(outboxItems[0]?.entityId).toBe(result.payment.id);
  });

  it("دفعات متعددة حتى الصفر: settled ورفض دفعة بعدها", async () => {
    const first = await createDebtPayment(validInput({ amount: "200.00" }), ctx);
    expect(first.debt.status).toBe("partial");

    const second = await createDebtPayment(validInput({ amount: "100.00" }), ctx);
    expect(second.debt.remainingAmountMinor).toBe(0);
    expect(second.debt.status).toBe("settled");

    await expect(
      createDebtPayment(validInput({ amount: "10.00" }), ctx)
    ).rejects.toThrow("هذا الدين مسدد بالكامل");
  });

  it("يرفض دفعة تتجاوز المتبقي", async () => {
    await expect(
      createDebtPayment(validInput({ amount: "301.00" }), ctx)
    ).rejects.toThrow("الدفعة تتجاوز المبلغ المتبقي من الدين");
  });

  it("سداد لمورد: يخرج من الصندوق ويخفض رصيد المورد", async () => {
    const result = await createDebtPayment(
      validInput({ debtId: SUPPLIER_DEBT_ID, amount: "80.00" }),
      ctx
    );

    expect(result.debt.remainingAmountMinor).toBe(12000);
    expect(result.debt.status).toBe("partial");

    const account = await getDB().financialAccounts.get(ACCOUNT_ID);
    expect(account?.currentBalanceMinor).toBe(92000);
    expect(account?.totalWithdrawalsMinor).toBe(8000);

    const supplier = await getDB().suppliers.get(SUPPLIER_ID);
    expect(supplier?.currentBalanceMinor).toBe(12000);

    const lines = await getDB()
      .journalEntryLines.where("entryId")
      .equals(result.entry.id)
      .toArray();
    expect(lines.find((line) => line.glCode === "2100")?.debitMinor).toBe(8000);
    expect(lines.find((line) => line.glCode === "1100")?.creditMinor).toBe(8000);
  });

  it("يرفض ديناً غير موجود", async () => {
    await expect(
      createDebtPayment(
        validInput({ debtId: "00000000-0000-0000-0000-000000000000" }),
        ctx
      )
    ).rejects.toThrow("الدين غير موجود أو تم حذفه");
  });

  it("سجل الدفعة مخزن بمرجع القيد وبـ pending", async () => {
    const result = await createDebtPayment(validInput({ amount: "50.00" }), ctx);
    expect(result.payment.journalEntryId).toBe(result.entry.id);
    expect(result.payment.syncStatus).toBe("pending");

    const stored = await getDB().debtPayments.get(result.payment.id);
    expect(stored?.amountMinor).toBe(5000);
  });
});

describe("buildPartyStatement", () => {
  beforeEach(async () => {
    const db = getDB();
    await Promise.all(db.tables.map((table) => table.clear()));
    await seed();
  });

  it("كشف عميل: افتتاحي 0 + دين 300 + دفعتان → رصيد حالي 150", async () => {
    const client = getDB();
    await createDebtPayment(validInput({ amount: "200.00" }), ctx);
    await createDebtPayment(
      validInput({
        amount: "100.00",
        occurredAt: new Date("2026-01-21T12:00:00Z").toISOString()
      }),
      ctx
    );

    const statement = await buildPartyStatement(CUSTOMER_ID, "receivable", client);
    expect(statement.openingBalanceMinor).toBe(0);
    expect(statement.currentBalanceMinor).toBe(0);
    expect(statement.rows).toHaveLength(3);

    const balances = statement.rows.map((row) => row.balanceAfterMinor);
    expect(balances[0]).toBe(30000);
    expect(balances[1]).toBe(10000);
    expect(balances[2]).toBe(0);
  });

  it("كشف مورد: رصيد افتتاحي من قاعدة البيانات يظهر صحيحاً", async () => {
    const statement = await buildPartyStatement(SUPPLIER_ID, "payable", getDB());
    expect(statement.openingBalanceMinor).toBe(0);
    expect(statement.currentBalanceMinor).toBe(20000);
    expect(statement.rows).toHaveLength(1);
  });

  it("يرفض كشفاً لجهة غير موجودة", async () => {
    await expect(
      buildPartyStatement("00000000-0000-0000-0000-000000000000", "receivable", getDB())
    ).rejects.toThrow("الدين غير مرتبط بجهة صالحة");
  });
});
