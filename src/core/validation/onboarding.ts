import { z } from "zod";
import { toMinor } from "@/core/accounting/money";

export const BUSINESS_TYPES = [
  "grocery",
  "restaurant",
  "clothing",
  "food",
  "produce",
  "electronics",
  "trade",
  "services",
  "other"
] as const;

export type BusinessTypeValue = (typeof BUSINESS_TYPES)[number];

export const BUSINESS_TYPE_LABELS: Record<BusinessTypeValue, string> = {
  grocery: "بقالة / ميني ماركت",
  restaurant: "مطعم / كافيتريا",
  clothing: "ملابس وأحذية",
  food: "مواد غذائية",
  produce: "خضار وفواكه",
  electronics: "أجهزة وإلكترونيات",
  trade: "تجارة عامة",
  services: "خدمات",
  other: "أخرى"
};

export const ACCOUNT_PROVIDERS = [
  "bank_palestine",
  "palpay",
  "jawwal_pay",
  "other"
] as const;

export type AccountProviderValue = (typeof ACCOUNT_PROVIDERS)[number];

export const ACCOUNT_PROVIDER_LABELS: Record<AccountProviderValue, string> = {
  bank_palestine: "بنك فلسطين",
  palpay: "PalPay",
  jawwal_pay: "Jawwal Pay",
  other: "أخرى"
};

export const CURRENCIES = ["ILS", "USD", "JOD"] as const;

const nameSchema = z
  .string()
  .trim()
  .min(2, "الاسم مطلوب (حرفان على الأقل)")
  .max(80, "الاسم طويل جداً");

const amountSchema = z
  .string()
  .trim()
  .min(1, "المبلغ مطلوب")
  .refine(
    (value) => {
      try {
        return toMinor(value) >= 0;
      } catch {
        return false;
      }
    },
    "مبلغ غير صالح — استخدم أرقاماً بكسور من خانتين"
  );

export const ownerStepSchema = z.object({ ownerName: nameSchema });

export const businessNameStepSchema = z.object({
  businessName: z
    .string()
    .trim()
    .min(2, "اسم المشروع مطلوب (حرفان على الأقل)")
    .max(120, "اسم المشروع طويل جداً")
});

export const businessStepSchema = z.object({
  businessName: z
    .string()
    .trim()
    .min(2, "اسم المشروع مطلوب (حرفان على الأقل)")
    .max(120, "اسم المشروع طويل جداً"),
  businessType: z.enum(BUSINESS_TYPES, {
    errorMap: () => ({ message: "اختر نوع النشاط" })
  })
});

export const currencyStepSchema = z.object({
  currency: z.enum(CURRENCIES, {
    errorMap: () => ({ message: "اختر العملة" })
  })
});

export const cashAccountStepSchema = z.object({
  cashName: nameSchema,
  cashOpeningBalance: amountSchema
});

export const bankAccountStepSchema = z.object({
  bankName: z.union([nameSchema, z.literal("")]),
  bankType: z.enum(["bank", "wallet", "other"]).optional(),
  bankProvider: z.enum(ACCOUNT_PROVIDERS).optional(),
  bankOpeningBalance: z.union([amountSchema, z.literal("")]).optional()
});

export const customerStepSchema = z.object({
  customerName: z.union([nameSchema, z.literal("")]),
  customerPhone: z
    .string()
    .trim()
    .max(20, "رقم الهاتف طويل جداً")
    .refine(
      (value) => value === "" || /^[+\d][\d\s-]{5,19}$/.test(value),
      "رقم هاتف غير صالح"
    )
});

export const supplierStepSchema = z.object({
  supplierName: z.union([nameSchema, z.literal("")]),
  supplierPhone: z
    .string()
    .trim()
    .max(20, "رقم الهاتف طويل جداً")
    .refine(
      (value) => value === "" || /^[+\d][\d\s-]{5,19}$/.test(value),
      "رقم هاتف غير صالح"
    )
});

const optionalParty = z
  .object({ name: z.string().trim(), phone: z.string().trim() })
  .nullable();

export const onboardingSchema = z.object({
  ownerName: nameSchema,
  businessName: z.string().trim().min(2).max(120),
  businessType: z.enum(BUSINESS_TYPES),
  currency: z.enum(CURRENCIES),
  cashAccount: z.object({
    name: nameSchema,
    openingBalanceMinor: z.number().int().nonnegative()
  }),
  bankAccount: z
    .object({
      name: nameSchema,
      type: z.enum(["bank", "wallet", "other"]),
      provider: z.string().trim().max(40).nullable(),
      openingBalanceMinor: z.number().int().nonnegative()
    })
    .nullable(),
  firstCustomer: optionalParty,
  firstSupplier: optionalParty
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;
