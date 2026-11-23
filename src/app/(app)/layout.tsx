import { AppShell } from "@/components/layout/app-shell";
import { getSupabaseServerClient } from "@/core/supabase/server";
import { getSessionUser } from "@/features/auth/server/session";
import { getActiveBusinessId } from "@/features/business/server/business-context";
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

type NavRole = "owner" | "manager" | "accountant" | "employee" | null;

export default async function AppLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const [user, activeId, supabase] = await Promise.all([
    getSessionUser(),
    getActiveBusinessId(),
    getSupabaseServerClient()
  ]);

  let role: NavRole = null;
  let subscription: SubscriptionBannerInfo | null = null;
  let isAdmin = false;

  if (supabase && user) {
    const [adminRes, membershipRes, businessRes] = await Promise.all([
      supabase
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("business_members")
        .select("role")
        .eq("business_id", activeId)
        .eq("user_id", user?.id ?? "")
        .maybeSingle(),
      supabase
        .from("businesses")
        .select("plan, subscription_status, trial_ends_at")
        .eq("id", activeId)
        .maybeSingle()
    ]);

    isAdmin = adminRes.data !== null;

    const membershipRole = (membershipRes.data as { role?: string } | null)?.role;
    if (
      membershipRole === "owner" ||
      membershipRole === "manager" ||
      membershipRole === "accountant" ||
      membershipRole === "employee"
    ) {
      role = membershipRole;
    }

    if (businessRes.data) {
      const row = businessRes.data as {
        plan?: string;
        subscription_status?: string;
        trial_ends_at?: string | null;
      };
      const subscriptionStatus = row.subscription_status ?? "trialing";
      const trialEndsAt = row.trial_ends_at ?? null;
      const trialDaysLeft = trialEndsAt
        ? Math.max(
            0,
            Math.ceil((Date.parse(trialEndsAt) - Date.now()) / 86_400_000)
          )
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
    }
  }

  return (
    <AppShell role={role} subscription={subscription} isAdmin={isAdmin}>
      {children}
    </AppShell>
  );
}
