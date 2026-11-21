import type { Metadata } from "next";
import { redirect } from "next/navigation";
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
  return <OnboardingWizard />;
}
