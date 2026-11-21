import { z } from "zod";

export const CONTACT_TYPES = ["customer", "supplier"] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  customer: "عميل",
  supplier: "مورد"
};

export const contactFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "الاسم مطلوب — حرفان على الأقل")
    .max(120, "الاسم طويل جداً"),
  phone: z
    .union([z.string().trim().min(3, "الهاتف قصير جداً").max(24, "الهاتف طويل جداً"), z.literal("")])
    .optional()
    .default(""),
  address: z.string().trim().max(200, "العنوان طويل جداً").default(""),
  notes: z.string().trim().max(500, "الملاحظات طويلة جداً").default("")
});

export type ContactFormInput = z.output<typeof contactFormSchema>;

export const manualDebtSchema = z.object({
  partyId: z.string().uuid("جهة غير صالحة"),
  amount: z
    .string()
    .trim()
    .min(1, "المبلغ مطلوب")
    .refine(
      (value) => {
        if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(value)) return false;
        const parts = value.split(".");
        const intPart = Number(parts[0]);
        const frac = parts[1] ? Number(parts[1].padEnd(2, "0")) : 0;
        return intPart * 100 + frac > 0;
      },
      "المبلغ يجب أن يكون أكبر من صفر"
    ),
  occurredAt: z
    .string()
    .min(1, "التاريخ مطلوب")
    .refine((value) => Number.isFinite(Date.parse(value)), "تاريخ غير صالح"),
  notes: z.string().trim().max(300, "الملاحظات طويلة جداً").default("")
});

export type ManualDebtInput = z.output<typeof manualDebtSchema>;
