import { getSupabaseServerClient } from "@/core/supabase/server";
import { safeQuery } from "@/core/supabase/safe-query";
import { withTtlCache } from "@/core/cache/server-memory";
import { computeEffectivePlan, maxMembersFor } from "@/features/subscription/plans";

export interface SubscriptionBannerInfo {
  plan: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  effectivePlan: string;
  maxMembers: number;
  trialDaysLeft: number;
  inTrial: boolean;
}

export type NavRole = "owner" | "manager" | "accountant" | "employee" | null;

export interface AppShellData {
  role: NavRole;
  subscription: SubscriptionBannerInfo | null;
  isAdmin: boolean;
  hasBusiness: boolean;
}

const SHELL_TTL_MS = 300_000;

async function computeAppShellData(
  userId: string,
  activeId: string
): Promise<AppShellData> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return { role: null, subscription: null, isAdmin: false, hasBusiness: false };
  }

  const [adminRes, membershipRes, businessRes] = await Promise.all([
    safeQuery(
      () =>
        supabase
          .from("platform_admins")
          .select("user_id")
          .eq("user_id", userId)
          .maybeSingle(),
      null
    ),
    activeId
      ? safeQuery(
          () =>
            supabase
              .from("business_members")
              .select("role")
              .eq("business_id", activeId)
              .eq("user_id", userId)
              .maybeSingle(),
          null
        )
      : Promise.resolve(null),
    activeId
      ? safeQuery(
          () =>
            supabase
              .from("businesses")
              .select("plan, subscription_status, trial_ends_at")
              .eq("id", activeId)
              .maybeSingle(),
          null
        )
      : Promise.resolve(null)
  ]);

  let role: NavRole = null;
  const membershipRole = (membershipRes?.data as { role?: string } | null)?.role;
  if (
    membershipRole === "owner" ||
    membershipRole === "manager" ||
    membershipRole === "accountant" ||
    membershipRole === "employee"
  ) {
    role = membershipRole;
  }

  let subscription: SubscriptionBannerInfo | null = null;
  let hasBusiness = false;
  if (businessRes?.data) {
    const row = businessRes.data as {
      plan?: string;
      subscription_status?: string;
      trial_ends_at?: string | null;
    };
    const subscriptionStatus = row.subscription_status ?? "trialing";
    const trialEndsAt = row.trial_ends_at ?? null;
    const trialDaysLeft = trialEndsAt
      ? Math.max(0, Math.ceil((Date.parse(trialEndsAt) - Date.now()) / 86_400_000))
      : 0;
    const effectivePlan = computeEffectivePlan(
      row.plan ?? "free",
      subscriptionStatus,
      trialEndsAt
    );
    subscription = {
      plan: row.plan ?? "free",
      subscriptionStatus,
      trialEndsAt,
      effectivePlan,
      maxMembers: maxMembersFor(effectivePlan),
      trialDaysLeft,
      inTrial: subscriptionStatus === "trialing" && trialDaysLeft > 0
    };
    hasBusiness = true;
  }

  return {
    role,
    subscription,
    isAdmin: Boolean(adminRes?.data),
    hasBusiness
  };
}

export function getAppShellData(
  userId: string | null,
  activeId: string | null
): Promise<AppShellData> {
  if (!userId) {
    return Promise.resolve({
      role: null,
      subscription: null,
      isAdmin: false,
      hasBusiness: false
    });
  }
  const key = `shell:${userId}:${activeId ?? "none"}`;
  return withTtlCache(key, SHELL_TTL_MS, () =>
    computeAppShellData(userId, activeId ?? "")
  );
}
