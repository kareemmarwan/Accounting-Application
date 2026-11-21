"use server";

import { z } from "zod";
import { getSupabaseServerClient } from "@/core/supabase/server";
import { getSessionUser } from "@/features/auth/server/session";
import { NOT_CONFIGURED_MESSAGE } from "@/features/auth/services/auth-errors";
import { computeEffectivePlan, maxMembersFor, PLANS } from "@/features/subscription/plans";

const businessIdSchema = z.string().uuid("معرّف مشروع غير صالح");

const requestSchema = z.object({
  businessId: businessIdSchema,
  plan: z.enum(["basic", "pro", "business"], {
    errorMap: () => ({ message: "اختر خطة صحيحة" })
  })
});

const cancelSchema = z.object({
  businessId: businessIdSchema,
  subscriptionId: z.string().uuid("معرّف اشتراك غير صالح")
});

const memberActionSchema = z.object({
  businessId: businessIdSchema,
  memberId: z.string().uuid("معرّف عضو غير صالح")
});

const roleActionSchema = memberActionSchema.extend({
  role: z.enum(["manager", "accountant", "employee"], {
    errorMap: () => ({ message: "اختر دوراً صحيحاً" })
  })
});

export interface SubscriptionOverview {
  configured: boolean;
  businessName: string;
  plan: string;
  subscriptionStatus: "trialing" | "active" | "past_due" | "canceled";
  trialEndsAt: string | null;
  effectivePlan: keyof typeof PLANS;
  activeMembers: number;
  maxMembers: number;
  inTrial: boolean;
  trialDaysLeft: number;
  pendingRequest: {
    id: string;
    plan: string;
    requestedAt: string;
  } | null;
}

export type SubscriptionOverviewResult =
  | { ok: true; overview: SubscriptionOverview }
  | { ok: false; error: string };

export async function getSubscriptionOverview(
  businessId: string
): Promise<SubscriptionOverviewResult> {
  if (!businessIdSchema.safeParse(businessId).success) {
    return { ok: false, error: "معرّف مشروع غير صالح" };
  }
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "انتهت الجلسة — سجّل الدخول من جديد" };

  const supabase = getSupabaseServerClient();
  if (!supabase) return { ok: false, error: NOT_CONFIGURED_MESSAGE };

  const [businessRes, capacityRes, requestsRes] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, name, plan, subscription_status, trial_ends_at")
      .eq("id", businessId)
      .maybeSingle(),
    supabase.rpc("business_capacity", { bid: businessId }),
    supabase
      .from("subscriptions")
      .select("id, plan, requested_at, status")
      .eq("business_id", businessId)
      .eq("status", "requested")
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  if (businessRes.error || !businessRes.data) {
    return { ok: false, error: "تعذر جلب بيانات الاشتراك" };
  }

  const business = businessRes.data;
  const subscriptionStatus = (business.subscription_status ?? "trialing") as SubscriptionOverview["subscriptionStatus"];
  const trialEndsAt = business.trial_ends_at ?? null;
  const trialDaysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((Date.parse(trialEndsAt) - Date.now()) / 86_400_000))
    : 0;

  let activeMembers = 1;
  let maxMembers = 1;
  if (!capacityRes.error && capacityRes.data) {
    const capacity = capacityRes.data as Record<string, unknown>;
    activeMembers = Number(capacity.active_members ?? 0);
    maxMembers = Number(capacity.max_members ?? 0);
  }

  const effectivePlan = computeEffectivePlan(
    business.plan ?? "free",
    subscriptionStatus,
    trialEndsAt
  );

  const pendingRequestRow = requestsRes.data as
    | { id: string; plan: string; requested_at: string }
    | null;

  return {
    ok: true,
    overview: {
      configured: true,
      businessName: business.name,
      plan: business.plan ?? "free",
      subscriptionStatus,
      trialEndsAt,
      effectivePlan,
      activeMembers,
      maxMembers: maxMembers || maxMembersFor(effectivePlan),
      inTrial: subscriptionStatus === "trialing" && trialDaysLeft > 0,
      trialDaysLeft,
      pendingRequest: pendingRequestRow
        ? {
            id: pendingRequestRow.id,
            plan: pendingRequestRow.plan,
            requestedAt: pendingRequestRow.requested_at
          }
        : null
    }
  };
}

export type PlanActionResult = { ok: boolean; error?: string };

export async function requestSubscription(input: {
  businessId: string;
  plan: string;
}): Promise<PlanActionResult> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const user = await getSessionUser();
  if (!user) return { ok: false, error: "انتهت الجلسة — سجّل الدخول من جديد" };

  const supabase = getSupabaseServerClient();
  if (!supabase) return { ok: false, error: NOT_CONFIGURED_MESSAGE };

  const { data: membership } = await supabase
    .from("business_members")
    .select("role")
    .eq("business_id", parsed.data.businessId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership || membership.role !== "owner") {
    return { ok: false, error: "فقط مالك المشروع يمكنه طلب ترقية الخطة" };
  }

  const { data: existing } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("business_id", parsed.data.businessId)
    .eq("status", "requested")
    .maybeSingle();

  if (existing) {
    return {
      ok: false,
      error: "يوجد طلب ترقية قيد المعالجة بالفعل — تابع حالته من صفحة الإعدادات"
    };
  }

  const { error } = await supabase.from("subscriptions").insert({
    business_id: parsed.data.businessId,
    plan: parsed.data.plan,
    status: "requested",
    requested_by: user.id
  });

  if (error) {
    return { ok: false, error: "تعذر تسجيل طلب الترقية — أعد المحاولة" };
  }

  return { ok: true };
}

export async function cancelSubscriptionRequest(input: {
  businessId: string;
  subscriptionId: string;
}): Promise<PlanActionResult> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const user = await getSessionUser();
  if (!user) return { ok: false, error: "انتهت الجلسة — سجّل الدخول من جديد" };

  const supabase = getSupabaseServerClient();
  if (!supabase) return { ok: false, error: NOT_CONFIGURED_MESSAGE };

  const { data: membership } = await supabase
    .from("business_members")
    .select("role")
    .eq("business_id", parsed.data.businessId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership || membership.role !== "owner") {
    return { ok: false, error: "فقط مالك المشروع يمكنه إدارة طلب الترقية" };
  }

  const { error } = await supabase
    .from("subscriptions")
    .update({ status: "canceled" })
    .eq("id", parsed.data.subscriptionId)
    .eq("business_id", parsed.data.businessId)
    .eq("status", "requested");

  if (error) {
    return { ok: false, error: "تعذر إلغاء الطلب — أعد المحاولة" };
  }

  return { ok: true };
}

export type MemberActionResult = { ok: boolean; error?: string };

export async function updateMemberRole(input: {
  businessId: string;
  memberId: string;
  role: string;
}): Promise<MemberActionResult> {
  const parsed = roleActionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const user = await getSessionUser();
  if (!user) return { ok: false, error: "انتهت الجلسة — سجّل الدخول من جديد" };

  const supabase = getSupabaseServerClient();
  if (!supabase) return { ok: false, error: NOT_CONFIGURED_MESSAGE };

  const { data: membership } = await supabase
    .from("business_members")
    .select("role")
    .eq("business_id", parsed.data.businessId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership || membership.role !== "owner") {
    return { ok: false, error: "فقط مالك المشروع يمكنه تعديل الأدوار" };
  }

  const { data: target } = await supabase
    .from("business_members")
    .select("role")
    .eq("id", parsed.data.memberId)
    .eq("business_id", parsed.data.businessId)
    .maybeSingle();

  if (!target) return { ok: false, error: "العضو غير موجود" };
  if (target.role === "owner") {
    return { ok: false, error: "لا يمكن تغيير دور مالك المشروع" };
  }

  const { error } = await supabase
    .from("business_members")
    .update({ role: parsed.data.role })
    .eq("id", parsed.data.memberId)
    .eq("business_id", parsed.data.businessId);

  if (error) {
    return { ok: false, error: "تعذر تحديث الدور — أعد المحاولة" };
  }

  return { ok: true };
}

export async function removeMember(input: {
  businessId: string;
  memberId: string;
}): Promise<MemberActionResult> {
  const parsed = memberActionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const user = await getSessionUser();
  if (!user) return { ok: false, error: "انتهت الجلسة — سجّل الدخول من جديد" };

  const supabase = getSupabaseServerClient();
  if (!supabase) return { ok: false, error: NOT_CONFIGURED_MESSAGE };

  const { data: membership } = await supabase
    .from("business_members")
    .select("role")
    .eq("business_id", parsed.data.businessId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership || membership.role !== "owner") {
    return { ok: false, error: "فقط مالك المشروع يمكنه إزالة الأعضاء" };
  }

  const { data: target } = await supabase
    .from("business_members")
    .select("role, user_id")
    .eq("id", parsed.data.memberId)
    .eq("business_id", parsed.data.businessId)
    .maybeSingle();

  if (!target) return { ok: false, error: "العضو غير موجود" };
  if (target.role === "owner") {
    return { ok: false, error: "لا يمكن إزالة مالك المشروع" };
  }

  const { error } = await supabase
    .from("business_members")
    .update({ status: "removed" })
    .eq("id", parsed.data.memberId)
    .eq("business_id", parsed.data.businessId);

  if (error) {
    return { ok: false, error: "تعذر إزالة العضو — أعد المحاولة" };
  }

  return { ok: true };
}
