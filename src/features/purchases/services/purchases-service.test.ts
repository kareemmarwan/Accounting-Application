import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDB } from "@/core/db/db";
import type { PurchaseFormInput } from "@/core/validation/purchase";
import {
  createPurchase,
  type CreatePurchaseContext
} from "./purchases-service";

const BUSINESS_ID = "b0000000-0000-0000-0000-000000000002";
const ACCOUNT_ID = "a0000000-0000-0000-0000-000000000002";
const SUPPLIER_ID = "d0000000-0000-0000-0000-000000000002";
const PRODUCT_ID = "60000000-0000-0000-0000-000000000002";

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
  await db.suppliers.put({
    id: SUPPLIER_ID,
    businessId: BUSINESS_ID,
    name: "مورد تجريبي",
    phone: "0598123456",
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
  await db.products.put({
    id: PRODUCT_ID,
    businessId: BUSINESS_ID,
    name: "زيت طهير",
    category: "مواد غذائية",
    unit: "liter",
    barcode: "",
    purchasePriceMinor: 500,
    salePriceMinor: 700,
    quantityMilli: 10000,
    minQuantityMilli: 2000,
    isActive: true,
    updatedAt: new Date().toISOString(),
    syncStatus: "synced",
    version: 1,
    deletedAt: null
  });
}

const ctx: CreatePurchaseContext = {
  businessId: BUSINESS_ID,
  accountRef: { id: ACCOUNT_ID, type: "cash" }
};

function validInput(
  overrides: Partial<{ [K in keyof PurchaseFormInput]: PurchaseFormInput[K] }> = {}
): PurchaseFormInput {
  return {
    supplierId: "",
    occurredAt: new Date("2026-01-15T10:00:00Z").toISOString(),
    description: "شراء تجريبي",
    totalAmount: "300.00",
    discount: "",
    paymentMethod: "cash",
    accountId: ACCOUNT_ID,
    paidAmount: "300.00",
    transferReference: "",
    notes: "",
    items: [],
    ...overrides
  };
}

describe("createPurchase", () => {
  beforeEach(async () => {
    const db = getDB();
    await Promise.all(db.tables.map((table) => table.clear()));
    await seed();
  });

  it("شراء نقدي كامل: يخصم رصيد الصندوق ويقيد على 5900 متوازناً", async () => {
    const result = await createPurchase(validInput(), ctx);

    expect(result.purchase.netAmountMinor).toBe(30000);
    expect(result.purchase.remainingAmountMinor).toBe(0);
    expect(result.debt).toBeNull();

    const account = await getDB().financialAccounts.get(ACCOUNT_ID);
    expect(account?.currentBalanceMinor).toBe(70000);
    expect(account?.totalWithdrawalsMinor).toBe(30000);

    const lines = await getDB()
      .journalEntryLines.where("entryId")
      .equals(result.entry.id)
      .toArray();
    const debit = lines.reduce((sum, line) => sum + line.debitMinor, 0);
    const credit = lines.reduce((sum, line) => sum + line.creditMinor, 0);
    expect(debit).toBe(credit);
    expect(debit).toBe(30000);
    expect(lines.find((line) => line.glCode === "5900")?.debitMinor).toBe(30000);
    expect(lines.find((line) => line.glCode === "1100")?.creditMinor).toBe(30000);

    const outboxItems = await getDB().outbox.toArray();
    expect(outboxItems).toHaveLength(1);
    expect(outboxItems[0]?.opType).toBe("purchase.create");
    expect(outboxItems[0]?.entityId).toBe(result.purchase.id);
  });

  it("شراء آجل: لا يخصم أي حساب مالي ويُنشئ ديناً على المورد", async () => {
    const result = await createPurchase(
      validInput({
        supplierId: SUPPLIER_ID,
        paymentMethod: "credit",
        accountId: "",
        paidAmount: ""
      }),
      { businessId: BUSINESS_ID }
    );

    expect(result.purchase.paidAmountMinor).toBe(0);
    expect(result.purchase.remainingAmountMinor).toBe(30000);
    expect(result.purchase.accountId).toBeNull();
    expect(result.debt?.direction).toBe("payable");
    expect(result.debt?.remainingAmountMinor).toBe(30000);

    const account = await getDB().financialAccounts.get(ACCOUNT_ID);
    expect(account?.currentBalanceMinor).toBe(100000);

    const supplier = await getDB().suppliers.get(SUPPLIER_ID);
    expect(supplier?.currentBalanceMinor).toBe(30000);
    expect(supplier?.totalTransactionsMinor).toBe(30000);

    const lines = await getDB()
      .journalEntryLines.where("entryId")
      .equals(result.entry.id)
      .toArray();
    const apLine = lines.find((line) => line.glCode === "2100");
    expect(apLine?.creditMinor).toBe(30000);
    expect(apLine?.partyId).toBe(SUPPLIER_ID);
    expect(
      lines.filter((line) => line.financialAccountId !== null)
    ).toHaveLength(0);
  });

  it("شراء مختلط: خصم المدفوع فقط + دين بالفرق", async () => {
    const result = await createPurchase(
      validInput({ supplierId: SUPPLIER_ID, paidAmount: "100.00" }),
      ctx
    );

    expect(result.purchase.paidAmountMinor).toBe(10000);
    expect(result.purchase.remainingAmountMinor).toBe(20000);

    const account = await getDB().financialAccounts.get(ACCOUNT_ID);
    expect(account?.currentBalanceMinor).toBe(90000);

    const supplier = await getDB().suppliers.get(SUPPLIER_ID);
    expect(supplier?.currentBalanceMinor).toBe(20000);
  });

  it("يرفض المبلغ المدفوع الأكبر من الصافي", async () => {
    await expect(
      createPurchase(validInput({ paidAmount: "500.00" }), ctx)
    ).rejects.toThrow();
  });

  it("يرفض آجلاً مع مدفوع", async () => {
    await expect(
      createPurchase(
        validInput({
          supplierId: SUPPLIER_ID,
          paymentMethod: "credit",
          accountId: "",
          paidAmount: "10.00"
        }),
        { businessId: BUSINESS_ID }
      )
    ).rejects.toThrow();
  });

  it("يرفض نقدياً بلا حساب دفع", async () => {
    await expect(
      createPurchase(validInput({ accountId: "" }), ctx)
    ).rejects.toThrow();
  });

  it("يرفقات الفاتورة: يحفظ blob وmeta ويربطها بالفاتورة", async () => {
    const file = new File(["invoice-data"], "invoice.png", {
      type: "image/png"
    });
    const result = await createPurchase(
      validInput(),
      { ...ctx, receiptFile: file }
    );

    expect(result.receiptAttachmentId).toBe(result.purchase.receiptAttachmentId);

    const meta = await getDB().attachmentsMeta.get(result.receiptAttachmentId!);
    expect(meta?.entityType).toBe("purchases");
    expect(meta?.entityId).toBe(result.purchase.id);
    expect(meta?.mimeType).toBe("image/png");
    expect(meta?.storagePath.startsWith(BUSINESS_ID)).toBe(true);

    const blob = await getDB().attachmentBlobs.get(result.receiptAttachmentId!);
    expect(blob).toBeDefined();
    expect(await blob!.blob.text()).toBe("invoice-data");
  });

  it("يرفض ملفاً أكبر من 10 ميغابايت", async () => {
    const bigFile = new File([new ArrayBuffer(10 * 1024 * 1024 + 1)], "big.png", {
      type: "image/png"
    });
    await expect(
      createPurchase(validInput(), { ...ctx, receiptFile: bigFile })
    ).rejects.toThrow("حجم الملف أكبر من الحد المسموح (10 ميغابايت)");
  });

  it("ترقيم مؤقت L- وsyncStatus=pending ووزن مختلط مرجع التحويل", async () => {
    const result = await createPurchase(
      validInput({
        paymentMethod: "bank_transfer",
        transferReference: "TRX-2026-0007"
      }),
      ctx
    );
    expect(result.purchase.purchaseNumber).toMatch(/^L-[0-9a-f]{8}$/);
    expect(result.purchase.syncStatus).toBe("pending");
    expect(result.purchase.transferReference).toBe("TRX-2026-0007");
  });

  it("شراء بأصناف: يرفع مخزون المنتج محلياً ويسجل حركة 'in' ويرفق الأصناف بالحمولة", async () => {
    const result = await createPurchase(
      validInput({
        description: "شراء بضائع بأصناف",
        totalAmount: "150.00",
        paidAmount: "150.00",
        items: [
          {
            productId: PRODUCT_ID,
            name: "زيت طهير",
            quantityMilli: 20000,
            unitPriceMinor: 500,
            totalMinor: 10000
          },
          {
            productId: null,
            name: "كراتين متنوعة",
            quantityMilli: 50000,
            unitPriceMinor: 100,
            totalMinor: 5000
          }
        ]
      }),
      ctx
    );

    const product = await getDB().products.get(PRODUCT_ID);
    expect(product?.quantityMilli).toBe(30000);

    const movements = await getDB().inventoryMovements
      .where("refId")
      .equals(result.purchase.id)
      .toArray();
    expect(movements).toHaveLength(1);
    expect(movements[0]?.type).toBe("in");
    expect(movements[0]?.refType).toBe("purchase");
    expect(movements[0]?.quantityMilli).toBe(20000);

    const outboxItems = await getDB().outbox.toArray();
    expect(outboxItems).toHaveLength(1);
    const payload = outboxItems[0]?.payload as {
      items?: Array<{ productId: string | null; quantityMilli: number }>;
    };
    expect(payload.items).toHaveLength(2);
    expect(payload.items?.[0]?.productId).toBe(PRODUCT_ID);
    expect(payload.items?.[1]?.productId).toBeNull();
  });

  it("يرفض أصنافاً مجموعها لا يطابق الإجمالي", async () => {
    await expect(
      createPurchase(
        validInput({
          totalAmount: "150.00",
          paidAmount: "150.00",
          items: [
            {
              productId: PRODUCT_ID,
              name: "زيت طهير",
              quantityMilli: 20000,
              unitPriceMinor: 500,
              totalMinor: 10000
            }
          ]
        }),
        ctx
      )
    ).rejects.toThrow("مجموع الأصناف لا يطابق الإجمالي");
  });
});
