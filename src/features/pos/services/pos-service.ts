import type { PaymentMethod } from "@/core/accounting/types";
import { fromMinor } from "@/core/accounting/money";
import { cartTotals, validateCart, type PosCartLine } from "@/features/pos/cart";
import { createSale, type CreateSaleResult } from "@/features/sales/services/sales-service";

export interface CheckoutInput {
  lines: PosCartLine[];
  discountMinor: number;
  paymentMethod: PaymentMethod;
  accountId: string;
  paidAmountMinor: number;
  customerId: string;
  notes: string;
  requireCustomer: boolean;
}

export interface CheckoutContext {
  businessId: string;
  accountRef?: { id: string; type: "cash" | "bank" | "wallet" | "other" };
  createdBy?: string;
}

function validatePayment(
  input: CheckoutInput,
  netMinor: number
): string | null {
  const { paymentMethod, paidAmountMinor, customerId } = input;
  if (paymentMethod === "credit") {
    if (input.accountId) {
      return "البيع الآجل لا يقبل حساب استلام";
    }
    if (paidAmountMinor !== 0) {
      return "البيع الآجل لا يقبل مبلغاً مدفوعاً";
    }
    if (!customerId) {
      return "البيع الآجل يتطلب تحديد العميل";
    }
    return null;
  }
  if (paidAmountMinor > netMinor && paymentMethod !== "cash") {
    return "المبلغ المدفوع أكبر من الصافي";
  }
  const paid = Math.min(Math.max(0, paidAmountMinor), netMinor);
  const remaining = netMinor - paid;
  if (paid > 0 && !input.accountId) {
    return "حدد الحساب المستلم للمبلغ المدفوع";
  }
  if (remaining > 0 && !customerId) {
    return "الجزء الآجل يتطلب تحديد العميل";
  }
  return null;
}

export async function checkout(
  input: CheckoutInput,
  ctx: CheckoutContext
): Promise<{ result: CreateSaleResult; netMinor: number }> {
  const validation = validateCart(input.lines, input.discountMinor);
  if (!validation.ok) {
    throw new Error(validation.error ?? "الفاتورة غير صالحة");
  }

  const totals = cartTotals(input.lines, input.discountMinor);
  const paymentError = validatePayment(input, totals.netMinor);
  if (paymentError) {
    throw new Error(paymentError);
  }
  if (input.requireCustomer && !input.customerId) {
    throw new Error("هذا المتجر يتطلب تحديد العميل لكل فاتورة");
  }

  const paidMinor = Math.min(
    Math.max(0, input.paidAmountMinor),
    totals.netMinor
  );

  const result = await createSale(
    {
      customerId: input.customerId,
      occurredAt: new Date().toISOString(),
      description: `بيع كاشير — ${input.lines.length} صنف`,
      totalAmount: fromMinor(totals.subtotalMinor),
      discount: totals.discountMinor > 0 ? fromMinor(totals.discountMinor) : "",
      paymentMethod: input.paymentMethod,
      accountId: input.accountId,
      paidAmount: paidMinor > 0 ? fromMinor(paidMinor) : "",
      notes: input.notes
    },
    {
      businessId: ctx.businessId,
      accountRef: input.accountId ? ctx.accountRef : undefined,
      createdBy: ctx.createdBy,
      items: input.lines.map((line) => ({
        id: crypto.randomUUID(),
        productId: line.productId,
        name: line.name,
        quantityMilli: line.quantityMilli,
        unitPriceMinor: line.unitPriceMinor,
        totalMinor: Math.round((line.quantityMilli * line.unitPriceMinor) / 1000),
        lineNote: line.lineNote
      }))
    }
  );

  return { result, netMinor: totals.netMinor };
}
