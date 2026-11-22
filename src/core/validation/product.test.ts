import { describe, expect, it } from "vitest";
import {
  fromMilli,
  generateBarcode,
  inventoryAdjustSchema,
  parseQuantityToMilli,
  productFormSchema
} from "./product";

describe("parseQuantityToMilli", () => {
  it("يحوّل الكسور حتى 3 خانات", () => {
    expect(parseQuantityToMilli("1")).toBe(1000);
    expect(parseQuantityToMilli("1.5")).toBe(1500);
    expect(parseQuantityToMilli("0.250")).toBe(250);
    expect(parseQuantityToMilli("12.345")).toBe(12345);
  });

  it("يقبل الفاصلة العربية ويرفض القيم غير الصالحة", () => {
    expect(parseQuantityToMilli("1,25")).toBe(1250);
    expect(Number.isNaN(parseQuantityToMilli("1.2500"))).toBe(true);
    expect(Number.isNaN(parseQuantityToMilli("-1"))).toBe(true);
    expect(Number.isNaN(parseQuantityToMilli("abc"))).toBe(true);
    expect(Number.isNaN(parseQuantityToMilli(""))).toBe(true);
  });

  it("fromMilli يعيد صيغة 3 خانات", () => {
    expect(fromMilli(1000)).toBe("1.000");
    expect(fromMilli(250)).toBe("0.250");
    expect(fromMilli(12345)).toBe("12.345");
    expect(fromMilli(0)).toBe("0.000");
  });
});

describe("generateBarcode", () => {
  it("يبني رمزاً رقمياً من 13 خانة بمجموع تحقق EAN", () => {
    const code = generateBarcode();
    expect(code).toMatch(/^2\d{12}$/);
    let sum = 0;
    for (let i = 0; i < 12; i += 1) {
      const digit = Number(code[i]);
      sum += i % 2 === 0 ? digit : digit * 3;
    }
    expect((10 - (sum % 10)) % 10).toBe(Number(code[12]));
  });
});

describe("productFormSchema", () => {
  const base = {
    name: "حليب طازج",
    category: "ألبان",
    unit: "piece",
    barcode: "6290123456789",
    purchasePrice: "2.50",
    salePrice: "3.75",
    quantity: "24",
    minQuantity: "6",
    isActive: true
  };

  it("يقبل نموذجاً صحيحاً", () => {
    const parsed = productFormSchema.safeParse(base);
    expect(parsed.success).toBe(true);
  });

  it("يرفض اسم أقصر من حرفين وباركود غير لائق", () => {
    expect(productFormSchema.safeParse({ ...base, name: "ح" }).success).toBe(false);
    expect(productFormSchema.safeParse({ ...base, barcode: "12" }).success).toBe(false);
    expect(productFormSchema.safeParse({ ...base, barcode: "62901#456" }).success).toBe(false);
  });

  it("يرفض سعر بيع أقل من الشراء", () => {
    const parsed = productFormSchema.safeParse({ ...base, salePrice: "2.00" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toContain("salePrice");
    }
  });
});

describe("inventoryAdjustSchema", () => {
  const pid = "00000000-0000-0000-0000-0000000000aa";

  it("يتطلب كمية مع إدخال/إخراج", () => {
    expect(
      inventoryAdjustSchema.safeParse({ productId: pid, type: "in", quantity: "", countedQuantity: "", unitCost: "", notes: "" }).success
    ).toBe(false);
    expect(
      inventoryAdjustSchema.safeParse({ productId: pid, type: "out", quantity: "2.5", countedQuantity: "", unitCost: "", notes: "" }).success
    ).toBe(true);
  });

  it("يتطلب الكمية المعدودة مع الجرد ويرفض كليهما معاً", () => {
    const adjust = inventoryAdjustSchema.safeParse({
      productId: pid,
      type: "adjust",
      quantity: "",
      countedQuantity: "3.500",
      unitCost: "",
      notes: ""
    });
    expect(adjust.success).toBe(true);

    const both = inventoryAdjustSchema.safeParse({
      productId: pid,
      type: "adjust",
      quantity: "1.000",
      countedQuantity: "3.500",
      unitCost: "",
      notes: ""
    });
    expect(both.success).toBe(false);
  });
});
