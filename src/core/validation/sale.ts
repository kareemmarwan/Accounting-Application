import { z } from "zod";
import { toMinor, fromMinor, type Minor } from "@/core/accounting/money";
import type { FinancialAccountRef, SaleOperation } from "@/core/accounting/types";

export const PAYMENT_METHODS = [
  "cash",
  "bank_transfer",
  "palpay",
  "jawwal_pay",
  "electronic",
  "credit"
] as const;

export type SalePaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<SalePaymentMethod, string> = {
  cash: "نقداً",
  bank_transfer: "تحويل بنكي",
  palpay: "PalPay",
  jawwal_pay: "Jawwal Pay",
  electronic: "إلكتروني",
  credit: "آجل"
};

export function saleStatusOf(
  paymentMethod: SalePaymentMethod,
  netMinor: Minor,
  paidMinor: Minor
): "cash" | "mixed" | "credit" {
  if (paymentMethod === "credit") return "credit";
  if (paidMinor >= netMinor) return "cash";
  return "mixed";
}

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

export const saleFormSchema = z
  .object({
    customerId: z
      .union([z.string().uuid("عميل غير صالح"), z.literal("")])
      .optional()
      .default(""),
    occurredAt: z
      .string()
      .min(1, "التاريخ مطلوب")
      .refine(
        (value) => Number.isFinite(Date.parse(value)),
        "تاريخ غير صالح"
      ),
    description: z.string().trim().max(200, "الوصف طويل جداً").default(""),
    totalAmount: amountField("الإجمالي"),
    discount: z
      .union([amountField("الخصم"), z.literal("")])
      .optional()
      .default(""),
    paymentMethod: z.enum(PAYMENT_METHODS, {
      errorMap: () => ({ message: "اختر طريقة الدفع" })
    }),
    accountId: z
      .union([z.string().uuid("حساب غير صالح"), z.literal("")])
      .optional()
      .default(""),
    paidAmount: z
      .union([amountField("المدفوع"), z.literal("")])
      .optional()
      .default(""),
    notes: z.string().trim().max(500, "الملاحظات طويلة جداً").default("")
  })
  .superRefine((data, ctx) => {
    let total = 0;
    let discount = 0;
    let paid = 0;
    try {
      total = toMinor(data.totalAmount);
      discount = data.discount ? toMinor(data.discount) : 0;
      paid = data.paidAmount ? toMinor(data.paidAmount) : 0;
    } catch {
      return;
    }
    const net = total - discount;

    if (discount > total) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discount"],
        message: "الخصم أكبر من إجمالي المبلغ"
      });
    }
    if (net <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["totalAmount"],
        message: "الصافي يجب أن يكون أكبر من صفر"
      });
    }
    if (data.paymentMethod === "credit") {
      if (data.accountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["accountId"],
          message: "البيع الآجل لا يقبل حساب استلام — احذف الحساب أو اجعل الدفع نقدياً"
        });
      }
      if (paid !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["paidAmount"],
          message: "البيع الآجل لا يقبل مبلغاً مدفوعاً"
        });
      }
      if (!data.customerId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customerId"],
          message: "البيع الآجل يتطلب تحديد العميل"
        });
      }
    } else {
      if (paid > net) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["paidAmount"],
          message: "المبلغ المدفوع أكبر من الصافي"
        });
      }
      if (paid === 0 && !data.customerId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["paidAmount"],
          message:
            "طريقة الدفع النقدية تتطلب مبلغاً مدفوعاً، أو اجعلها آجلة مع تحديد العميل"
        });
      }
    }
    if (paid > 0 && !data.accountId && data.paymentMethod !== "credit") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accountId"],
        message: "تحديد الحساب المستلم مطلوب عند وجود مبلغ مدفوع"
      });
    }
    const remaining = net - paid;
    if (remaining > 0 && !data.customerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customerId"],
        message: "الجزء الآجل يتطلب تحديد العميل"
      });
    }
  });

export type SaleFormInput = z.output<typeof saleFormSchema>;

export interface SaleDerived {
  op: SaleOperation;
  netMinor: Minor;
  paidMinor: Minor;
  remainingMinor: Minor;
  status: "cash" | "mixed" | "credit";
}

export function deriveSale(
  input: SaleFormInput,
  saleId: string,
  account?: FinancialAccountRef
): SaleDerived {
  const total = toMinor(input.totalAmount);
  const discount = input.discount ? toMinor(input.discount) : 0;
  const paid = input.paidAmount ? toMinor(input.paidAmount) : 0;
  const net = total - discount;
  const remaining = net - paid;

  const op: SaleOperation = {
    saleId,
    occurredAt: new Date(input.occurredAt).toISOString(),
    customerId: input.customerId || undefined,
    totalAmount: total,
    discount,
    paymentMethod: input.paymentMethod,
    account: input.accountId ? account : undefined,
    paidAmount: paid
  };

  return {
    op,
    netMinor: net,
    paidMinor: paid,
    remainingMinor: remaining,
    status: saleStatusOf(input.paymentMethod, net, paid)
  };
}

export function formatAmountInput(minor: Minor): string {
  return fromMinor(minor);
}
