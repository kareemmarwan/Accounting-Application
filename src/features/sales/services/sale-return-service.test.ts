import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDB } from "@/core/db/db";
import {
  computeReturnSplit,
  returnSaleItems
} from "./sale-return-service";

const BUSINESS_ID = "b0000000-0000-0000-0000-000000000004";
const ACCOUNT_ID = "a0000000-0000-0000-0000-000000000004";
const CUSTOMER_ID = "c0000000-0000-0000-0000-000000000004";
const PRODUCT_ID = "60000000-0000-0000-0000-000000000004";

async function seedSale(options: { withDebt: boolean }) {
  const db = getDB();
  const now = new Date().toISOString();
  await db.businesses.put({
    id: BUSINESS_ID,
    name: "متجر تجريبي",
    businessType: "grocery",
    ownerId: "00000000-0000-0000-0000-00000000000b",
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
    name: "الصندوق",
    type: "cash",
    provider: null,
    currency: "ILS",
    openingBalanceMinor: 50000,
    currentBalanceMinor: 50000,
    totalDepositsMinor: 50000,
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
    name: "عميل تجريبي",
    phone: "0599000000",
    address: "",
    notes: "",
    currentBalanceMinor: options.withDebt ? 8000 : 0,
    totalTransactionsMinor: 0,
    lastTransactionAt: null,
    updatedAt: now,
    syncStatus: "synced",
    version: 1,
    deletedAt: null
  });
  await db.products.put({
    id: PRODUCT_ID,
    businessId: BUSINESS_ID,
    name: "منتج مرتجع",
    category: "",
    unit: "piece",
    barcode: "",
    purchasePriceMinor: 300,
    salePriceMinor: 800,
    quantityMilli: 10000,
    minQuantityMilli: 0,
    isActive: true,
    updatedAt: now,
    syncStatus: "synced",
    version: 1,
    deletedAt: null
  });

  const saleId = "a1a1a1a1-0000-0000-0000-000000000004";
  const itemId = "b2b2b2b2-0000-0000-0000-000000000004";
  const debtId = options.withDebt
    ? "d3d3d3d3-0000-0000-0000-000000000004"
    : null;

  await db.sales.put({
    id: saleId,
    businessId: BUSINESS_ID,
    saleNumber: "S-2026-0001",
    customerId: CUSTOMER_ID,
    occurredAt: now,
    description: "",
    totalAmountMinor: 16000,
    discountMinor: 0,
    netAmountMinor: 16000,
    paymentMethod: "cash",
    accountId: ACCOUNT_ID,
    paidAmountMinor: options.withDebt ? 8000 : 16000,
    remainingAmountMinor: options.withDebt ? 8000 : 0,
    debtId,
    status: "posted",
    notes: "",
    createdBy: "",
    postedAt: now,
    updatedAt: now,
    syncStatus: "synced",
    version: 1,
    deletedAt: null,
    returnedAmountMinor: 0
  });
  await db.saleItems.put({
    id: itemId,
    businessId: BUSINESS_ID,
    saleId,
    productId: PRODUCT_ID,
    name: "منتج مرتجع",
    quantityMilli: 20000,
    unitPriceMinor: 800,
    totalMinor: 16000,
    lineNote: "",
    returnedMilli: 0
  });
  if (debtId) {
    await db.debts.put({
      id: debtId,
      businessId: BUSINESS_ID,
      direction: "receivable",
      partyId: CUSTOMER_ID,
      sourceType: "sale",
      sourceId: saleId,
      amountMinor: 8000,
      paidAmountMinor: 0,
      remainingAmountMinor: 8000,
      dueDate: null,
      status: "open",
      notes: "",
      createdAt: now,
      updatedAt: now,
      syncStatus: "synced",
      version: 1,
      deletedAt: null
    });
  }
  return { saleId, itemId, debtId };
}

const ctx = { businessId: BUSINESS_ID };

describe("returnSaleItems", () => {
  beforeEach(async () => {
    const db = getDB();
    await Promise.all(db.tables.map((table) => table.clear()));
  });

  it("إرجاع جزئي لفاتورة نقدية: يستعيد المخزون ويُرَدّد كاشاً ويقيد متوازناً", async () => {
    const { saleId, itemId } = await seedSale({ withDebt: false });

    const result = await returnSaleItems(
      {
        saleId,
        lines: [{ saleItemId: itemId, quantityMilli: 5000 }],
        reason: "منتج تالف",
        refundAccountId: ACCOUNT_ID
      },
      ctx
    );

    expect(result.returnMinor).toBe(4000);
    expect(result.refundMinor).toBe(4000);
    expect(result.debtReducedMinor).toBe(0);

    const product = await getDB().products.get(PRODUCT_ID);
    expect(product?.quantityMilli).toBe(15000);

    const item = await getDB().saleItems.get(itemId);
    expect(item?.returnedMilli).toBe(5000);

    const account = await getDB().financialAccounts.get(ACCOUNT_ID);
    expect(account?.currentBalanceMinor).toBe(46000);

    const sale = await getDB().sales.get(saleId);
    expect(sale?.returnedAmountMinor).toBe(4000);

    const lines = await getDB().journalEntryLines
      .where("entryId")
      .equals((await getDB().journalEntries.toArray()).at(-1)!.id)
      .toArray();
    const debit = lines.reduce((sum, line) => sum + line.debitMinor, 0);
    const credit = lines.reduce((sum, line) => sum + line.creditMinor, 0);
    expect(debit).toBe(credit);
    expect(debit).toBe(4000);

    const outbox = await getDB().outbox.toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.opType).toBe("sale.return");
  });

  it("إرجاع لفاتورة بدين: يخفض دين العميل أولاً بلا استرداد نقدي", async () => {
    const { saleId, itemId, debtId } = await seedSale({ withDebt: true });

    const result = await returnSaleItems(
      {
        saleId,
        lines: [{ saleItemId: itemId, quantityMilli: 10000 }],
        reason: "تغيير قرار العميل",
        refundAccountId: ""
      },
      ctx
    );

    expect(result.returnMinor).toBe(8000);
    expect(result.debtReducedMinor).toBe(8000);
    expect(result.refundMinor).toBe(0);

    const debt = await getDB().debts.get(debtId!);
    expect(debt?.amountMinor).toBe(0);
    expect(debt?.remainingAmountMinor).toBe(0);
    expect(debt?.status).toBe("settled");

    const customer = await getDB().customers.get(CUSTOMER_ID);
    expect(customer?.currentBalanceMinor).toBe(0);

    const product = await getDB().products.get(PRODUCT_ID);
    expect(product?.quantityMilli).toBe(20000);
  });

  it("يرفض إرجاعاً فوق المتبقي من الصنف", async () => {
    const { saleId, itemId } = await seedSale({ withDebt: false });

    await expect(
      returnSaleItems(
        {
          saleId,
          lines: [{ saleItemId: itemId, quantityMilli: 30000 }],
          reason: "سبب تجريبي",
          refundAccountId: ACCOUNT_ID
        },
        ctx
      )
    ).rejects.toThrow("تتجاوز المتبقي");
  });

  it("computeReturnSplit يفصل قيمة الدين عن النقد", async () => {
    const { saleId, itemId } = await seedSale({ withDebt: true });
    const split = await computeReturnSplit(saleId, [
      { saleItemId: itemId, quantityMilli: 5000 }
    ]);
    expect(split.returnMinor).toBe(4000);
    expect(split.debtReducedMinor).toBe(4000);
    expect(split.refundMinor).toBe(0);
  });
});
