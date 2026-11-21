export interface PlanInfo {
  id: "free" | "trial" | "basic" | "pro" | "business";
  label: string;
  priceShekel: number;
  maxMembers: number;
  tagline: string;
}

export const PLANS: Record<PlanInfo["id"], PlanInfo> = {
  free: {
    id: "free",
    label: "مجانية",
    priceShekel: 0,
    maxMembers: 1,
    tagline: "مالك المشروع فقط — بعد انتهاء التجربة"
  },
  trial: {
    id: "trial",
    label: "تجربة مجانية",
    priceShekel: 0,
    maxMembers: 4,
    tagline: "14 يوماً بكل الميزات (ما يعادل الخطة الاحترافية)"
  },
  basic: {
    id: "basic",
    label: "أساسية",
    priceShekel: 29,
    maxMembers: 2,
    tagline: "مالك + موظف واحد"
  },
  pro: {
    id: "pro",
    label: "احترافية",
    priceShekel: 59,
    maxMembers: 4,
    tagline: "مالك + 3 موظفين بصلاحيات أدوار"
  },
  business: {
    id: "business",
    label: "متعددة المشاريع",
    priceShekel: 99,
    maxMembers: 11,
    tagline: "مالك + 10 موظفين"
  }
};

export const PAID_PLAN_IDS = ["basic", "pro", "business"] as const;
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];

export function isPaidPlanId(value: string): value is PaidPlanId {
  return (PAID_PLAN_IDS as readonly string[]).includes(value);
}

export interface SubscriptionSnapshot {
  subscriptionStatus: "trialing" | "active" | "past_due" | "canceled";
  trialEndsAt: string | null;
  effectivePlan: PlanInfo["id"];
  activeMembers: number;
  maxMembers: number;
  inTrial: boolean;
  trialDaysLeft: number;
}

export function computeEffectivePlan(
  plan: string,
  subscriptionStatus: string,
  trialEndsAt: string | null
): PlanInfo["id"] {
  const trialActive =
    subscriptionStatus === "trialing" &&
    trialEndsAt !== null &&
    Date.parse(trialEndsAt) > Date.now();
  if (trialActive) return "pro";
  if (subscriptionStatus === "active" && isPaidPlanId(plan)) return plan;
  return "free";
}

export function maxMembersFor(plan: PlanInfo["id"]): number {
  return PLANS[plan].maxMembers;
}
