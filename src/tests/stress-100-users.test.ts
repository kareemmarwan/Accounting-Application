import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { getDB } from "@/core/db/db";
import { createProduct } from "@/features/inventory/services/inventory-service";
import { checkout } from "@/features/pos/services/pos-service";
import { createExpense } from "@/features/expenses/services/expenses-service";

const OPENING_MINOR = 100000;

interface MerchantIds {
  businessId: string;
  accountId: string;
  customerId: string;
  categoryId: string;
  productId: string;
}

function uuid(index: number, salt: string): string {
  const base = index.toString(16).padStart(12, "0");
  return `${salt}${base}`;
}

async function seedMerchant(index: number): Promise<MerchantIds> {
  const db = getDB();
  const now = new Date().toISOString();
  const businessId = uuid(index, "a0000000-0000-0000-0000-");
  const accountId = uuid(index, "b0000000-0000-0000-0000-");
  const customerId = uuid(index, "c0000000-0000-0000-0000-");
  const categoryId = uuid(index, "d0000000-0000-0000-0000-");

  await db.businesses.put({
    id: businessId,
    name: `متجر التاجر ${index + 1}`,
    businessType: "grocery",
    ownerId: uuid(index, "e0000000-0000-0000-0000-"),
    currency: "ILS",
    phone: null,
    plan: "free",
    createdAt: now,
    updatedAt: now,
    version: 1
  });
  await db.financialAccounts.put({
    id: accountId,
    businessId,
    name: "الصندوق الرئيسي",
    type: "cash",
    provider: null,
    currency: "ILS",
    openingBalanceMinor: OPENING_MINOR,
    currentBalanceMinor: OPENING_MINOR,
    totalDepositsMinor: OPENING_MINOR,
    totalWithdrawalsMinor: 0,
    isActive: true,
    updatedAt: now,
    syncStatus: "synced",
    version: 1,
    deletedAt: null
  });
  await db.customers.put({
    id: customerId,
    businessId,
    name: "عميل التجار الجماعي",
    phone: "0599000000",
    whatsapp: "",
    address: "",
    notes: "",
    currentBalanceMinor: 0,
    totalTransactionsMinor: 0,
    lastTransactionAt: null,
    updatedAt: now,
    syncStatus: "synced",
    version: 1,
    deletedAt: null
  });
  await db.expenseCategories.put({
    id: categoryId,
    businessId,
    name: "كهرباء",
    glCode: "5110",
    isSystem: true,
    sortOrder: 20
  });

  const { product } = await createProduct(
    {
      name: `منتج التاجر ${index + 1}`,
      category: "عام",
      unit: "piece",
      barcode: `629${(index + 1).toString().padStart(10, "0")}`,
      purchasePrice: "0.50",
      salePrice: "1.00",
      quantity: "1000",
      minQuantity: "10",
      isActive: true
    },
    { businessId }
  );

  return { businessId, accountId, customerId, categoryId, productId: product.id };
}

async function runMerchantCycle(ids: MerchantIds): Promise<void> {
  const ctx = {
    businessId: ids.businessId,
    accountRef: { id: ids.accountId, type: "cash" as const }
  };

  const line = (quantity: number, productId = ids.productId) => ({
    key: `${productId}-${quantity}`,
    productId,
    name: "منتج",
    unit: "piece" as const,
    unitPriceMinor: 1000,
    quantityMilli: quantity * 1000,
    lineNote: ""
  });

  await checkout(
    {
      lines: [line(10)],
      discountMinor: 0,
      paymentMethod: "cash",
      accountId: ids.accountId,
      paidAmountMinor: 10000,
      customerId: "",
      notes: "",
      requireCustomer: false
    },
    ctx
  );

  await checkout(
    {
      lines: [line(40)],
      discountMinor: 0,
      paymentMethod: "credit",
      accountId: "",
      paidAmountMinor: 0,
      customerId: ids.customerId,
      notes: "",
      requireCustomer: false
    },
    ctx
  );

  await checkout(
    {
      lines: [line(100)],
      discountMinor: 0,
      paymentMethod: "cash",
      accountId: ids.accountId,
      paidAmountMinor: 60000,
      customerId: ids.customerId,
      notes: "",
      requireCustomer: false
    },
    ctx
  );

  await createExpense(
    {
      title: "فاتورة كهرباء",
      categoryId: ids.categoryId,
      amount: "15.00",
      occurredAt: new Date().toISOString(),
      paymentMethod: "cash",
      accountId: ids.accountId,
      notes: ""
    },
    {
      businessId: ids.businessId,
      accountRef: { id: ids.accountId, type: "cash" as const }
    }
  );
}

async function collectEntriesIntegrity(): Promise<{
  entries: number;
  balanced: boolean;
  totalDebit: number;
  totalCredit: number;
}> {
  const db = getDB();
  const entries = await db.journalEntries.toArray();
  const lines = await db.journalEntryLines.toArray();
  const byEntry = new Map<string, { debit: number; credit: number }>();
  for (const line of lines) {
    const bucket = byEntry.get(line.entryId) ?? { debit: 0, credit: 0 };
    bucket.debit += line.debitMinor;
    bucket.credit += line.creditMinor;
    byEntry.set(line.entryId, bucket);
  }
  let balanced = true;
  let totalDebit = 0;
  let totalCredit = 0;
  for (const [entryId, bucket] of Array.from(byEntry.entries())) {
    totalDebit += bucket.debit;
    totalCredit += bucket.credit;
    if (bucket.debit !== bucket.credit || bucket.debit === 0) {
      balanced = false;
      console.error(`قيد غير متوازن: ${entryId}`, bucket);
    }
  }
  return { entries: entries.length, balanced, totalDebit, totalCredit };
}

describe("ضغط 100 مستخدم", () => {
  it(
    "100 تاجر مستقل: دورة كاملة (منتج + 3 فواتير + مصروف) على دفعات متوازية — كل الأرصدة والقيود والـoutbox صحيحة",
    { timeout: 300000 },
    async () => {
      const started = Date.now();
      const ids: MerchantIds[] = [];
      const BATCH = 10;
      for (let batch = 0; batch < 100 / BATCH; batch += 1) {
        const batchIds = await Promise.all(
          Array.from({ length: BATCH }, (_, offset) =>
            seedMerchant(batch * BATCH + offset)
          )
        );
        ids.push(...batchIds);

        await Promise.all(batchIds.map((merchantIds) => runMerchantCycle(merchantIds)));
      }
      const elapsed = Date.now() - started;

      const db = getDB();
      const [businessCount, saleRows, productRows, outboxRows, customerRows, accountRows] =
        await Promise.all([
          db.businesses.count(),
          db.sales.toArray(),
          db.products.toArray(),
          db.outbox.toArray(),
          db.customers.toArray(),
          db.financialAccounts.toArray()
        ]);

      expect(businessCount).toBe(100);
      expect(saleRows.length).toBe(300);
      expect(productRows.length).toBe(100);
      expect(outboxRows.length).toBe(500);
      expect(new Set(saleRows.map((row) => row.id)).size).toBe(300);
      expect(new Set(outboxRows.map((row) => row.id)).size).toBe(500);
      expect(saleRows.every((row) => row.paidAmountMinor <= row.netAmountMinor)).toBe(true);
      expect(saleRows.every((row) => row.status === "posted")).toBe(true);

      for (const merchant of ids) {
        const account = accountRows.find((row) => row.id === merchant.accountId);
        expect(account?.currentBalanceMinor).toBe(168500);
        const customer = customerRows.find((row) => row.id === merchant.customerId);
        expect(customer?.currentBalanceMinor).toBe(80000);
        const product = productRows.find((row) => row.id === merchant.productId);
        expect(product?.quantityMilli).toBe(850000);
      }

      const integrity = await collectEntriesIntegrity();
      expect(integrity.balanced).toBe(true);
      expect(integrity.entries).toBe(400);

      const outboxOps = new Map<string, number>();
      for (const op of outboxRows) {
        outboxOps.set(op.opType, (outboxOps.get(op.opType) ?? 0) + 1);
      }
      expect(outboxOps.get("sale.create")).toBe(300);
      expect(outboxOps.get("expense.create")).toBe(100);
      expect(outboxOps.get("product.upsert")).toBe(100);

      console.log(
        `⏱️ 100 تاجر × 5 عمليات = 500 عملية في ${elapsed}ms (${Math.round(500000 / elapsed)} عملية/ثانية)`
      );
    }
  );

  it(
    "عاصفة الكاشير: 30 فاتورة متزامنة على مشروع واحد — صفر فقدان وصفر تعارض مخزون",
    { timeout: 120000 },
    async () => {
      const db = getDB();
      const now = new Date().toISOString();
      const businessId = uuid(999, "f0000000-0000-0000-0000-");
      const accountId = uuid(999, "a1000000-0000-0000-0000-");
      await db.businesses.put({
        id: businessId,
        name: "سوبرماركت العاصفة",
        businessType: "supermarket",
        ownerId: uuid(999, "e1000000-0000-0000-0000-"),
        currency: "ILS",
        phone: null,
        plan: "pro",
        createdAt: now,
        updatedAt: now,
        version: 1
      });
      await db.financialAccounts.put({
        id: accountId,
        businessId,
        name: "صندوق العاصفة",
        type: "cash",
        provider: null,
        currency: "ILS",
        openingBalanceMinor: 0,
        currentBalanceMinor: 0,
        totalDepositsMinor: 0,
        totalWithdrawalsMinor: 0,
        isActive: true,
        updatedAt: now,
        syncStatus: "synced",
        version: 1,
        deletedAt: null
      });

      const products: Array<{ id: string; name: string }> = [];
      for (let p = 0; p < 10; p += 1) {
        const { product } = await createProduct(
          {
            name: `صنف العاصفة ${p + 1}`,
            category: "عام",
            unit: "piece",
            barcode: `6299${p.toString().padStart(9, "0")}`,
            purchasePrice: "0.50",
            salePrice: "1.00",
            quantity: "500",
            minQuantity: "10",
            isActive: true
          },
          { businessId }
        );
        products.push({ id: product.id, name: product.name });
      }

      const sales = await Promise.all(
        Array.from({ length: 30 }, (_, sale) => {
          const product = products[sale % products.length]!;
          return checkout(
            {
              lines: [
                {
                  key: `${product.id}-${sale}`,
                  productId: product.id,
                  name: product.name,
                  unit: "piece",
                  unitPriceMinor: 1000,
                  quantityMilli: 1000,
                  lineNote: ""
                }
              ],
              discountMinor: 0,
              paymentMethod: "cash",
              accountId,
              paidAmountMinor: 1000,
              customerId: "",
              notes: "",
              requireCustomer: false
            },
            { businessId, accountRef: { id: accountId, type: "cash" } }
          );
        })
      );

      expect(sales.length).toBe(30);
      expect(new Set(sales.map((sale) => sale.result.sale.id)).size).toBe(30);

      const [saleCount, outboxRows, account] = await Promise.all([
        db.sales.where("businessId").equals(businessId).count(),
        db.outbox.where("businessId").equals(businessId).toArray(),
        db.financialAccounts.get(accountId)
      ]);
      expect(saleCount).toBe(30);
      expect(outboxRows.filter((op) => op.opType === "sale.create").length).toBe(30);
      expect(outboxRows.filter((op) => op.opType === "product.upsert").length).toBe(10);
      expect(account?.currentBalanceMinor).toBe(30000);

      for (const product of products) {
        const row = await db.products.get(product.id);
        expect(row?.quantityMilli).toBe(497000);
      }

      const integrity = await collectEntriesIntegrity();
      expect(integrity.balanced).toBe(true);
    }
  );

  it(
    "عاصفة العمليات الخاطئة: 20 فاتورة غير صالحة متزامنة تُرفض كلها بلا أي أثر جزئي",
    { timeout: 120000 },
    async () => {
      const db = getDB();
      const now = new Date().toISOString();
      const businessId = uuid(998, "f2000000-0000-0000-0000-");
      const accountId = uuid(998, "a2000000-0000-0000-0000-");
      await db.businesses.put({
        id: businessId,
        name: "متجر الرفض",
        businessType: "grocery",
        ownerId: uuid(998, "e2000000-0000-0000-0000-"),
        currency: "ILS",
        phone: null,
        plan: "free",
        createdAt: now,
        updatedAt: now,
        version: 1
      });
      await db.financialAccounts.put({
        id: accountId,
        businessId,
        name: "الصندوق",
        type: "cash",
        provider: null,
        currency: "ILS",
        openingBalanceMinor: OPENING_MINOR,
        currentBalanceMinor: OPENING_MINOR,
        totalDepositsMinor: OPENING_MINOR,
        totalWithdrawalsMinor: 0,
        isActive: true,
        updatedAt: now,
        syncStatus: "synced",
        version: 1,
        deletedAt: null
      });

      const outcomes = await Promise.all(
        Array.from({ length: 20 }, () =>
          checkout(
            {
              lines: [
                {
                  key: "bad",
                  productId: null,
                  name: "صنف غير متتبع",
                  unit: "piece",
                  unitPriceMinor: 1000,
                  quantityMilli: 1000,
                  lineNote: ""
                }
              ],
              discountMinor: 0,
              paymentMethod: "electronic",
              accountId,
              paidAmountMinor: 5000,
              customerId: "",
              notes: "",
              requireCustomer: false
            },
            { businessId, accountRef: { id: accountId, type: "cash" } }
          ).then(
            () => "resolved",
            (error: unknown) => (error instanceof Error ? error.message : "خطأ")
          )
        )
      );

      expect(outcomes.every((message) => message.includes("أكبر من الصافي"))).toBe(true);

      const [saleCount, outboxCount, lineCount, account] = await Promise.all([
        db.sales.where("businessId").equals(businessId).count(),
        db.outbox.where("businessId").equals(businessId).count(),
        db.journalEntryLines.where("businessId").equals(businessId).count(),
        db.financialAccounts.get(accountId)
      ]);
      expect(saleCount).toBe(0);
      expect(outboxCount).toBe(0);
      expect(lineCount).toBe(0);
      expect(account?.currentBalanceMinor).toBe(OPENING_MINOR);
    }
  );
});
