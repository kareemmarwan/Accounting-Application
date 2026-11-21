import { z } from "zod";
import { toMinor, type Minor } from "@/core/accounting/money";
import type { CashPaymentMethod } from "@/core/accounting/types";
import { CASH_PAYMENT_METHODS, DEBT_PAYMENT_METHOD_LABELS } from "./debt-payment";

export const EXPENSE_METHOD_LABELS = DEBT_PAYMENT_METHOD_LABELS;

const amountField = z
  .string()
  .trim()
  .min(1, "مبلغ المصروف مطلوب")
  .refine(
    (value) => {
      try {
        return toMinor(value) > 0;
      } catch {
        return false;
      }
    },
    "مبلغ المصروف يجب أن يكون أكبر من صفر"
  );

export const expenseFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, "عنوان المصروف مطلوب (حرفان على الأقل)")
    .max(100, "العنوان طويل جداً"),
  categoryId: z.string().uuid("اختر تصنيف المصروف"),
  amount: amountField,
  occurredAt: z
    .string()
    .min(1, "التاريخ مطلوب")
    .refine((value) => Number.isFinite(Date.parse(value)), "تاريخ غير صالح"),
  paymentMethod: z.enum(CASH_PAYMENT_METHODS, {
    errorMap: () => ({ message: "اختر طريقة الدفع" })
  }),
  accountId: z.string().uuid("حساب الدفع مطلوب"),
  notes: z.string().trim().max(500, "الملاحظات طويلة جداً").default("")
});

export type ExpenseFormInput = z.output<typeof expenseFormSchema>;

export interface ExpenseDerived {
  amountMinor: Minor;
  paymentMethod: CashPaymentMethod;
}

export function deriveExpense(input: ExpenseFormInput): ExpenseDerived {
  return {
    amountMinor: toMinor(input.amount),
    paymentMethod: input.paymentMethod
  };
}
