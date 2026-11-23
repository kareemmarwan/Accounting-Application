import type { Minor } from "@/core/accounting/money";
import type { ProductUnit } from "@/core/db/db";

export interface PosCartLine {
  key: string;
  productId: string | null;
  name: string;
  unit: ProductUnit;
  unitPriceMinor: Minor;
  quantityMilli: number;
  lineNote: string;
}

export interface PosCartTotals {
  subtotalMinor: Minor;
  discountMinor: Minor;
  netMinor: Minor;
}

export function lineTotalMinor(line: PosCartLine): Minor {
  return Math.round((line.quantityMilli * line.unitPriceMinor) / 1000);
}

export function cartTotals(
  lines: PosCartLine[],
  discountMinor: Minor
): PosCartTotals {
  const subtotalMinor = lines.reduce((sum, line) => sum + lineTotalMinor(line), 0);
  const boundedDiscount = Math.max(0, Math.min(discountMinor, subtotalMinor));
  return {
    subtotalMinor,
    discountMinor: boundedDiscount,
    netMinor: subtotalMinor - boundedDiscount
  };
}

export interface CartValidation {
  ok: boolean;
  error: string | null;
}

export function validateCart(
  lines: PosCartLine[],
  discountMinor: Minor
): CartValidation {
  if (lines.length === 0) {
    return { ok: false, error: "الفاتورة فارغة — أضف صنفاً واحداً على الأقل" };
  }
  const badLine = lines.find(
    (line) => !Number.isInteger(line.quantityMilli) || line.quantityMilli <= 0
  );
  if (badLine) {
    return { ok: false, error: `كمية «${badLine.name}» غير صالحة` };
  }
  const badPrice = lines.find((line) => !Number.isInteger(line.unitPriceMinor) || line.unitPriceMinor < 0);
  if (badPrice) {
    return { ok: false, error: `سعر «${badPrice.name}» غير صالح` };
  }
  const totals = cartTotals(lines, discountMinor);
  if (totals.subtotalMinor <= 0) {
    return { ok: false, error: "إجمالي الفاتورة يجب أن يكون أكبر من صفر" };
  }
  if (totals.netMinor <= 0) {
    return { ok: false, error: "الخصم أكبر من إجمالي الفاتورة" };
  }
  return { ok: true, error: null };
}

let lineSeq = 0;

export function nextLineKey(productId: string, lineNote: string): string {
  lineSeq += 1;
  return lineNote
    ? `p:${productId}#${lineSeq}:${lineNote}`
    : `p:${productId}#${lineSeq}`;
}

export function newCartLine(
  product: {
    id: string;
    name: string;
    unit: ProductUnit;
    salePriceMinor: Minor;
  },
  quantityMilli: number,
  lineNote = ""
): PosCartLine {
  return {
    key: nextLineKey(product.id, lineNote),
    productId: product.id,
    name: product.name,
    unit: product.unit,
    unitPriceMinor: product.salePriceMinor,
    quantityMilli,
    lineNote
  };
}
