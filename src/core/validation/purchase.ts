import { z } from "zod";
import { toMinor, type Minor } from "@/core/accounting/money";
import type { PurchaseOperation } from "@/core/accounting/types";
import {
  PAYMENT_METHODS,
  type SalePaymentMethod
} from "./sale";

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

export const TRANSFER_METHODS: SalePaymentMethod[] = [
  "bank_transfer",
  "palpay",
  "jawwal_pay"
];

export const purchaseFormSchema = z
  .object({
    supplierId: z
      .union([z.string().uuid("مورد غير صالح"), z.literal("")])
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
    transferReference: z.string().trim().max(60, "رقم التحويل طويل جداً").default(""),
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
          message: "الشراء الآجل لا يخصم أي حساب مالي — الدفع فقط يحرك الرصيد"
        });
      }
      if (paid !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["paidAmount"],
          message: "الشراء الآجل لا يقبل مبلغاً مدفوعاً"
        });
      }
      if (!data.supplierId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["supplierId"],
          message: "الشراء الآجل يتطلب تحديد المورد"
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
      if (paid === 0 && !data.supplierId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["paidAmount"],
          message:
            "طريقة الدفع النقدية تتطلب مبلغاً مدفوعاً، أو اجعلها آجلة مع تحديد المورد"
        });
      }
      if (paid > 0 && !data.accountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["accountId"],
          message: "تحديد حساب الدفع مطلوب عند وجود مبلغ مدفوع"
        });
      }
    }

    const remaining = net - paid;
    if (remaining > 0 && !data.supplierId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supplierId"],
        message: "الجزء الآجل يتطلب تحديد المورد"
      });
    }
  });

export type PurchaseFormInput = z.output<typeof purchaseFormSchema>;

export interface PurchaseDerived {
  op: PurchaseOperation;
  netMinor: Minor;
  paidMinor: Minor;
  remainingMinor: Minor;
  status: "cash" | "mixed" | "credit";
}

function purchaseStatusOf(
  paymentMethod: SalePaymentMethod,
  netMinor: Minor,
  paidMinor: Minor
): "cash" | "mixed" | "credit" {
  if (paymentMethod === "credit") return "credit";
  if (paidMinor >= netMinor) return "cash";
  return "mixed";
}

export function derivePurchase(
  input: PurchaseFormInput,
  purchaseId: string,
  account?: PurchaseOperation["account"]
): PurchaseDerived {
  const total = toMinor(input.totalAmount);
  const discount = input.discount ? toMinor(input.discount) : 0;
  const paid = input.paidAmount ? toMinor(input.paidAmount) : 0;
  const net = total - discount;
  const remaining = net - paid;

  const op: PurchaseOperation = {
    purchaseId,
    occurredAt: new Date(input.occurredAt).toISOString(),
    supplierId: input.supplierId || undefined,
    totalAmount: total,
    discount,
    paymentMethod: input.paymentMethod,
    account: input.accountId ? account : undefined,
    paidAmount: paid,
    inventoryEnabled: false
  };

  return {
    op,
    netMinor: net,
    paidMinor: paid,
    remainingMinor: remaining,
    status: purchaseStatusOf(input.paymentMethod, net, paid)
  };
}
