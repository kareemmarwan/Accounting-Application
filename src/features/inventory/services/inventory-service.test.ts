import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDB } from "@/core/db/db";
import {
  adjustStock,
  createProduct,
  findProductByBarcode,
  isLowStock,
  softDeleteProduct,
  updateProduct
} from "./inventory-service";
import type { ProductFormInput } from "@/core/validation/product";

const BUSINESS_ID = "b1000000-0000-0000-0000-000000000001";

function validInput(overrides: Partial<ProductFormInput> = {}): ProductFormInput {
  return {
    name: "حليب طازج",
    category: "ألبان",
    unit: "piece",
    barcode: "6290123456789",
    purchasePrice: "2.50",
    salePrice: "3.75",
    quantity: "24",
    minQuantity: "6",
    isActive: true,
    ...overrides
  };
}

beforeEach(async () => {
  const db = getDB();
  await db.products.clear();
  await db.outbox.clear();
  await db.inventoryMovements.clear();
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
});

describe("createProduct", () => {
  it("يُنشئ منتجاً مع باركود وصفّ في outbox من نوع product.upsert", async () => {
    const { product, outboxId } = await createProduct(validInput(), {
      businessId: BUSINESS_ID
    });

    expect(product.quantityMilli).toBe(24000);
    expect(product.salePriceMinor).toBe(375);
    expect(product.syncStatus).toBe("pending");

    const op = await getDB().outbox.get(outboxId);
    expect(op?.opType).toBe("product.upsert");
    const payload = op?.payload as { row: { barcode: string; salePriceMinor: number } };
    expect(payload.row.barcode).toBe("6290123456789");
    expect(payload.row.salePriceMinor).toBe(375);
  });

  it("يرفض باركوداً مستخدماً لمنتج آخر", async () => {
    await createProduct(validInput(), { businessId: BUSINESS_ID });
    await expect(
      createProduct(validInput({ name: "جبن" }), { businessId: BUSINESS_ID })
    ).rejects.toThrow("الباركود مستخدم لمنتج آخر");
  });

  it("يرفض مبيعاً أقل من الشراء (Zod)", async () => {
    await expect(
      createProduct(validInput({ salePrice: "2.00" }), { businessId: BUSINESS_ID })
    ).rejects.toThrow();
  });
});

describe("updateProduct", () => {
  it("يحدّث ويرفع النسخة ويضع expectedVersion", async () => {
    const created = await createProduct(validInput(), { businessId: BUSINESS_ID });
    const { product, outboxId } = await updateProduct(
      created.product.id,
      validInput({ name: "حليب كامل الدسم", quantity: "30" }),
      { businessId: BUSINESS_ID }
    );

    expect(product.name).toBe("حليب كامل الدسم");
    expect(product.version).toBe(2);

    const payload = (await getDB().outbox.get(outboxId))?.payload as {
      expectedVersion: number;
    };
    expect(payload.expectedVersion).toBe(1);
  });

  it("يرفض تحديث منتج غير موجود", async () => {
    await expect(
      updateProduct("00000000-0000-0000-0000-0000000000ff", validInput(), {
        businessId: BUSINESS_ID
      })
    ).rejects.toThrow("المنتج غير موجود");
  });
});

describe("softDeleteProduct", () => {
  it("حذف ناعم مع outbox product.soft_delete", async () => {
    const created = await createProduct(validInput(), { businessId: BUSINESS_ID });
    await softDeleteProduct(created.product.id, { businessId: BUSINESS_ID });

    const db = getDB();
    const row = await db.products.get(created.product.id);
    expect(row?.deletedAt).not.toBeNull();

    const op = Array.from(await db.outbox.toArray()).find(
      (item) => item.opType === "product.soft_delete"
    );
    expect(op?.entityId).toBe(created.product.id);
  });
});

describe("adjustStock", () => {
  it("إدخال يزيد الكمية مع حركة و outbox inventory.adjust", async () => {
    const created = await createProduct(validInput(), { businessId: BUSINESS_ID });
    const { product, movement } = await adjustStock(
      {
        productId: created.product.id,
        type: "in",
        quantity: "2.500",
        countedQuantity: "",
        unitCost: "2.50",
        notes: "توريد"
      },
      { businessId: BUSINESS_ID }
    );

    expect(product.quantityMilli).toBe(26500);
    expect(movement.type).toBe("in");
    expect(movement.quantityMilli).toBe(2500);
    expect(movement.unitCostMinor).toBe(250);

    const op = Array.from(await getDB().outbox.toArray()).find(
      (item) => item.opType === "inventory.adjust"
    );
    const payload = op?.payload as { quantityMilli: number; countedQuantityMilli: null };
    expect(payload.quantityMilli).toBe(2500);
    expect(payload.countedQuantityMilli).toBeNull();
  });

  it("إخراج ينقص الكمية", async () => {
    const created = await createProduct(validInput(), { businessId: BUSINESS_ID });
    const { product } = await adjustStock(
      {
        productId: created.product.id,
        type: "out",
        quantity: "1.000",
        countedQuantity: "",
        unitCost: "",
        notes: ""
      },
      { businessId: BUSINESS_ID }
    );
    expect(product.quantityMilli).toBe(23000);
  });

  it("الجرد يضبط الكمية المعدودة ويرسل القيمة الدفترية للتحقق", async () => {
    const created = await createProduct(validInput(), { businessId: BUSINESS_ID });
    const { product } = await adjustStock(
      {
        productId: created.product.id,
        type: "adjust",
        quantity: "",
        countedQuantity: "20.000",
        unitCost: "",
        notes: "جرد"
      },
      { businessId: BUSINESS_ID }
    );
    expect(product.quantityMilli).toBe(20000);

    const payload = (
      Array.from(await getDB().outbox.toArray()).find(
        (item) => item.opType === "inventory.adjust"
      )?.payload
    ) as { expectedQuantityMilli: number; countedQuantityMilli: number };
    expect(payload.expectedQuantityMilli).toBe(24000);
    expect(payload.countedQuantityMilli).toBe(20000);
  });

  it("يرفض جرداً بلا فرق", async () => {
    const created = await createProduct(validInput(), { businessId: BUSINESS_ID });
    await expect(
      adjustStock(
        {
          productId: created.product.id,
          type: "adjust",
          quantity: "",
          countedQuantity: "24.000",
          unitCost: "",
          notes: ""
        },
        { businessId: BUSINESS_ID }
      )
    ).rejects.toThrow("لا فرق للجرد");
  });
});

describe("findProductByBarcode / isLowStock", () => {
  it("يجد المنتج بالباركود ويتجاهل المحذوف", async () => {
    const created = await createProduct(validInput(), { businessId: BUSINESS_ID });
    const found = await findProductByBarcode("6290123456789", BUSINESS_ID);
    expect(found?.id).toBe(created.product.id);

    await softDeleteProduct(created.product.id, { businessId: BUSINESS_ID });
    const after = await findProductByBarcode("6290123456789", BUSINESS_ID);
    expect(after).toBeNull();
  });

  it("isLowStock عند الكمية الدنيا", async () => {
    const created = await createProduct(validInput({ quantity: "6" }), {
      businessId: BUSINESS_ID
    });
    expect(isLowStock(created.product)).toBe(true);
  });
});
