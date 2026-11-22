"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  BookOpen,
  Crown,
  HandCoins,
  LayoutDashboard,
  Package,
  Receipt,
  ScanBarcode,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Users,
  Wallet,
  X
} from "lucide-react";
import { ConnectionStatus } from "@/components/connection-status";
import { BottomNav } from "@/components/layout/bottom-nav";
import { HeaderUser } from "@/components/layout/header-user";
import type { SubscriptionBannerInfo } from "@/app/(app)/layout";

type NavRole = "owner" | "manager" | "accountant" | "employee" | null;

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: NavRole[];
}

const FINANCIAL: NavRole[] = ["owner", "manager", "accountant", null];
const EVERYONE: NavRole[] = ["owner", "manager", "accountant", "employee", null];

const navItems: NavItem[] = [
  { href: "/dashboard", label: "لوحة التحكم", icon: LayoutDashboard, roles: EVERYONE },
  { href: "/pos", label: "الكاشير", icon: ScanBarcode, roles: EVERYONE },
  { href: "/sales", label: "المبيعات", icon: BookOpen, roles: EVERYONE },
  { href: "/products", label: "المنتجات", icon: Package, roles: FINANCIAL },
  { href: "/purchases", label: "المشتريات", icon: ShoppingBag, roles: FINANCIAL },
  { href: "/debts", label: "الديون", icon: HandCoins, roles: FINANCIAL },
  { href: "/contacts", label: "العملاء والموردون", icon: Users, roles: EVERYONE },
  { href: "/expenses", label: "المصروفات", icon: Receipt, roles: EVERYONE },
  { href: "/accounts", label: "الحسابات المالية", icon: Wallet, roles: FINANCIAL },
  { href: "/reports", label: "التقارير", icon: BarChart3, roles: FINANCIAL },
  { href: "/settings", label: "الإعدادات", icon: Settings, roles: EVERYONE }
];

const TITLES: Array<[string, string]> = [
  ["/pos", "الكاشير"],
  ["/products", "المنتجات"],
  ["/sales", "المبيعات"],
  ["/purchases", "المشتريات"],
  ["/debts", "الديون"],
  ["/contacts", "العملاء والموردون"],
  ["/expenses", "المصروفات"],
  ["/accounts", "الحسابات المالية"],
  ["/reports", "التقارير"],
  ["/admin", "إدارة المنصة"],
  ["/settings", "الإعدادات"]
];

const PLAN_NAMES: Record<string, string> = {
  free: "مجانية",
  trial: "تجربة مجانية",
  basic: "أساسية",
  pro: "احترافية",
  business: "متعددة المشاريع"
};

export function AppShell({
  children,
  role,
  subscription,
  isAdmin = false
}: {
  children: React.ReactNode;
  role?: NavRole;
  subscription?: SubscriptionBannerInfo | null;
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const [bannerClosed, setBannerClosed] = useState(false);

  const nav =
    role === undefined
      ? navItems
      : navItems.filter((item) => item.roles.some((allowed) => allowed === role));

  const pageTitle =
    TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? "لوحة التحكم";

  const showTrialBanner =
    subscription?.inTrial &&
    !bannerClosed &&
    (role === undefined || role === null || role === "owner");

  return (
    <div className="flex min-h-screen flex-1">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-l border-border bg-surface md:flex">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <LayoutDashboard className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-bold leading-tight">المساعد المالي</p>
            <p className="text-xs text-muted">إدارة مشروعك المالية</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="التنقل الرئيسي">
          {nav.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary-50 text-primary-700"
                    : "text-foreground hover:bg-muted-foreground/10"
                }`}
              >
                <item.icon className="h-5 w-5" aria-hidden />
                {item.label}
              </Link>
            );
          })}
          {isAdmin && (
            <Link
              href="/admin"
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                pathname.startsWith("/admin")
                  ? "bg-primary-50 text-primary-700"
                  : "text-foreground hover:bg-muted-foreground/10"
              }`}
            >
              <ShieldCheck className="h-5 w-5" aria-hidden />
              إدارة المنصة
            </Link>
          )}
        </nav>
        {subscription && (
          <div className="border-t border-border p-3">
            <div className="rounded-xl bg-muted-foreground/5 p-3 text-xs">
              <p className="flex items-center gap-1.5 font-bold">
                <Crown
                  className={`h-3.5 w-3.5 ${
                    subscription.effectivePlan === "free" ? "text-muted" : "text-warning"
                  }`}
                  aria-hidden
                />
                الخطة: {PLAN_NAMES[subscription.effectivePlan] ?? subscription.effectivePlan}
              </p>
              {subscription.inTrial ? (
                <p className="mt-1 text-muted">
                  متبقٍ {subscription.trialDaysLeft} يوم —{" "}
                  <Link href="/settings" className="font-medium text-primary underline">
                    اشترك الآن
                  </Link>
                </p>
              ) : subscription.effectivePlan === "free" ? (
                <p className="mt-1 text-muted">
                  <Link href="/settings" className="font-medium text-primary underline">
                    ترقية الاشتراك
                  </Link>{" "}
                  لإضافة موظفين
                </p>
              ) : (
                <p className="mt-1 text-muted">حتى {subscription.maxMembers} أعضاء</p>
              )}
            </div>
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {showTrialBanner && subscription && (
          <div className="flex items-center justify-between gap-3 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs text-warning md:px-6">
            <p>
              <Crown className="me-1.5 inline h-3.5 w-3.5" aria-hidden />
              تجربتك المجانية تنتهي بعد{" "}
              <span className="font-bold">{subscription.trialDaysLeft}</span> يوم — اشترك
              للاستمرار بكل الميزات وإضافة الموظفين.
            </p>
            <span className="flex items-center gap-2">
              <Link href="/settings" className="font-bold underline">
                عرض الخطط
              </Link>
              <button
                type="button"
                onClick={() => setBannerClosed(true)}
                aria-label="إغلاق التنبيه"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </span>
          </div>
        )}
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur md:px-6">
          <span className="text-sm font-bold md:hidden">المساعد المالي</span>
          <span className="hidden text-sm font-semibold text-muted md:inline">
            {pageTitle}
          </span>
          <div className="flex items-center gap-2">
            <ConnectionStatus />
            <HeaderUser />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 pb-28 md:px-6 md:pb-6">{children}</main>
        <BottomNav role={role} isAdmin={isAdmin} />
      </div>
    </div>
  );
}
