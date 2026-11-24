"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  BookOpen,
  HandCoins,
  LayoutDashboard,
  MoreHorizontal,
  Package,
  Receipt,
  ScanBarcode,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Users,
  Wallet
} from "lucide-react";

type NavRole = "owner" | "manager" | "accountant" | "employee" | null;

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: NavRole[];
}

const FINANCIAL: NavRole[] = ["owner", "manager", "accountant", null];
const EVERYONE: NavRole[] = ["owner", "manager", "accountant", "employee", null];

const primaryBar: NavItem[] = [
  { href: "/dashboard", label: "الرئيسية", icon: LayoutDashboard, roles: EVERYONE },
  { href: "/sales", label: "المبيعات", icon: BookOpen, roles: EVERYONE }
];

const secondaryBar: NavItem[] = [
  { href: "/debts", label: "الديون", icon: HandCoins, roles: FINANCIAL },
  { href: "/contacts", label: "الجهات", icon: Users, roles: EVERYONE }
];

const moreItems: NavItem[] = [
  { href: "/contacts", label: "العملاء والموردون", icon: Users, roles: EVERYONE },
  { href: "/expenses", label: "المصروفات", icon: Receipt, roles: EVERYONE },
  { href: "/products", label: "المنتجات", icon: Package, roles: FINANCIAL },
  { href: "/purchases", label: "المشتريات", icon: ShoppingBag, roles: FINANCIAL },
  { href: "/accounts", label: "الحسابات المالية", icon: Wallet, roles: FINANCIAL },
  { href: "/reports", label: "التقارير", icon: BarChart3, roles: FINANCIAL },
  { href: "/settings", label: "الإعدادات", icon: Settings, roles: EVERYONE }
];

function isAllowed(item: NavItem, role: NavRole | undefined): boolean {
  return role === undefined || item.roles.some((allowed) => allowed === role);
}

export function BottomNav({
  role,
  isAdmin = false
}: {
  role?: NavRole;
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const [homeItem, salesItem] = primaryBar.filter((item) => isAllowed(item, role));
  const fourth = secondaryBar.filter((item) => isAllowed(item, role))[0];

  const barHrefs = new Set(["/dashboard", "/sales", "/pos", fourth?.href ?? ""]);
  const sheetItems = moreItems.filter(
    (item) => isAllowed(item, role) && !barHrefs.has(item.href)
  );
  if (isAdmin) {
    sheetItems.unshift({
      href: "/admin",
      label: "إدارة المنصة",
      icon: ShieldCheck,
      roles: EVERYONE
    });
  }

  if (!homeItem || !salesItem || !fourth) return null;

  return (
    <>
      <nav
        aria-label="شريط التنقل السفلي"
        className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <BarCell item={homeItem} active={pathname.startsWith("/dashboard")} />
        <BarCell item={salesItem} active={pathname.startsWith("/sales")} />
        <div className="flex flex-1 items-start justify-center">
          <div className="relative -mt-7 h-16 w-16">
            <span
              className="sell-pulse absolute inset-0 rounded-full border-2 border-primary"
              aria-hidden
            />
            <span
              className="sell-pulse sell-pulse-delay absolute inset-0 rounded-full border-2 border-primary"
              aria-hidden
            />
            <Link
              href="/pos"
              aria-label="الكاشير — بيع سريع"
              data-tour="bnav-pos"
              className="relative flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 ring-4 ring-surface transition-transform active:scale-95"
            >
              <ScanBarcode className="h-6 w-6" aria-hidden />
              <span className="text-[10px] font-bold leading-none">بيع</span>
            </Link>
          </div>
        </div>
        <BarCell item={fourth} active={pathname.startsWith(fourth.href)} />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-haspopup="dialog"
          data-tour="bnav-more"
          className={`flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium ${
            open ? "text-primary" : "text-muted"
          }`}
        >
          <MoreHorizontal className="h-5 w-5" aria-hidden />
          المزيد
        </button>
      </nav>

      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="إغلاق القائمة"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="كل الشاشات"
            className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-border bg-surface p-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl"
          >
            <p className="mb-3 text-sm font-bold">كل الشاشات</p>
            <div className="grid grid-cols-4 gap-2">
              {sheetItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center text-[11px] font-medium transition-colors ${
                    pathname.startsWith(item.href)
                      ? "border-primary bg-primary-50 text-primary-800"
                      : "border-border bg-surface hover:border-primary-200"
                  }`}
                >
                  <item.icon className="h-5 w-5" aria-hidden />
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function BarCell({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      data-tour={`bnav-${item.href.slice(1)}`}
      className={`flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium transition-colors ${
        active ? "text-primary" : "text-muted"
      }`}
    >
      <item.icon className="h-5 w-5" aria-hidden />
      {item.label}
    </Link>
  );
}
