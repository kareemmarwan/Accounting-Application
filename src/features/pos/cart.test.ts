import { describe, expect, it } from "vitest";
import {
  cartTotals,
  lineTotalMinor,
  newCartLine,
  validateCart,
  type PosCartLine
} from "./cart";

function line(overrides: Partial<PosCartLine> = {}): PosCartLine {
  return {
    key: overrides.key ?? "k1",
    productId: overrides.productId ?? "p1",
    name: overrides.name ?? "حليب",
    unit: overrides.unit ?? "piece",
    unitPriceMinor: overrides.unitPriceMinor ?? 375,
    quantityMilli: overrides.quantityMilli ?? 1000,
    lineNote: overrides.lineNote ?? ""
  };
}

describe("lineTotalMinor", () => {
  it("يحسب الكمية × السعر بالألف", () => {
    expect(lineTotalMinor(line({ quantityMilli: 1000, unitPriceMinor: 375 }))).toBe(375);
    expect(lineTotalMinor(line({ quantityMilli: 250, unitPriceMinor: 1200 }))).toBe(300);
    expect(lineTotalMinor(line({ quantityMilli: 1500, unitPriceMinor: 995 }))).toBe(1493);
  });
});

describe("cartTotals", () => {
  it("يجمع السطور ويخصم المحدود", () => {
    const totals = cartTotals(
      [
        line({ unitPriceMinor: 1000, quantityMilli: 2000 }),
        line({ unitPriceMinor: 500, quantityMilli: 500 })
      ],
      250
    );
    expect(totals.subtotalMinor).toBe(2250);
    expect(totals.discountMinor).toBe(250);
    expect(totals.netMinor).toBe(2000);
  });

  it("يحدّ الخصم إلى المجموع ولا يجعل الصافي سالباً", () => {
    const totals = cartTotals([line({ unitPriceMinor: 1000, quantityMilli: 1000 })], 5000);
    expect(totals.discountMinor).toBe(1000);
    expect(totals.netMinor).toBe(0);
  });
});

describe("validateCart", () => {
  it("يرفض السلة الفارغة والكميات الصفرية والصافي الصفري", () => {
    expect(validateCart([], 0).ok).toBe(false);
    expect(validateCart([line({ quantityMilli: 0 })], 0).ok).toBe(false);
    expect(validateCart([line({ quantityMilli: 1000, unitPriceMinor: 0 })], 0).ok).toBe(false);
    expect(validateCart([line({})], 400).ok).toBe(false);
  });

  it("يقبل سلة صحيحة", () => {
    const validation = validateCart([line({})], 100);
    expect(validation.ok).toBe(true);
    expect(validation.error).toBeNull();
  });
});

describe("newCartLine", () => {
  it("كل مسحة سطر مستقل بمفتاح فريد — حذف سطر لا يمس الآخرين", () => {
    const product = { id: "p9", name: "محارم", unit: "piece" as const, salePriceMinor: 500 };
    const first = newCartLine(product, 1000);
    const second = newCartLine(product, 1000);
    expect(first.key).not.toBe(second.key);
    expect(first.quantityMilli).toBe(1000);
    expect(second.quantityMilli).toBe(1000);
  });

  it("المفتاح يحمل الملاحظة لتمييز الأسطر المشابهة", () => {
    const product = { id: "p8", name: "قميص", unit: "piece" as const, salePriceMinor: 5000 };
    const withNote = newCartLine(product, 1000, "أحمر");
    expect(withNote.key).toContain("أحمر");
    expect(withNote.unitPriceMinor).toBe(5000);
  });
});
