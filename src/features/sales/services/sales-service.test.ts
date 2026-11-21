import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDB } from "@/core/db/db";
import type { SaleFormInput } from "@/core/validation/sale";
import { createSale, type CreateSaleContext } from "./sales-service";

const BUSINESS_ID = "b0000000-0000-0000-0000-000000000001";
const ACCOUNT_ID = "a0000000-0000-0000-0000-000000000001";
const CUSTOMER_ID = "c0000000-0000-0000-0000-000000000001";

async function seed() {
  const db = getDB();
  await db.businesses.put({
    id: BUSINESS_ID,
    name: "بقالة تجريبية",
    businessType: "grocery",
    ownerId: "00000000-0000-0000-0000-00000000000a",
    currency: "ILS",
    phone: null,
    plan: "free",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
    updatedAt: new Date().toISOString(),
    syncStatus: "synced",
    version: 1,
    deletedAt: null
  });
  await db.customers.put({
    id: CUSTOMER_ID,
    businessId: BUSINESS_ID,
    name: "عميل تجريبي",
    phone: "0599123456",
    address: "",
    notes: "",
    currentBalanceMinor: 0,
    totalTransactionsMinor: 0,
    lastTransactionAt: null,
    updatedAt: new Date().toISOString(),
    syncStatus: "synced",
    version: 1,
    deletedAt: null
  });
}

const ctx: CreateSaleContext = {
  businessId: BUSINESS_ID,
  accountRef: { id: ACCOUNT_ID, type: "cash" }
};

function validInput(
  overrides: Partial<{ [K in keyof SaleFormInput]: SaleFormInput[K] }> = {}
): SaleFormInput {
  return {
    customerId: "",
    occurredAt: new Date("2026-01-15T10:00:00Z").toISOString(),
    description: "بيع تجريبي",
    totalAmount: "150.00",
    discount: "",
    paymentMethod: "cash",
    accountId: ACCOUNT_ID,
    paidAmount: "150.00",
    notes: "",
    ...overrides
  };
}

describe("createSale", () => {
  beforeEach(async () => {
    const db = getDB();
    await Promise.all(
      db.tables.map((table) => table.clear())
    );
    await seed();
  });

  it("بيع نقدي كامل: يحدّث رصيد الصندوق ويقيم قيداً متوازناً دون دين", async () => {
    const result = await createSale(validInput(), ctx);

    expect(result.sale.netAmountMinor).toBe(15000);
    expect(result.sale.remainingAmountMinor).toBe(0);
    expect(result.debt).toBeNull();

    const account = await getDB().financialAccounts.get(ACCOUNT_ID);
    expect(account?.currentBalanceMinor).toBe(115000);
    expect(account?.totalDepositsMinor).toBe(115000);

    const lines = await getDB()
      .journalEntryLines.where("entryId")
      .equals(result.entry.id)
      .toArray();
    const debit = lines.reduce((sum, line) => sum + line.debitMinor, 0);
    const credit = lines.reduce((sum, line) => sum + line.creditMinor, 0);
    expect(debit).toBe(credit);
    expect(debit).toBe(15000);

    const outboxItems = await getDB().outbox.toArray();
    expect(outboxItems).toHaveLength(1);
    expect(outboxItems[0]?.opType).toBe("sale.create");
    expect(outboxItems[0]?.entityId).toBe(result.sale.id);
  });

  it("بيع آجل: لا يلمس النقد ويُنشئ ديناً ويحدّث رصيد العميل", async () => {
    const result = await createSale(
      validInput({
        customerId: CUSTOMER_ID,
        paymentMethod: "credit",
        paidAmount: "",
        accountId: ""
      }),
      { businessId: BUSINESS_ID }
    );

    expect(result.sale.paidAmountMinor).toBe(0);
    expect(result.sale.remainingAmountMinor).toBe(15000);
    expect(result.debt?.remainingAmountMinor).toBe(15000);
    expect(result.sale.debtId).toBe(result.debt?.id);

    const account = await getDB().financialAccounts.get(ACCOUNT_ID);
    expect(account?.currentBalanceMinor).toBe(100000);

    const customer = await getDB().customers.get(CUSTOMER_ID);
    expect(customer?.currentBalanceMinor).toBe(15000);
    expect(customer?.totalTransactionsMinor).toBe(15000);
    expect(customer?.lastTransactionAt).toBe(result.sale.occurredAt);

    const lines = await getDB()
      .journalEntryLines.where("entryId")
      .equals(result.entry.id)
      .toArray();
    const arLine = lines.find((line) => line.glCode === "1300");
    expect(arLine?.debitMinor).toBe(15000);
    expect(arLine?.partyId).toBe(CUSTOMER_ID);
  });

  it("بيع مختلط: حركة نقدية بقيمة المدفوع فقط + دين بالفرق", async () => {
    const result = await createSale(
      validInput({
        customerId: CUSTOMER_ID,
        paidAmount: "50.00"
      }),
      ctx
    );

    expect(result.sale.netAmountMinor).toBe(15000);
    expect(result.sale.paidAmountMinor).toBe(5000);
    expect(result.sale.remainingAmountMinor).toBe(10000);

    const account = await getDB().financialAccounts.get(ACCOUNT_ID);
    expect(account?.currentBalanceMinor).toBe(105000);

    const customer = await getDB().customers.get(CUSTOMER_ID);
    expect(customer?.currentBalanceMinor).toBe(10000);

    const lines = await getDB()
      .journalEntryLines.where("entryId")
      .equals(result.entry.id)
      .toArray();
    const debit = lines.reduce((sum, line) => sum + line.debitMinor, 0);
    const credit = lines.reduce((sum, line) => sum + line.creditMinor, 0);
    expect(debit).toBe(credit);
    expect(lines.find((line) => line.glCode === "1100")?.debitMinor).toBe(5000);
    expect(lines.find((line) => line.glCode === "1300")?.debitMinor).toBe(10000);
  });

  it("يرفض المبلغ المدفوع الأكبر من الصافي", async () => {
    await expect(
      createSale(validInput({ paidAmount: "200.00" }), ctx)
    ).rejects.toThrow();
  });

  it("يرفض الخصم الأكبر من الإجمالي", async () => {
    await expect(
      createSale(validInput({ discount: "160.00" }), ctx)
    ).rejects.toThrow();
  });

  it("يرفض آجلاً بلا عميل", async () => {
    await expect(
      createSale(
        validInput({ paymentMethod: "credit", paidAmount: "", accountId: "" }),
        { businessId: BUSINESS_ID }
      )
    ).rejects.toThrow("البيع الآجل يتطلب تحديد العميل");
  });

  it("يرفض تحويلاً بنكياً بلا حساب مستلم", async () => {
    await expect(
      createSale(
        validInput({
          paymentMethod: "bank_transfer",
          accountId: "",
          paidAmount: ""
        }),
        ctx
      )
    ).rejects.toThrow();
  });

  it("المبيعات الجديدة تُخزن بترقيم مؤقت L- وsyncStatus=pending", async () => {
    const result = await createSale(validInput(), ctx);
    expect(result.sale.saleNumber).toMatch(/^L-[0-9a-f]{8}$/);
    expect(result.sale.syncStatus).toBe("pending");
    expect(result.sale.businessId).toBe(BUSINESS_ID);
  });

  it("معرّفات جديدة صالحة UUID", async () => {
    const first = await createSale(validInput(), ctx);
    const second = await createSale(validInput({ description: "بيع آخر" }), ctx);
    expect(first.sale.id).not.toBe(second.sale.id);
  });
});
