import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDB } from "@/core/db/db";
import { createProduct } from "@/features/inventory/services/inventory-service";
import { checkout } from "./pos-service";
import { amendSale } from "./sale-amendment-service";
import type { PosCartLine } from "../cart";

const BUSINESS_ID = "b3000000-0000-0000-0000-000000000001";
const ACCOUNT_ID = "a3000000-0000-0000-0000-000000000001";
const CUSTOMER_ID = "c3000000-0000-0000-0000-000000000001";

let milkId = "";

beforeEach(async () => {
  const db = getDB();
  await Promise.all([
    db.businesses.clear(),
    db.financialAccounts.clear(),
    db.customers.clear(),
    db.products.clear(),
    db.outbox.clear(),
    db.sales.clear(),
    db.saleItems.clear(),
    db.inventoryMovements.clear(),
    db.debts.clear(),
    db.journalEntries.clear(),
    db.journalEntryLines.clear()
  ]);
  await db.businesses.put({
    id: BUSINESS_ID,
    name: "كاشير تعديل",
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
    name: "الصندوق",
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
    name: "عميل التعديل",
    phone: "",
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
  const milk = await createProduct(
    {
      name: "حليب",
      category: "ألبان",
      unit: "piece",
      barcode: "6291111111117",
      purchasePrice: "2.50",
      salePrice: "3.75",
      quantity: "100",
      minQuantity: "5",
      isActive: true
    },
    { businessId: BUSINESS_ID }
  );
  milkId = milk.product.id;
});

function line(overrides: Partial<PosCartLine> = {}): PosCartLine {
  return {
    key: overrides.key ?? `p:${milkId}`,
    productId: overrides.productId ?? milkId,
    name: overrides.name ?? "حليب",
    unit: overrides.unit ?? "piece",
    unitPriceMinor: overrides.unitPriceMinor ?? 375,
    quantityMilli: overrides.quantityMilli ?? 1000,
    lineNote: overrides.lineNote ?? ""
  };
}

const ctx = {
  businessId: BUSINESS_ID,
  accountRef: { id: ACCOUNT_ID, type: "cash" as const }
};

async function createSeedSale() {
  const { result } = await checkout(
    {
      lines: [line({ quantityMilli: 2000 })],
      discountMinor: 0,
      paymentMethod: "cash",
      accountId: ACCOUNT_ID,
      paidAmountMinor: 750,
      customerId: "",
      notes: "",
      requireCustomer: false
    },
    ctx
  );
  return result;
}

describe("amendSale", () => {
  it("يضيف أصنافاً لفاتورة مدفوعة بالكامل: دلتا نقدية بقيد جديد ومخزون منقص", async () => {
    const seed = await createSeedSale();
    const beforeProduct = (await getDB().products.get(milkId))!;

    const { sale, deltaMinor, paidMinor, remainingMinor, addedCount } = await amendSale(
      {
        saleId: seed.sale.id,
        newLines: [line({ quantityMilli: 3000 })],
        paymentMethod: "cash",
        accountId: ACCOUNT_ID,
        paidAmountMinor: 1125,
        customerId: "",
        notes: ""
      },
      ctx
    );

    expect(deltaMinor).toBe(1125);
    expect(paidMinor).toBe(1125);
    expect(remainingMinor).toBe(0);
    expect(addedCount).toBe(1);
    expect(sale.netAmountMinor).toBe(750 + 1125);
    expect(sale.paidAmountMinor).toBe(1875);
    expect(sale.remainingAmountMinor).toBe(0);

    const db = getDB();
    const items = await db.saleItems.where("saleId").equals(seed.sale.id).toArray();
    expect(items).toHaveLength(2);

    const product = (await db.products.get(milkId))!;
    expect(product.quantityMilli).toBe(beforeProduct.quantityMilli - 3000);

    const movements = Array.from(await db.inventoryMovements.toArray());
    expect(movements.filter((movement) => movement.quantityMilli === 3000)).toHaveLength(1);

    const entries = Array.from(await db.journalEntries.toArray());
    expect(entries).toHaveLength(2);
    const lines = Array.from(await db.journalEntryLines.toArray());
    const amendLines = lines.filter((item) => item.entryId === entries[1]!.id);
    const debit = amendLines.reduce((sum, item) => sum + item.debitMinor, 0);
    const credit = amendLines.reduce((sum, item) => sum + item.creditMinor, 0);
    expect(debit).toBe(credit);

    const account = (await db.financialAccounts.get(ACCOUNT_ID))!;
    expect(account.currentBalanceMinor).toBe(100000 + 750 + 1125);

    const op = Array.from(await db.outbox.toArray()).find(
      (item) => item.opType === "sale.add_items"
    );
    expect(op?.entityId).toBe(seed.sale.id);
  });

  it("الإضافة الآجلة ترفع دين الفاتورة وأصله ورصيد العميل", async () => {
    const seed = await createSeedSale();
    const { sale, debt } = await amendSale(
      {
        saleId: seed.sale.id,
        newLines: [line({ quantityMilli: 1000 })],
        paymentMethod: "cash",
        accountId: "",
        paidAmountMinor: 0,
        customerId: CUSTOMER_ID,
        notes: ""
      },
      ctx
    );

    expect(sale.remainingAmountMinor).toBe(375);
    expect(debt).not.toBeNull();
    expect(debt!.amountMinor).toBe(375);
    expect(debt!.remainingAmountMinor).toBe(375);

    const customer = (await getDB().customers.get(CUSTOMER_ID))!;
    expect(customer.currentBalanceMinor).toBe(375);
    expect(customer.totalTransactionsMinor).toBe(375);

    const account = (await getDB().financialAccounts.get(ACCOUNT_ID))!;
    expect(account.currentBalanceMinor).toBe(100750);
  });

  it("الإضافة الآجلة على فاتورة لها دين يرفع أصل الدين نفسه", async () => {
    const { result } = await checkout(
      {
        lines: [line({ quantityMilli: 2000 })],
        discountMinor: 0,
        paymentMethod: "credit",
        accountId: "",
        paidAmountMinor: 0,
        customerId: CUSTOMER_ID,
        notes: "",
        requireCustomer: false
      },
      ctx
    );

    const { sale, debt } = await amendSale(
      {
        saleId: result.sale.id,
        newLines: [line({ quantityMilli: 2000 })],
        paymentMethod: "cash",
        accountId: "",
        paidAmountMinor: 0,
        customerId: "",
        notes: ""
      },
      ctx
    );

    expect(sale.debtId).toBe(result.debt!.id);
    expect(debt!.id).toBe(result.debt!.id);
    expect(debt!.amountMinor).toBe(1500);
    expect(debt!.remainingAmountMinor).toBe(1500);
    expect(debt!.status).toBe("open");
  });

  it("يرفض إضافة على فاتورة ملغاة", async () => {
    const seed = await createSeedSale();
    await getDB().sales.update(seed.sale.id, { status: "void" });
    await expect(
      amendSale(
        {
          saleId: seed.sale.id,
          newLines: [line({})],
          paymentMethod: "cash",
          accountId: ACCOUNT_ID,
          paidAmountMinor: 375,
          customerId: "",
          notes: ""
        },
        ctx
      )
    ).rejects.toThrow("لا إضافة على فاتورة ملغاة");
  });

  it("يرفض جزءاً آجلاً بلا عميل", async () => {
    const seed = await createSeedSale();
    await expect(
      amendSale(
        {
          saleId: seed.sale.id,
          newLines: [line({})],
          paymentMethod: "cash",
          accountId: "",
          paidAmountMinor: 0,
          customerId: "",
          notes: ""
        },
        ctx
      )
    ).rejects.toThrow("الجزء الآجل يتطلب تحديد العميل");
  });

  it("نقد أكثر من قيمة الإضافة يُسجل بقيمة الإضافة (كاش باك)", async () => {
    const seed = await createSeedSale();
    const { paidMinor } = await amendSale(
      {
        saleId: seed.sale.id,
        newLines: [line({})],
        paymentMethod: "cash",
        accountId: ACCOUNT_ID,
        paidAmountMinor: 1000,
        customerId: "",
        notes: ""
      },
      ctx
    );
    expect(paidMinor).toBe(375);
  });
});
