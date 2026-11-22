import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/core/supabase/env";
import { getSupabaseServerClient } from "@/core/supabase/server";
import { getSessionUser } from "@/features/auth/server/session";

export interface AdminBusinessRow {
  id: string;
  name: string;
  ownerId: string;
  ownerEmail: string;
  ownerName: string;
  plan: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  createdAt: string;
  activeMembers: number;
}

export interface AdminRequestRow {
  id: string;
  businessId: string;
  businessName: string;
  plan: string;
  requestedAt: string;
  requesterName: string;
}

export interface AdminOverview {
  businesses: AdminBusinessRow[];
  requests: AdminRequestRow[];
}

export type AdminOverviewResult =
  | { ok: true; overview: AdminOverview }
  | { ok: false; error: string };

export function getAdminServiceClient(): SupabaseClient | null {
  const config = getSupabaseConfig();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!config || !serviceKey) return null;
  return createClient(config.url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

export async function isPlatformAdmin(): Promise<boolean> {
  const user = await getSessionUser();
  const supabase = getSupabaseServerClient();
  if (!user || !supabase) return false;
  const { data } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  return data !== null;
}

interface BusinessRow {
  id: string;
  name: string;
  owner_id: string;
  plan: string | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
  created_at: string;
}

interface MemberRow {
  business_id: string;
  user_id: string;
  status: string | null;
}

interface SubscriptionRow {
  id: string;
  business_id: string;
  plan: string;
  status: string;
  requested_by: string;
  requested_at: string;
}

function fetchError(
  source: string,
  error: { code: string | null | undefined; message: string }
): string {
  return `تعذر جلب ${source} (${error.code ?? "خطأ"}): ${error.message.slice(0, 160)}`;
}

export async function fetchAdminOverview(): Promise<AdminOverviewResult> {
  const admin = getAdminServiceClient();
  if (!admin) {
    return {
      ok: false,
      error: "خدمة الإدارة غير مهيأة — أضف SUPABASE_SERVICE_ROLE_KEY إلى .env.local"
    };
  }

  const [businessesRes, membersRes, subsRes, profilesRes, usersRes] =
    await Promise.all([
      admin
        .from("businesses")
        .select(
          "id, name, owner_id, plan, subscription_status, trial_ends_at, created_at"
        )
        .order("created_at", { ascending: false }),
      admin.from("business_members").select("business_id, user_id, status"),
      admin
        .from("subscriptions")
        .select("id, business_id, plan, status, requested_by, requested_at"),
      admin.from("profiles").select("id, full_name"),
      admin.auth.admin.listUsers({ perPage: 200 })
    ]);

  if (businessesRes.error) {
    return { ok: false, error: fetchError("المشاريع", businessesRes.error) };
  }
  if (membersRes.error) {
    return { ok: false, error: fetchError("الأعضاء", membersRes.error) };
  }
  if (subsRes.error) {
    return { ok: false, error: fetchError("الاشتراكات", subsRes.error) };
  }
  if (usersRes.error) {
    return { ok: false, error: fetchError("المستخدمين", usersRes.error) };
  }

  const businesses = (businessesRes.data ?? []) as BusinessRow[];
  const members = (membersRes.data ?? []) as MemberRow[];
  const subscriptions = (subsRes.data ?? []) as SubscriptionRow[];

  const emailById = new Map<string, string>();
  for (const authUser of usersRes.data.users) {
    if (authUser.email) emailById.set(authUser.id, authUser.email);
  }

  const nameById = new Map<string, string>();
  for (const profile of (profilesRes.data ?? []) as Array<{
    id: string;
    full_name: string | null;
  }>) {
    if (profile.full_name) nameById.set(profile.id, profile.full_name);
  }

  const memberCount = new Map<string, number>();
  for (const member of members) {
    if (member.status !== "active" && member.status !== "invited") continue;
    memberCount.set(
      member.business_id,
      (memberCount.get(member.business_id) ?? 0) + 1
    );
  }

  const rows: AdminBusinessRow[] = businesses.map((row) => ({
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    ownerEmail: emailById.get(row.owner_id) ?? "",
    ownerName: nameById.get(row.owner_id) ?? "",
    plan: row.plan ?? "free",
    subscriptionStatus: row.subscription_status ?? "trialing",
    trialEndsAt: row.trial_ends_at,
    createdAt: row.created_at,
    activeMembers: memberCount.get(row.id) ?? 0
  }));

  const businessNameById = new Map(rows.map((row) => [row.id, row.name]));
  const requests: AdminRequestRow[] = subscriptions
    .filter((sub) => sub.status === "requested")
    .map((sub) => ({
      id: sub.id,
      businessId: sub.business_id,
      businessName: businessNameById.get(sub.business_id) ?? sub.business_id,
      plan: sub.plan,
      requestedAt: sub.requested_at,
      requesterName:
        nameById.get(sub.requested_by) ?? emailById.get(sub.requested_by) ?? ""
    }));

  return { ok: true, overview: { businesses: rows, requests } };
}
