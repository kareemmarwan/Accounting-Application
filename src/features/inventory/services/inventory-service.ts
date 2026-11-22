import { toMinor } from "@/core/accounting/money";
import { getDB, type LocalProduct, type LocalInventoryMovement, type MusaedDB } from "@/core/db/db";
import { enqueueOp, newId, nowIso } from "@/core/db/repositories";
import {
  deriveProduct,
  inventoryAdjustSchema,
  parseQuantityToMilli,
  productFormSchema,
  type InventoryAdjustInput,
  type ProductFormInput
} from "@/core/validation/product";

export interface ProductContext {
  businessId: string;
  createdBy?: string;
}

export interface ProductOperationResult {
  product: LocalProduct;
  outboxId: string;
}

export async function createProduct(
  input: ProductFormInput,
  ctx: ProductContext,
  db: MusaedDB = getDB()
): Promise<ProductOperationResult> {
  const parsed = productFormSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "بيانات المنتج غير صالحة");
  }

  const productId = newId();
  const createdAt = nowIso();
  const row = deriveProduct(parsed.data, productId);

  const product: LocalProduct = {
    ...row,
    businessId: ctx.businessId,
    updatedAt: createdAt,
    syncStatus: "pending",
    version: 1,
    deletedAt: null
  };

  const existing = row.barcode
    ? await db.products
        .filter(
          (candidate) =>
            candidate.businessId === ctx.businessId &&
            candidate.barcode === row.barcode &&
            !candidate.deletedAt
        )
        .first()
    : undefined;
  if (existing) {
    throw new Error("الباركود مستخدم لمنتج آخر");
  }

  const outboxId = await db.transaction(
    "rw",
    [db.products, db.outbox],
    async () => {
      await db.products.put(product);
      return enqueueOp({
        db,
        businessId: ctx.businessId,
        opType: "product.upsert",
        entityType: "products",
        entityId: productId,
        payload: {
          clientOpId: productId,
          createdAt,
          entityType: "products",
          row
        }
      });
    }
  );

  return { product, outboxId };
}

export async function updateProduct(
  productId: string,
  input: ProductFormInput,
  ctx: ProductContext,
  db: MusaedDB = getDB()
): Promise<ProductOperationResult> {
  const parsed = productFormSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "بيانات المنتج غير صالحة");
  }

  const existing = await db.products.get(productId);
  if (!existing || existing.deletedAt) {
    throw new Error("المنتج غير موجود");
  }
  if (existing.businessId !== ctx.businessId) {
    throw new Error("المنتج لا ينتمي لهذا المشروع");
  }

  const row = deriveProduct(parsed.data, productId);
  if (row.barcode) {
    const duplicate = await db.products
      .filter(
        (candidate) =>
          candidate.businessId === ctx.businessId &&
          candidate.barcode === row.barcode &&
          candidate.id !== productId &&
          !candidate.deletedAt
      )
      .first();
    if (duplicate) {
      throw new Error("الباركود مستخدم لمنتج آخر");
    }
  }

  const updatedAt = nowIso();
  const updated: LocalProduct = {
    ...existing,
    ...row,
    updatedAt,
    syncStatus: existing.syncStatus === "synced" ? "pending" : existing.syncStatus,
    version: existing.version + 1
  };

  const outboxId = await db.transaction(
    "rw",
    [db.products, db.outbox],
    async () => {
      await db.products.put(updated);
      return enqueueOp({
        db,
        businessId: ctx.businessId,
        opType: "product.upsert",
        entityType: "products",
        entityId: productId,
        payload: {
          clientOpId: newId(),
          createdAt: updatedAt,
          entityType: "products",
          row,
          expectedVersion: existing.version
        }
      });
    }
  );

  return { product: updated, outboxId };
}

export async function softDeleteProduct(
  productId: string,
  ctx: ProductContext,
  db: MusaedDB = getDB()
): Promise<void> {
  const existing = await db.products.get(productId);
  if (!existing || existing.deletedAt) {
    throw new Error("المنتج غير موجود");
  }
  if (existing.businessId !== ctx.businessId) {
    throw new Error("المنتج لا ينتمي لهذا المشروع");
  }

  const updatedAt = nowIso();
  const deleted: LocalProduct = {
    ...existing,
    deletedAt: updatedAt,
    updatedAt,
    syncStatus: existing.syncStatus === "synced" ? "pending" : existing.syncStatus,
    version: existing.version + 1
  };

  await db.transaction("rw", [db.products, db.outbox], async () => {
    await db.products.put(deleted);
    await enqueueOp({
      db,
      businessId: ctx.businessId,
      opType: "product.soft_delete",
      entityType: "products",
      entityId: productId,
      payload: {
        clientOpId: newId(),
        createdAt: updatedAt,
        entityType: "products",
        entityId: productId
      }
    });
  });
}

export async function adjustStock(
  input: InventoryAdjustInput,
  ctx: ProductContext,
  db: MusaedDB = getDB()
): Promise<{ movement: LocalInventoryMovement; product: LocalProduct }> {
  const parsed = inventoryAdjustSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "بيانات حركة المخزون غير صالحة");
  }
  const data = parsed.data;

  const product = await db.products.get(data.productId);
  if (!product || product.deletedAt) {
    throw new Error("المنتج غير موجود");
  }
  if (product.businessId !== ctx.businessId) {
    throw new Error("المنتج لا ينتمي لهذا المشروع");
  }

  const occurredAt = nowIso();
  let quantityMilli = 0;
  let countedQuantityMilli: number | null = null;
  let expectedQuantityMilli: number | null = null;

  if (data.type === "adjust") {
    const counted = parseQuantityToMilli(data.countedQuantity);
    if (counted === product.quantityMilli) {
      throw new Error("الكمية المعدودة مطابقة للكمية الدفترية — لا فرق للجرد");
    }
    quantityMilli = Math.abs(counted - product.quantityMilli);
    countedQuantityMilli = counted;
    expectedQuantityMilli = product.quantityMilli;
  } else {
    quantityMilli = parseQuantityToMilli(data.quantity);
  }

  const movement: LocalInventoryMovement = {
    id: newId(),
    businessId: ctx.businessId,
    productId: product.id,
    type: data.type,
    quantityMilli,
    unitCostMinor: data.unitCost ? toMinor(data.unitCost) : null,
    refType: "inventory_adjust",
    refId: product.id,
    occurredAt,
    notes: data.notes,
    createdBy: ctx.createdBy ?? ""
  };

  let updatedProduct: LocalProduct;
  switch (data.type) {
    case "in":
      updatedProduct = {
        ...product,
        quantityMilli: product.quantityMilli + quantityMilli
      };
      break;
    case "out":
      updatedProduct = {
        ...product,
        quantityMilli: product.quantityMilli - quantityMilli
      };
      break;
    case "adjust":
      updatedProduct = {
        ...product,
        quantityMilli: countedQuantityMilli ?? product.quantityMilli
      };
      break;
  }
  updatedProduct = {
    ...updatedProduct,
    updatedAt: occurredAt,
    syncStatus: updatedProduct.syncStatus === "synced" ? "pending" : updatedProduct.syncStatus,
    version: updatedProduct.version + 1
  };

  await db.transaction(
    "rw",
    [db.products, db.inventoryMovements, db.outbox],
    async () => {
      await db.products.put(updatedProduct);
      await db.inventoryMovements.put(movement);
      await enqueueOp({
        db,
        businessId: ctx.businessId,
        opType: "inventory.adjust",
        entityType: "inventory_movements",
        entityId: movement.id,
        payload: {
          clientOpId: movement.id,
          createdAt: occurredAt,
          productId: product.id,
          type: data.type,
          quantityMilli,
          countedQuantityMilli,
          expectedQuantityMilli,
          unitCostMinor: movement.unitCostMinor,
          refType: movement.refType,
          refId: movement.refId,
          occurredAt,
          notes: data.notes
        }
      });
    }
  );

  return { movement, product: updatedProduct };
}

export async function findProductByBarcode(
  barcode: string,
  businessId: string,
  db: MusaedDB = getDB()
): Promise<LocalProduct | null> {
  const normalized = barcode.trim();
  if (!normalized) return null;
  const indexed = await db.products
    .where("barcode")
    .equals(normalized)
    .filter(
      (product) =>
        product.businessId === businessId && !product.deletedAt
    )
    .first();
  if (indexed) return indexed;
  const match = await db.products
    .filter(
      (product) =>
        product.businessId === businessId &&
        product.barcode.toLowerCase() === normalized.toLowerCase() &&
        !product.deletedAt
    )
    .first();
  return match ?? null;
}

export function isLowStock(product: LocalProduct): boolean {
  return product.quantityMilli <= product.minQuantityMilli;
}

export async function listActiveProducts(
  businessId: string,
  db: MusaedDB = getDB()
): Promise<LocalProduct[]> {
  const all = await db.products
    .filter(
      (product) => product.businessId === businessId && !product.deletedAt
    )
    .toArray();
  return all.sort((a, b) => a.name.localeCompare(b.name, "ar"));
}
