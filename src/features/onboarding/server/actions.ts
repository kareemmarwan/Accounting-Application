"use server";

import { z } from "zod";
import { fromMinor, toMinor } from "@/core/accounting/money";
import {
  onboardingSchema,
  type OnboardingInput
} from "@/core/validation/onboarding";
import { BUSINESS_TYPES } from "@/core/validation/onboarding";
import { getSupabaseServerClient } from "@/core/supabase/server";
import { getSessionUser } from "@/features/auth/server/session";
import { NOT_CONFIGURED_MESSAGE } from "@/features/auth/services/auth-errors";
import { setActiveBusiness } from "@/features/business/server/actions";

const businessRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  business_type: z.enum(BUSINESS_TYPES),
  owner_id: z.string().uuid(),
  currency: z.string(),
  plan: z.string()
});

const accountRowSchema = z.object({
  id: z.string().uuid(),
  business_id: z.string().uuid(),
  name: z.string(),
  type: z.enum(["cash", "bank", "wallet", "other"]),
  provider: z.string().nullable(),
  currency: z.string(),
  opening_balance: z.string(),
  current_balance: z.string(),
  total_deposits: z.string(),
  total_withdrawals: z.string(),
  gl_account_code: z.string(),
  is_active: z.boolean(),
  updated_at: z.string(),
  version: z.number().int()
});

const categoryRowSchema = z.object({
  id: z.string().uuid(),
  business_id: z.string().uuid(),
  name: z.string(),
  gl_code: z.string(),
  is_system: z.boolean(),
  sort_order: z.number().int()
});

export interface OnboardingBusinessResult {
  id: string;
  name: string;
  businessType: string;
  ownerId: string;
  currency: string;
  plan: string;
}

export interface OnboardingAccountResult {
  id: string;
  businessId: string;
  name: string;
  type: "cash" | "bank" | "wallet" | "other";
  provider: string | null;
  currency: string;
  openingBalanceMinor: number;
  currentBalanceMinor: number;
  totalDepositsMinor: number;
  totalWithdrawalsMinor: number;
  glAccountCode: string;
  isActive: boolean;
  updatedAt: string;
  version: number;
}

export interface OnboardingCategoryResult {
  id: string;
  businessId: string;
  name: string;
  glCode: string;
  isSystem: boolean;
  sortOrder: number;
}

export type CreateBusinessResult =
  | {
      ok: true;
      business: OnboardingBusinessResult;
      accounts: OnboardingAccountResult[];
      categories: OnboardingCategoryResult[];
    }
  | { ok: false; error: string };

function mapDbError(message: string, code: string | undefined): string {
  if (message.startsWith("VALIDATION:")) {
    return message.replace("VALIDATION:", "").trim();
  }
  if (message.startsWith("UNAUTHENTICATED")) {
    return "انتهت الجلسة — سجّل الدخول من جديد";
  }
  if (code === "42501") {
    return "ليس لديك صلاحية لتنفيذ هذه العملية";
  }
  if (/fetch failed|failed to fetch|networkerror|network error/i.test(message)) {
    return "تعذر الاتصال بالخادم — تحقق من اتصالك بالإنترنت";
  }
  return "تعذر إنشاء المشروع — أعد المحاولة";
}

function parseAmountMinor(value: string): number {
  try {
    return toMinor(value);
  } catch {
    return 0;
  }
}

export async function createBusinessWithSetup(
  input: OnboardingInput
): Promise<CreateBusinessResult> {
  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "بيانات غير صالحة — أعد التحقق من الخطوات" };
  }
  const data = parsed.data;

  const user = await getSessionUser();
  if (!user) {
    return { ok: false, error: "انتهت الجلسة — سجّل الدخول من جديد" };
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return { ok: false, error: NOT_CONFIGURED_MESSAGE };
  }

  const payload = {
    ownerName: data.ownerName,
    businessName: data.businessName,
    businessType: data.businessType,
    currency: data.currency,
    cashAccount: {
      name: data.cashAccount.name,
      openingBalance: fromMinor(data.cashAccount.openingBalanceMinor)
    },
    bankAccount: data.bankAccount
      ? {
          name: data.bankAccount.name,
          type: data.bankAccount.type,
          provider: data.bankAccount.provider ?? "other",
          openingBalance: fromMinor(data.bankAccount.openingBalanceMinor)
        }
      : null,
    firstCustomer: data.firstCustomer
      ? {
          name: data.firstCustomer.name,
          phone: data.firstCustomer.phone
        }
      : null,
    firstSupplier: data.firstSupplier
      ? {
          name: data.firstSupplier.name,
          phone: data.firstSupplier.phone
        }
      : null
  };

  const { data: businessId, error } = await supabase.rpc(
    "setup_new_business",
    { payload }
  );

  if (error) {
    return { ok: false, error: mapDbError(error.message, error.code) };
  }
  if (typeof businessId !== "string") {
    return { ok: false, error: "استجابة غير متوقعة من الخادم" };
  }

  const [businessRes, accountsRes, categoriesRes] = await Promise.all([
    supabase.from("businesses").select("*").eq("id", businessId).maybeSingle(),
    supabase
      .from("financial_accounts")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: true }),
    supabase
      .from("expense_categories")
      .select("*")
      .eq("business_id", businessId)
      .order("sort_order", { ascending: true })
  ]);

  if (businessRes.error || !businessRes.data) {
    return { ok: false, error: "تعذر جلب بيانات المشروع بعد إنشائه" };
  }
  if (accountsRes.error || !accountsRes.data) {
    return { ok: false, error: "تعذر جلب الحسابات المالية بعد إنشائها" };
  }
  if (categoriesRes.error || !categoriesRes.data) {
    return { ok: false, error: "تعذر جلب تصنيفات المصروفات بعد إنشائها" };
  }

  const businessParsed = businessRowSchema.safeParse(businessRes.data);
  if (!businessParsed.success) {
    return { ok: false, error: "استجابة غير متوقعة من الخادم" };
  }
  const row = businessParsed.data;

  const accounts: OnboardingAccountResult[] = [];
  for (const raw of accountsRes.data) {
    const accountParsed = accountRowSchema.safeParse(raw);
    if (!accountParsed.success) {
      return { ok: false, error: "استجابة غير متوقعة من الخادم" };
    }
    const a = accountParsed.data;
    accounts.push({
      id: a.id,
      businessId: a.business_id,
      name: a.name,
      type: a.type,
      provider: a.provider,
      currency: a.currency,
      openingBalanceMinor: parseAmountMinor(a.opening_balance),
      currentBalanceMinor: parseAmountMinor(a.current_balance),
      totalDepositsMinor: parseAmountMinor(a.total_deposits),
      totalWithdrawalsMinor: parseAmountMinor(a.total_withdrawals),
      glAccountCode: a.gl_account_code,
      isActive: a.is_active,
      updatedAt: a.updated_at,
      version: a.version
    });
  }

  await setActiveBusiness(businessId);

  const categories: OnboardingCategoryResult[] = [];
  for (const raw of categoriesRes.data) {
    const categoryParsed = categoryRowSchema.safeParse(raw);
    if (!categoryParsed.success) {
      return { ok: false, error: "استجابة غير متوقعة من الخادم" };
    }
    const c = categoryParsed.data;
    categories.push({
      id: c.id,
      businessId: c.business_id,
      name: c.name,
      glCode: c.gl_code,
      isSystem: c.is_system,
      sortOrder: c.sort_order
    });
  }

  return {
    ok: true,
    business: {
      id: row.id,
      name: row.name,
      businessType: row.business_type,
      ownerId: row.owner_id,
      currency: row.currency,
      plan: row.plan
    },
    accounts,
    categories
  };
}
