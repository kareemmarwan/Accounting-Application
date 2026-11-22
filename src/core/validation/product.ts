import { z } from "zod";
import { toMinor } from "@/core/accounting/money";
import type { ProductUnit } from "@/core/db/db";

export const PRODUCT_UNITS = [
  "piece",
  "kg",
  "liter",
  "box",
  "meter",
  "other"
] as const;

export const PRODUCT_UNIT_LABELS: Record<ProductUnit, string> = {
  piece: "قطعة",
  kg: "كيلوغرام",
  liter: "لتر",
  box: "صندوق",
  meter: "متر",
  other: "وحدة"
};

export const UNIT_MILLI_LABELS: Record<ProductUnit, string> = {
  piece: "قطعة",
  kg: "كجم",
  liter: "لتر",
  box: "صندوق",
  meter: "متر",
  other: "وحدة"
};

const BARCODE_RE = /^[A-Za-z0-9\-_]{3,32}$/;

const amountField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} مطلوب`)
    .refine(
      (value) => {
        try {
          toMinor(value);
          return true;
        } catch {
          return false;
        }
      },
      `${label} غير صالح — استخدم أرقاماً بكسور من خانتين`
    );

const quantityField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} مطلوب`)
    .refine(
      (value) => Number.isFinite(parseQuantityToMilli(value)),
      `${label} غير صالحة — حتى 3 خانات عشرية`
    );

export const productFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "اسم المنتج مطلوب (حرفان على الأقل)")
      .max(120, "اسم المنتج طويل جداً"),
    category: z.string().trim().max(60, "التصنيف طويل جداً").default(""),
    unit: z.enum(PRODUCT_UNITS, {
      errorMap: () => ({ message: "اختر وحدة القياس" })
    }),
    barcode: z
      .string()
      .trim()
      .max(32, "الباركود طويل جداً")
      .refine(
        (value) => value === "" || BARCODE_RE.test(value),
        "الباركود: أرقام وحروف إنجليزية فقط (3–32)"
      )
      .default(""),
    purchasePrice: amountField("سعر الشراء"),
    salePrice: amountField("سعر البيع"),
    quantity: quantityField("الكمية"),
    minQuantity: quantityField("الكمية الدنيا"),
    isActive: z.boolean().default(true)
  })
  .superRefine((data, ctx) => {
    try {
      const sale = toMinor(data.salePrice);
      const purchase = toMinor(data.purchasePrice);
      if (sale < purchase) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["salePrice"],
          message: "سعر البيع أقل من سعر الشراء — راجع الأسعار"
        });
      }
    } catch {
      return;
    }
  });

export type ProductFormInput = z.output<typeof productFormSchema>;

export function parseQuantityToMilli(input: string): number {
  const normalized = input.trim().replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(normalized)) {
    return Number.NaN;
  }
  const [whole, fraction = ""] = normalized.split(".");
  const padded = fraction.padEnd(3, "0");
  return Number(whole) * 1000 + Number(padded || "0");
}

export function fromMilli(milli: number): string {
  if (!Number.isFinite(milli) || milli < 0) return "0.000";
  const whole = Math.floor(milli / 1000);
  const fraction = String(milli % 1000).padStart(3, "0");
  return `${whole}.${fraction}`;
}

export function formatQuantity(
  milli: number,
  unit: ProductUnit
): string {
  return `${fromMilli(milli)} ${UNIT_MILLI_LABELS[unit] ?? ""}`.trim();
}

export interface ProductRowPayload {
  id: string;
  name: string;
  category: string;
  unit: ProductUnit;
  barcode: string;
  purchasePriceMinor: number;
  salePriceMinor: number;
  quantityMilli: number;
  minQuantityMilli: number;
  isActive: boolean;
}

export function deriveProduct(
  input: ProductFormInput,
  id: string
): ProductRowPayload {
  return {
    id,
    name: input.name,
    category: input.category,
    unit: input.unit,
    barcode: input.barcode,
    purchasePriceMinor: toMinor(input.purchasePrice),
    salePriceMinor: toMinor(input.salePrice),
    quantityMilli: parseQuantityToMilli(input.quantity),
    minQuantityMilli: parseQuantityToMilli(input.minQuantity),
    isActive: input.isActive
  };
}

export function generateBarcode(): string {
  const base = `2${Date.now().toString().slice(-11)}`;
  let digits = base;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const d = Number(digits[i]);
    sum += i % 2 === 0 ? d : d * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  digits += String(check);
  return digits;
}

export const INVENTORY_MOVEMENT_TYPES = ["in", "out", "adjust"] as const;

export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];

export const MOVEMENT_TYPE_LABELS: Record<InventoryMovementType, string> = {
  in: "إدخال مخزون",
  out: "إخراج مخزون",
  adjust: "جرد (تصحيح الكمية)"
};

export const inventoryAdjustSchema = z
  .object({
    productId: z.string().uuid("منتج غير صالح"),
    type: z.enum(INVENTORY_MOVEMENT_TYPES, {
      errorMap: () => ({ message: "اختر نوع حركة المخزون" })
    }),
    quantity: z
      .union([quantityField("الكمية"), z.literal("")])
      .optional()
      .default(""),
    countedQuantity: z
      .union([quantityField("الكمية المعدودة"), z.literal("")])
      .optional()
      .default(""),
    unitCost: z
      .union([amountField("تكلفة الوحدة"), z.literal("")])
      .optional()
      .default(""),
    notes: z.string().trim().max(300, "الملاحظات طويلة جداً").default("")
  })
  .superRefine((data, ctx) => {
    if (data.type === "adjust" && !data.countedQuantity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["countedQuantity"],
        message: "الجرد يتطلب الكمية المعدودة الفعلية"
      });
    }
    if (data.type !== "adjust" && !data.quantity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quantity"],
        message: "كمية الحركة مطلوبة"
      });
    }
    if (data.type === "adjust" && data.quantity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quantity"],
        message: "الجرد يُحدَّث بالكمية المعدودة فقط"
      });
    }
  });

export type InventoryAdjustInput = z.output<typeof inventoryAdjustSchema>;
