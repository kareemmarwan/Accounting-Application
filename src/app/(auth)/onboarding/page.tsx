import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/core/supabase/server";
import { safeQuery } from "@/core/supabase/safe-query";
import { getSessionUser } from "@/features/auth/server/session";
import { OnboardingWizard } from "@/features/onboarding/components/onboarding-wizard";

export const metadata: Metadata = {
  title: "إعداد المشروع"
};

export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login?next=/onboarding");
  }

  const supabase = getSupabaseServerClient();
  if (supabase) {
    const membershipRes = await safeQuery(
      () =>
        supabase
          .from("business_members")
          .select("business_id")
          .eq("user_id", user.id)
          .limit(1),
      null
    );
    const hasBusiness = (membershipRes?.data?.length ?? 0) > 0;
    if (hasBusiness) {
      redirect("/dashboard");
    }
  }

  return <OnboardingWizard />;
}
