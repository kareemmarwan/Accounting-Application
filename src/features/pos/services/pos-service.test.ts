import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDB } from "@/core/db/db";
import { createProduct } from "@/features/inventory/services/inventory-service";
import { checkout } from "./pos-service";
import type { PosCartLine } from "../cart";

const BUSINESS_ID = "b2000000-0000-0000-0000-000000000001";
const ACCOUNT_ID = "a2000000-0000-0000-0000-000000000001";
const CUSTOMER_ID = "c2000000-0000-0000-0000-000000000001";

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
    db.debts.clear()
  ]);
  await db.businesses.put({
    id: BUSINESS_ID,
    name: "سوبرماركت تجريبي",
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
    name: "صندوق الكاشير",
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
    name: "عميل الكاشير",
    phone: "",
    whatsapp: "",
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
      barcode: "6290000000017",
      purchasePrice: "2.50",
      salePrice: "3.75",
      quantity: "10",
      minQuantity: "2",
      isActive: true
    },
    { businessId: BUSINESS_ID }
  );
  milkId = milk.product.id;
});

function cartLine(overrides: Partial<PosCartLine> = {}): PosCartLine {
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

async function productRow() {
  return getDB().products.get(milkId);
}

describe("checkout — نقدي كامل", () => {
  it("يُنشئ بيعاً بسطور وحركة مخزون وخصم من الصندوق", async () => {
    const { result, netMinor } = await checkout(
      {
        lines: [cartLine({ quantityMilli: 3000 })],
        discountMinor: 0,
        paymentMethod: "cash",
        accountId: ACCOUNT_ID,
        paidAmountMinor: 1125,
        customerId: "",
        notes: "",
        requireCustomer: false
      },
      ctx
    );

    expect(netMinor).toBe(1125);
    expect(result.sale.totalAmountMinor).toBe(1125);
    expect(result.sale.paidAmountMinor).toBe(1125);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.quantityMilli).toBe(3000);

    const db = getDB();
    const items = await db.saleItems.where("saleId").equals(result.sale.id).toArray();
    expect(items).toHaveLength(1);
    expect(items[0]!.totalMinor).toBe(1125);

    const product = await productRow();
    expect(product!.quantityMilli).toBe(7000);

    const movement = (await db.inventoryMovements.toArray())[0]!;
    expect(movement.type).toBe("out");
    expect(movement.quantityMilli).toBe(3000);
    expect(movement.refType).toBe("sale");

    const account = (await db.financialAccounts.get(ACCOUNT_ID))!;
    expect(account!.currentBalanceMinor).toBe(101125);

    const op = Array.from(await db.outbox.toArray()).find(
      (item) => item.opType === "sale.create"
    );
    const payload = op?.payload as {
      items: Array<{ quantityMilli: number; productId: string }>;
    };
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]!.productId).toBe(milkId);
    expect(payload.items[0]!.quantityMilli).toBe(3000);
  });

  it("وزن بنصف كيلو: 0.750 كجم × 12.00 = 9.00", async () => {
    await createProduct(
      {
        name: "عنب",
        category: "فواكه",
        unit: "kg",
        barcode: "6290000000024",
        purchasePrice: "8.00",
        salePrice: "12.00",
        quantity: "50",
        minQuantity: "5",
        isActive: true
      },
      { businessId: BUSINESS_ID }
    );

    const { netMinor } = await checkout(
      {
        lines: [
          {
            key: "p:grapes",
            productId: null,
            name: "عنب",
            unit: "kg",
            unitPriceMinor: 1200,
            quantityMilli: 750,
            lineNote: ""
          }
        ],
        discountMinor: 0,
        paymentMethod: "cash",
        accountId: ACCOUNT_ID,
        paidAmountMinor: 900,
        customerId: "",
        notes: "",
        requireCustomer: false
      },
      ctx
    );

    expect(netMinor).toBe(900);
  });
});

describe("checkout — آجل ومختلط وخصم", () => {
  it("آجل يتطلب عميلاً وينشئ ديناً دون حركة نقدية", async () => {
    const { result } = await checkout(
      {
        lines: [cartLine({ quantityMilli: 2000 })],
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

    expect(result.debt).not.toBeNull();
    expect(result.debt!.remainingAmountMinor).toBe(750);

    const account = (await getDB().financialAccounts.get(ACCOUNT_ID))!;
    expect(account!.currentBalanceMinor).toBe(100000);
  });

  it("يرفض آجلاً بلا عميل", async () => {
    await expect(
      checkout(
        {
          lines: [cartLine({})],
          discountMinor: 0,
          paymentMethod: "credit",
          accountId: "",
          paidAmountMinor: 0,
          customerId: "",
          notes: "",
          requireCustomer: false
        },
        ctx
      )
    ).rejects.toThrow("البيع الآجل يتطلب تحديد العميل");
  });

  it("مختلط: مدفوع جزئي والباقي على العميل", async () => {
    const { result } = await checkout(
      {
        lines: [cartLine({ quantityMilli: 4000 })],
        discountMinor: 0,
        paymentMethod: "cash",
        accountId: ACCOUNT_ID,
        paidAmountMinor: 1000,
        customerId: CUSTOMER_ID,
        notes: "",
        requireCustomer: false
      },
      ctx
    );

    expect(result.sale.paidAmountMinor).toBe(1000);
    expect(result.sale.remainingAmountMinor).toBe(500);
    expect(result.debt!.amountMinor).toBe(500);

    const account = (await getDB().financialAccounts.get(ACCOUNT_ID))!;
    expect(account!.currentBalanceMinor).toBe(101000);
  });

  it("الخصم ينزل على الصافي", async () => {
    const { netMinor } = await checkout(
      {
        lines: [cartLine({ quantityMilli: 2000 })],
        discountMinor: 100,
        paymentMethod: "cash",
        accountId: ACCOUNT_ID,
        paidAmountMinor: 650,
        customerId: "",
        notes: "",
        requireCustomer: false
      },
      ctx
    );
    expect(netMinor).toBe(650);
  });
});

describe("checkout — الحراسات", () => {
  it("يرفض سلة فارغة", async () => {
    await expect(
      checkout(
        {
          lines: [],
          discountMinor: 0,
          paymentMethod: "cash",
          accountId: ACCOUNT_ID,
          paidAmountMinor: 0,
          customerId: "",
          notes: "",
          requireCustomer: false
        },
        ctx
      )
    ).rejects.toThrow("الفاتورة فارغة");
  });

  it("يرفض عميلاً إلزامياً للمتاجر التي تشترطه", async () => {
    await expect(
      checkout(
        {
          lines: [cartLine({})],
          discountMinor: 0,
          paymentMethod: "cash",
          accountId: ACCOUNT_ID,
          paidAmountMinor: 375,
          customerId: "",
          notes: "",
          requireCustomer: true
        },
        ctx
      )
    ).rejects.toThrow("يتطلب تحديد العميل");
  });

  it("نقد مستلم أكثر من الصافي: يُسجل الصافي والباقي للعميل (كاش باك)", async () => {
    const { result } = await checkout(
      {
        lines: [cartLine({})],
        discountMinor: 0,
        paymentMethod: "cash",
        accountId: ACCOUNT_ID,
        paidAmountMinor: 5000,
        customerId: "",
        notes: "",
        requireCustomer: false
      },
      ctx
    );
    expect(result.sale.paidAmountMinor).toBe(375);
    expect(result.sale.remainingAmountMinor).toBe(0);

    const account = (await getDB().financialAccounts.get(ACCOUNT_ID))!;
    expect(account.currentBalanceMinor).toBe(100375);
  });

  it("يرفض دفعة زائدة في طرق الدفع غير النقدية", async () => {
    await expect(
      checkout(
        {
          lines: [cartLine({})],
          discountMinor: 0,
          paymentMethod: "palpay",
          accountId: ACCOUNT_ID,
          paidAmountMinor: 5000,
          customerId: "",
          notes: "",
          requireCustomer: false
        },
        ctx
      )
    ).rejects.toThrow("المبلغ المدفوع أكبر من الصافي");
  });

  it("لا يخصم مخزون منتج نفدت كيمته (0)", async () => {
    await createProduct(
      {
        name: "خدمة توصيل",
        category: "خدمات",
        unit: "other",
        barcode: "6290000000031",
        purchasePrice: "0.00",
        salePrice: "10.00",
        quantity: "0",
        minQuantity: "0",
        isActive: true
      },
      { businessId: BUSINESS_ID }
    );

    await checkout(
      {
        lines: [
          {
            key: "p:service",
            productId: null,
            name: "خدمة توصيل",
            unit: "other",
            unitPriceMinor: 1000,
            quantityMilli: 1000,
            lineNote: ""
          }
        ],
        discountMinor: 0,
        paymentMethod: "cash",
        accountId: ACCOUNT_ID,
        paidAmountMinor: 1000,
        customerId: "",
        notes: "",
        requireCustomer: false
      },
      ctx
    );

    const movements = Array.from(await getDB().inventoryMovements.toArray());
    expect(movements).toHaveLength(0);
  });
});
