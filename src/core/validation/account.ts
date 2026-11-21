import { z } from "zod";
import { toMinor, type Minor } from "@/core/accounting/money";
import type { AccountType } from "@/core/accounting/types";

export const ACCOUNT_TYPES = [
  "cash",
  "bank",
  "wallet",
  "other"
] as const satisfies readonly AccountType[];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  cash: "صندوق نقدي",
  bank: "حساب بنكي",
  wallet: "محفظة إلكترونية",
  other: "أخرى"
};

export const ACCOUNT_PROVIDERS = [
  "bank_palestine",
  "palpay",
  "jawwal_pay",
  "other"
] as const;

export const ACCOUNT_PROVIDER_LABELS: Record<string, string> = {
  bank_palestine: "بنك فلسطين",
  palpay: "PalPay",
  jawwal_pay: "Jawwal Pay",
  other: "أخرى"
};

export function accountRequiresProvider(type: AccountType): boolean {
  return type === "bank" || type === "wallet";
}

const nameField = z
  .string()
  .trim()
  .min(2, "اسم الحساب مطلوب (حرفان على الأقل)")
  .max(80, "اسم الحساب طويل جداً");

const providerField = z
  .union([z.enum(ACCOUNT_PROVIDERS), z.literal(""), z.null()])
  .optional();

const occurredAtField = z
  .string()
  .min(1, "التاريخ مطلوب")
  .refine((value) => Number.isFinite(Date.parse(value)), "تاريخ غير صالح");

const notesField = z
  .string()
  .trim()
  .max(300, "الملاحظات طويلة جداً")
  .default("");

const openingBalanceField = z
  .string()
  .trim()
  .default("0.00")
  .refine(
    (value) => {
      if (value === "") return true;
      try {
        return toMinor(value) >= 0;
      } catch {
        return false;
      }
    },
    "الرصيد الافتتاحي يجب أن يكون رقماً صحيحاً غير سالب"
  );

export const financialAccountFormSchema = z
  .object({
    name: nameField,
    type: z.enum(ACCOUNT_TYPES, {
      errorMap: () => ({ message: "اختر نوع الحساب" })
    }),
    provider: providerField,
    openingBalance: openingBalanceField
  })
  .refine(
    (data) =>
      !accountRequiresProvider(data.type) ||
      (data.provider != null && data.provider !== ""),
    {
      message: "اختر المزود للحسابات البنكية والمحافظ",
      path: ["provider"]
    }
  );

export type FinancialAccountFormInput = z.output<typeof financialAccountFormSchema>;

export type AccountProviderValue = (typeof ACCOUNT_PROVIDERS)[number] | "" | null | undefined;

export function normalizeAccountProvider(
  value: AccountProviderValue | string
): string | null {
  if (value != null && value !== "" && (ACCOUNT_PROVIDERS as readonly string[]).includes(value)) {
    return value;
  }
  return null;
}

export function accountProviderOrNull(
  value: string | null
): (typeof ACCOUNT_PROVIDERS)[number] | null {
  return normalizeAccountProvider(value) as
    | (typeof ACCOUNT_PROVIDERS)[number]
    | null;
}

export interface FinancialAccountDerived {
  openingBalanceMinor: Minor;
}

export function deriveFinancialAccount(
  input: FinancialAccountFormInput
): FinancialAccountDerived {
  const openingBalanceMinor = input.openingBalance
    ? toMinor(input.openingBalance)
    : 0;
  return { openingBalanceMinor };
}

export const financialAccountUpdateSchema = z.object({
  name: nameField,
  provider: providerField
});

export type FinancialAccountUpdateInput = z.output<
  typeof financialAccountUpdateSchema
>;

export const accountOperationFormSchema = z.object({
  accountId: z.string().uuid("اختر الحساب"),
  amount: z
    .string()
    .trim()
    .min(1, "المبلغ مطلوب")
    .refine(
      (value) => {
        try {
          return toMinor(value) > 0;
        } catch {
          return false;
        }
      },
      "المبلغ يجب أن يكون أكبر من صفر"
    ),
  occurredAt: occurredAtField,
  notes: notesField
});

export type AccountOperationFormInput = z.output<typeof accountOperationFormSchema>;

export const accountTransferFormSchema = z
  .object({
    fromAccountId: z.string().uuid("اختر حساب المصدر"),
    toAccountId: z.string().uuid("اختر حساب الوجهة"),
    amount: accountOperationFormSchema.shape.amount,
    occurredAt: occurredAtField,
    notes: notesField
  })
  .refine((data) => data.fromAccountId !== data.toAccountId, {
    message: "لا يمكن التحويل إلى نفس الحساب",
    path: ["toAccountId"]
  });

export type AccountTransferFormInput = z.output<typeof accountTransferFormSchema>;

export const accountAdjustFormSchema = z.object({
  accountId: z.string().uuid("اختر الحساب"),
  countedBalance: z
    .string()
    .trim()
    .min(1, "الرصيد الفعلي المعدود مطلوب")
    .refine(
      (value) => {
        try {
          return toMinor(value) >= 0;
        } catch {
          return false;
        }
      },
      "الرصيد المعدود يجب أن يكون رقماً صحيحاً غير سالب"
    ),
  occurredAt: occurredAtField,
  notes: notesField
});

export type AccountAdjustFormInput = z.output<typeof accountAdjustFormSchema>;

export interface AccountOperationDerived {
  amountMinor: Minor;
}

export function deriveAccountOperation(
  input: AccountOperationFormInput
): AccountOperationDerived {
  return { amountMinor: toMinor(input.amount) };
}

export interface AccountTransferDerived {
  amountMinor: Minor;
}

export function deriveAccountTransfer(
  input: AccountTransferFormInput
): AccountTransferDerived {
  return { amountMinor: toMinor(input.amount) };
}

export interface AccountAdjustDerived {
  countedBalanceMinor: Minor;
}

export function deriveAccountAdjust(
  input: AccountAdjustFormInput
): AccountAdjustDerived {
  return { countedBalanceMinor: toMinor(input.countedBalance) };
}
