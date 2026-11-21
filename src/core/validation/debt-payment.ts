import { z } from "zod";
import { toMinor, type Minor } from "@/core/accounting/money";
import type { CashPaymentMethod } from "@/core/accounting/types";
import { PAYMENT_METHODS } from "./sale";

export const CASH_PAYMENT_METHODS = PAYMENT_METHODS.filter(
  (method) => method !== "credit"
) as [CashPaymentMethod, ...CashPaymentMethod[]];

export const DEBT_PAYMENT_METHOD_LABELS: Record<CashPaymentMethod, string> = {
  cash: "نقداً",
  bank_transfer: "تحويل بنكي",
  palpay: "PalPay",
  jawwal_pay: "Jawwal Pay",
  electronic: "إلكتروني"
};

const amountField = z
  .string()
  .trim()
  .min(1, "مبلغ الدفعة مطلوب")
  .refine(
    (value) => {
      try {
        return toMinor(value) > 0;
      } catch {
        return false;
      }
    },
    "مبلغ الدفعة يجب أن يكون أكبر من صفر"
  );

export const debtPaymentFormSchema = z.object({
  debtId: z.string().uuid("دين غير صالح"),
  amount: amountField,
  occurredAt: z
    .string()
    .min(1, "التاريخ مطلوب")
    .refine((value) => Number.isFinite(Date.parse(value)), "تاريخ غير صالح"),
  paymentMethod: z.enum(CASH_PAYMENT_METHODS, {
    errorMap: () => ({ message: "اختر طريقة الدفع" })
  }),
  accountId: z.string().uuid("حساب الاستلام/الدفع مطلوب"),
  notes: z.string().trim().max(500, "الملاحظات طويلة جداً").default("")
});

export type DebtPaymentFormInput = z.output<typeof debtPaymentFormSchema>;

export interface DebtPaymentDerived {
  amountMinor: Minor;
}

export function deriveDebtPayment(
  input: DebtPaymentFormInput
): DebtPaymentDerived {
  return { amountMinor: toMinor(input.amount) };
}
