import { AppShell } from "@/components/layout/app-shell";
import { AppTour } from "@/features/onboarding/components/app-tour";
import { getSessionUser } from "@/features/auth/server/session";
import { getActiveBusinessId } from "@/features/business/server/business-context";
import {
  getAppShellData,
  type SubscriptionBannerInfo
} from "@/features/business/server/app-shell-data";

export type { SubscriptionBannerInfo };

export default async function AppLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const [user, activeId] = await Promise.all([
    getSessionUser(),
    getActiveBusinessId()
  ]);

  const shell = await getAppShellData(user?.id ?? null, activeId);

  return (
    <AppShell role={shell.role} isAdmin={shell.isAdmin} subscription={shell.subscription}>
      {children}
      <AppTour role={shell.role} enabled={shell.hasBusiness} />
    </AppShell>
  );
}
