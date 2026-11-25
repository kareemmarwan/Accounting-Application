"use server";

import { z } from "zod";
import { getSupabaseServerClient } from "@/core/supabase/server";
import { invalidateServerCache } from "@/core/cache/server-memory";
import { getSessionUser } from "@/features/auth/server/session";
import { NOT_CONFIGURED_MESSAGE } from "@/features/auth/services/auth-errors";
import { computeEffectivePlan, maxMembersFor, PLANS } from "@/features/subscription/plans";

const businessIdSchema = z.string().uuid("ظ…ط¹ط±ظ‘ظپ ظ…ط´ط±ظˆط¹ ط؛ظٹط± طµط§ظ„ط­");

const requestSchema = z.object({
  businessId: businessIdSchema,
  plan: z.enum(["basic", "pro", "business"], {
    errorMap: () => ({ message: "ط§ط®طھط± ط®ط·ط© طµط­ظٹط­ط©" })
  })
});

const cancelSchema = z.object({
  businessId: businessIdSchema,
  subscriptionId: z.string().uuid("ظ…ط¹ط±ظ‘ظپ ط§ط´طھط±ط§ظƒ ط؛ظٹط± طµط§ظ„ط­")
});

const memberActionSchema = z.object({
  businessId: businessIdSchema,
  memberId: z.string().uuid("ظ…ط¹ط±ظ‘ظپ ط¹ط¶ظˆ ط؛ظٹط± طµط§ظ„ط­")
});

const roleActionSchema = memberActionSchema.extend({
  role: z.enum(["manager", "accountant", "employee"], {
    errorMap: () => ({ message: "ط§ط®طھط± ط¯ظˆط±ط§ظ‹ طµط­ظٹط­ط§ظ‹" })
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
    return { ok: false, error: "ظ…ط¹ط±ظ‘ظپ ظ…ط´ط±ظˆط¹ ط؛ظٹط± طµط§ظ„ط­" };
  }
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "ط§ظ†طھظ‡طھ ط§ظ„ط¬ظ„ط³ط© â€” ط³ط¬ظ‘ظ„ ط§ظ„ط¯ط®ظˆظ„ ظ…ظ† ط¬ط¯ظٹط¯" };

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
    return { ok: false, error: "طھط¹ط°ط± ط¬ظ„ط¨ ط¨ظٹط§ظ†ط§طھ ط§ظ„ط§ط´طھط±ط§ظƒ" };
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
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ط¨ظٹط§ظ†ط§طھ ط؛ظٹط± طµط§ظ„ط­ط©" };
  }

  const user = await getSessionUser();
  if (!user) return { ok: false, error: "ط§ظ†طھظ‡طھ ط§ظ„ط¬ظ„ط³ط© â€” ط³ط¬ظ‘ظ„ ط§ظ„ط¯ط®ظˆظ„ ظ…ظ† ط¬ط¯ظٹط¯" };

  const supabase = getSupabaseServerClient();
  if (!supabase) return { ok: false, error: NOT_CONFIGURED_MESSAGE };

  const { data: membership } = await supabase
    .from("business_members")
    .select("role")
    .eq("business_id", parsed.data.businessId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership || membership.role !== "owner") {
    return { ok: false, error: "ظپظ‚ط· ظ…ط§ظ„ظƒ ط§ظ„ظ…ط´ط±ظˆط¹ ظٹظ…ظƒظ†ظ‡ ط·ظ„ط¨ طھط±ظ‚ظٹط© ط§ظ„ط®ط·ط©" };
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
      error: "ظٹظˆط¬ط¯ ط·ظ„ط¨ طھط±ظ‚ظٹط© ظ‚ظٹط¯ ط§ظ„ظ…ط¹ط§ظ„ط¬ط© ط¨ط§ظ„ظپط¹ظ„ â€” طھط§ط¨ط¹ ط­ط§ظ„طھظ‡ ظ…ظ† طµظپط­ط© ط§ظ„ط¥ط¹ط¯ط§ط¯ط§طھ"
    };
  }

  const { error } = await supabase.from("subscriptions").insert({
    business_id: parsed.data.businessId,
    plan: parsed.data.plan,
    status: "requested",
    requested_by: user.id
  });

  if (error) {
    return { ok: false, error: "طھط¹ط°ط± طھط³ط¬ظٹظ„ ط·ظ„ط¨ ط§ظ„طھط±ظ‚ظٹط© â€” ط£ط¹ط¯ ط§ظ„ظ…ط­ط§ظˆظ„ط©" };
  }

  invalidateServerCache();
  return { ok: true };
}

export async function cancelSubscriptionRequest(input: {
  businessId: string;
  subscriptionId: string;
}): Promise<PlanActionResult> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ط¨ظٹط§ظ†ط§طھ ط؛ظٹط± طµط§ظ„ط­ط©" };
  }

  const user = await getSessionUser();
  if (!user) return { ok: false, error: "ط§ظ†طھظ‡طھ ط§ظ„ط¬ظ„ط³ط© â€” ط³ط¬ظ‘ظ„ ط§ظ„ط¯ط®ظˆظ„ ظ…ظ† ط¬ط¯ظٹط¯" };

  const supabase = getSupabaseServerClient();
  if (!supabase) return { ok: false, error: NOT_CONFIGURED_MESSAGE };

  const { data: membership } = await supabase
    .from("business_members")
    .select("role")
    .eq("business_id", parsed.data.businessId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership || membership.role !== "owner") {
    return { ok: false, error: "ظپظ‚ط· ظ…ط§ظ„ظƒ ط§ظ„ظ…ط´ط±ظˆط¹ ظٹظ…ظƒظ†ظ‡ ط¥ط¯ط§ط±ط© ط·ظ„ط¨ ط§ظ„طھط±ظ‚ظٹط©" };
  }

  const { error } = await supabase
    .from("subscriptions")
    .update({ status: "canceled" })
    .eq("id", parsed.data.subscriptionId)
    .eq("business_id", parsed.data.businessId)
    .eq("status", "requested");

  if (error) {
    return { ok: false, error: "طھط¹ط°ط± ط¥ظ„ط؛ط§ط، ط§ظ„ط·ظ„ط¨ â€” ط£ط¹ط¯ ط§ظ„ظ…ط­ط§ظˆظ„ط©" };
  }

  invalidateServerCache();
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
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ط¨ظٹط§ظ†ط§طھ ط؛ظٹط± طµط§ظ„ط­ط©" };
  }

  const user = await getSessionUser();
  if (!user) return { ok: false, error: "ط§ظ†طھظ‡طھ ط§ظ„ط¬ظ„ط³ط© â€” ط³ط¬ظ‘ظ„ ط§ظ„ط¯ط®ظˆظ„ ظ…ظ† ط¬ط¯ظٹط¯" };

  const supabase = getSupabaseServerClient();
  if (!supabase) return { ok: false, error: NOT_CONFIGURED_MESSAGE };

  const { data: membership } = await supabase
    .from("business_members")
    .select("role")
    .eq("business_id", parsed.data.businessId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership || membership.role !== "owner") {
    return { ok: false, error: "ظپظ‚ط· ظ…ط§ظ„ظƒ ط§ظ„ظ…ط´ط±ظˆط¹ ظٹظ…ظƒظ†ظ‡ طھط¹ط¯ظٹظ„ ط§ظ„ط£ط¯ظˆط§ط±" };
  }

  const { data: target } = await supabase
    .from("business_members")
    .select("role")
    .eq("id", parsed.data.memberId)
    .eq("business_id", parsed.data.businessId)
    .maybeSingle();

  if (!target) return { ok: false, error: "ط§ظ„ط¹ط¶ظˆ ط؛ظٹط± ظ…ظˆط¬ظˆط¯" };
  if (target.role === "owner") {
    return { ok: false, error: "ظ„ط§ ظٹظ…ظƒظ† طھط؛ظٹظٹط± ط¯ظˆط± ظ…ط§ظ„ظƒ ط§ظ„ظ…ط´ط±ظˆط¹" };
  }

  const { error } = await supabase
    .from("business_members")
    .update({ role: parsed.data.role })
    .eq("id", parsed.data.memberId)
    .eq("business_id", parsed.data.businessId);

  if (error) {
    return { ok: false, error: "طھط¹ط°ط± طھط­ط¯ظٹط« ط§ظ„ط¯ظˆط± â€” ط£ط¹ط¯ ط§ظ„ظ…ط­ط§ظˆظ„ط©" };
  }

  invalidateServerCache();
  return { ok: true };
}

export async function removeMember(input: {
  businessId: string;
  memberId: string;
}): Promise<MemberActionResult> {
  const parsed = memberActionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ط¨ظٹط§ظ†ط§طھ ط؛ظٹط± طµط§ظ„ط­ط©" };
  }

  const user = await getSessionUser();
  if (!user) return { ok: false, error: "ط§ظ†طھظ‡طھ ط§ظ„ط¬ظ„ط³ط© â€” ط³ط¬ظ‘ظ„ ط§ظ„ط¯ط®ظˆظ„ ظ…ظ† ط¬ط¯ظٹط¯" };

  const supabase = getSupabaseServerClient();
  if (!supabase) return { ok: false, error: NOT_CONFIGURED_MESSAGE };

  const { data: membership } = await supabase
    .from("business_members")
    .select("role")
    .eq("business_id", parsed.data.businessId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership || membership.role !== "owner") {
    return { ok: false, error: "ظپظ‚ط· ظ…ط§ظ„ظƒ ط§ظ„ظ…ط´ط±ظˆط¹ ظٹظ…ظƒظ†ظ‡ ط¥ط²ط§ظ„ط© ط§ظ„ط£ط¹ط¶ط§ط،" };
  }

  const { data: target } = await supabase
    .from("business_members")
    .select("role, user_id")
    .eq("id", parsed.data.memberId)
    .eq("business_id", parsed.data.businessId)
    .maybeSingle();

  if (!target) return { ok: false, error: "ط§ظ„ط¹ط¶ظˆ ط؛ظٹط± ظ…ظˆط¬ظˆط¯" };
  if (target.role === "owner") {
    return { ok: false, error: "ظ„ط§ ظٹظ…ظƒظ† ط¥ط²ط§ظ„ط© ظ…ط§ظ„ظƒ ط§ظ„ظ…ط´ط±ظˆط¹" };
  }

  const { error } = await supabase
    .from("business_members")
    .update({ status: "removed" })
    .eq("id", parsed.data.memberId)
    .eq("business_id", parsed.data.businessId);

  if (error) {
    return { ok: false, error: "طھط¹ط°ط± ط¥ط²ط§ظ„ط© ط§ظ„ط¹ط¶ظˆ â€” ط£ط¹ط¯ ط§ظ„ظ…ط­ط§ظˆظ„ط©" };
  }

  invalidateServerCache();
  return { ok: true };
}
