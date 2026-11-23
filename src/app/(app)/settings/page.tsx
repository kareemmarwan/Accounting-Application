import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, ShieldAlert, Users } from "lucide-react";
import { getSupabaseServerClient } from "@/core/supabase/server";
import { getSessionUser } from "@/features/auth/server/session";
import { getActiveBusinessId } from "@/features/business/server/business-context";
import { SignOutButton } from "@/features/settings/components/sign-out-button";
import { InviteMemberForm } from "@/features/settings/components/invite-member-form";
import { BackupExport } from "@/features/settings/components/backup-export";
import { BusinessInfoForm } from "@/features/settings/components/business-info-form";
import { DangerZone } from "@/features/settings/components/danger-zone";
import { BusinessSwitcher } from "@/components/layout/business-switcher";
import { AppTourReplay } from "@/features/onboarding/components/app-tour-replay";
import { BUSINESS_TYPE_LABELS } from "@/core/validation/onboarding";
import { getSubscriptionOverview } from "@/features/subscription/server/actions";
import { SubscriptionCard } from "@/features/subscription/components/subscription-card";
import {
  MembersManager,
  type ManagedMember
} from "@/features/subscription/components/members-manager";

export const metadata: Metadata = {
  title: "الإعدادات"
};

const ROLE_LABELS: Record<string, string> = {
  owner: "مالك",
  manager: "مدير",
  accountant: "محاسب",
  employee: "موظف"
};

interface MemberRow {
  id: string;
  userId: string;
  fullName: string | null;
  role: string;
  status: string;
}

interface MemberRaw {
  id: string;
  role: string;
  status: string;
  user_id: string;
  profile: { full_name: string } | { full_name: string }[] | null;
}

function profileName(
  profile: MemberRaw["profile"]
): string | null {
  if (Array.isArray(profile)) return profile[0]?.full_name ?? null;
  return profile?.full_name ?? null;
}

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login?next=/settings");
  }

  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <Header isOwner={false} />
        <div className="card">
          <p className="text-sm leading-relaxed text-muted">
            لم يتم إعداد Supabase بعد — الإعدادات السحابية متاحة بعد إضافة
            متغيرات البيئة في <span dir="ltr">.env.local</span>
          </p>
        </div>
      </div>
    );
  }

  const [{ data: businesses }, activeId] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, name, business_type, currency, plan, phone, address")
      .order("created_at", { ascending: true }),
    getActiveBusinessId()
  ]);

  const list = businesses ?? [];
  const effectiveActive =
    activeId && list.some((business) => business.id === activeId)
      ? activeId
      : (list[0]?.id ?? null);

  let members: MemberRow[] = [];
  if (effectiveActive) {
    const { data: memberRows } = await supabase
      .from("business_members")
      .select("id, role, status, user_id, profile:profiles(full_name)")
      .eq("business_id", effectiveActive)
      .order("created_at", { ascending: true });
    const rows = (memberRows ?? []) as unknown as MemberRaw[];
    members = rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      fullName: profileName(row.profile),
      role: row.role,
      status: row.status
    }));
  }

  const viewerRole = members.find((member) => member.userId === user.id)?.role;
  const activeBusiness = list.find((business) => business.id === effectiveActive);
  const isOwner = viewerRole === "owner";

  const subscriptionResult = effectiveActive
    ? await getSubscriptionOverview(effectiveActive)
    : null;
  const overview =
    subscriptionResult && subscriptionResult.ok
      ? subscriptionResult.overview
      : null;

  if (list.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <Header isOwner={true} />
        <div className="card flex flex-col items-start gap-4">
          <div className="inline-flex rounded-xl bg-primary-50 p-3 text-primary">
            <Building2 className="h-6 w-6" aria-hidden />
          </div>
          <p className="text-sm leading-relaxed text-muted">
            لم تنشئ مشروعاً بعد. أنشئ مشروعك الأول لإدارة حساباته من لوحة
            التحكم.
          </p>
          <Link href="/onboarding" className="btn-primary">
            إنشاء مشروع
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Header isOwner={isOwner} />

      <div className="card space-y-5">
        {isOwner && activeBusiness ? (
          <BusinessInfoForm
            businessId={activeBusiness.id}
            initial={{
              name: activeBusiness.name,
              phone: (activeBusiness as { phone?: string | null }).phone ?? "",
              address: (activeBusiness as { address?: string | null }).address ?? ""
            }}
          />
        ) : (
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary">
              <Building2 className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-bold">{activeBusiness?.name}</p>
              <p className="text-xs text-muted">
                {activeBusiness
                  ? BUSINESS_TYPE_LABELS[
                      activeBusiness.business_type as keyof typeof BUSINESS_TYPE_LABELS
                    ]
                  : ""}
              </p>
            </div>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">العملة</dt>
            <dd className="font-medium">{activeBusiness?.currency}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">الخطة</dt>
            <dd className="font-medium">
              {overview
                ? overview.inTrial
                  ? `تجربة مجانية (${overview.trialDaysLeft} يوم)`
                  : overview.effectivePlan === "free"
                    ? "مجانية"
                    : overview.effectivePlan === "basic"
                      ? "أساسية"
                      : overview.effectivePlan === "business"
                        ? "متعددة المشاريع"
                        : "احترافية"
                : activeBusiness?.plan}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">حسابك</dt>
            <dd className="font-medium">
              {viewerRole ? ROLE_LABELS[viewerRole] : "—"}
            </dd>
          </div>
        </dl>

        <BusinessSwitcher
          businesses={list.map((business) => ({
            id: business.id,
            name: business.name
          }))}
          activeId={effectiveActive}
        />
      </div>

      {isOwner && overview && effectiveActive && (
        <SubscriptionCard businessId={effectiveActive} overview={overview} />
      )}

      {isOwner ? (
        <>
          <div className="card space-y-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary">
                <Users className="h-5 w-5" aria-hidden />
              </span>
              <p className="text-sm font-bold">المستخدمون والصلاحيات</p>
            </div>

            {members.length > 0 ? (
              <MembersManager
                businessId={effectiveActive ?? ""}
                members={members as ManagedMember[]}
                viewerUserId={user.id}
              />
            ) : (
              <p className="text-sm text-muted">لا أعضاء بعد — ادعُ أول موظف من الأسفل</p>
            )}

            {effectiveActive && (
              <>
                <InviteMemberForm businessId={effectiveActive} />
                {overview && (
                  <p className="text-xs text-muted">
                    الموظفون: {overview.activeMembers} من {overview.maxMembers}
                    {overview.inTrial
                      ? " — خلال التجربة الحد 4 أعضاء"
                      : overview.effectivePlan === "free"
                        ? " — الخطة المجانية مالك فقط، اشترك لإضافة موظفين"
                        : ""}
                  </p>
                )}
              </>
            )}
          </div>

          <BackupExport />

          {activeBusiness && effectiveActive && (
            <DangerZone
              businessId={effectiveActive}
              businessName={activeBusiness.name}
            />
          )}
        </>
      ) : (
        <div className="card flex items-center gap-3 text-sm text-muted">
          <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden />
          أدوات إدارة المشروع (الاشتراك، الأعضاء، النسخ الاحتياطي) متاحة لمالك
          المشروع فقط
        </div>
      )}

      <div className="card">
        <p className="mb-3 text-sm font-bold">الحساب</p>
        <p className="mb-4 text-xs text-muted" dir="ltr">
          {user.email}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <SignOutButton />
          <AppTourReplay />
        </div>
      </div>
    </div>
  );
}

function Header({ isOwner }: { isOwner: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-bold">
        {isOwner ? "إدارة المشروع" : "الإعدادات"}
      </h1>
      <p className="text-sm text-muted">
        {isOwner
          ? "تحكم كامل في المشروع — المعلومات والأعضاء والاشتراك"
          : "معلومات المشروع وحسابك"}
      </p>
    </div>
  );
}
