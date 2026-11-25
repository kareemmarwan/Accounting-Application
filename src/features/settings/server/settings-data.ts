import { getSupabaseServerClient } from "@/core/supabase/server";
import { safeQuery } from "@/core/supabase/safe-query";
import { withTtlCache } from "@/core/cache/server-memory";
import { getActiveBusinessId } from "@/features/business/server/business-context";

export interface SettingsBusinessRow {
  id: string;
  name: string;
  business_type: string;
  currency: string;
  plan: string | null;
  phone: string | null;
  address: string | null;
}

export interface SettingsMemberRow {
  id: string;
  userId: string;
  fullName: string | null;
  role: string;
  status: string;
}

export interface SettingsData {
  businesses: SettingsBusinessRow[];
  activeId: string | null;
  members: SettingsMemberRow[];
}

interface MemberRaw {
  id: string;
  role: string;
  status: string;
  user_id: string;
  profile: { full_name: string } | { full_name: string }[] | null;
}

const SETTINGS_TTL_MS = 120_000;

function profileName(profile: MemberRaw["profile"]): string | null {
  if (Array.isArray(profile)) return profile[0]?.full_name ?? null;
  return profile?.full_name ?? null;
}

async function computeSettingsData(
  activeId: string | null
): Promise<SettingsData> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return { businesses: [], activeId, members: [] };
  }

  const businessesRes = await safeQuery(
    () =>
      supabase
        .from("businesses")
        .select("id, name, business_type, currency, plan, phone, address")
        .order("created_at", { ascending: true }),
    null
  );
  const businesses = (businessesRes?.data ?? []) as SettingsBusinessRow[];
  const effectiveActive =
    activeId && businesses.some((business) => business.id === activeId)
      ? activeId
      : (businesses[0]?.id ?? null);

  let members: SettingsMemberRow[] = [];
  if (effectiveActive) {
    const membersRes = await safeQuery(
      () =>
        supabase
          .from("business_members")
          .select("id, role, status, user_id, profile:profiles(full_name)")
          .eq("business_id", effectiveActive)
          .order("created_at", { ascending: true }),
      null
    );
    members = ((membersRes?.data ?? []) as unknown as MemberRaw[]).map((row) => ({
      id: row.id,
      userId: row.user_id,
      fullName: profileName(row.profile),
      role: row.role,
      status: row.status
    }));
  }

  return { businesses, activeId: effectiveActive, members };
}

export function getSettingsData(
  userId: string,
  activeId: string | null
): Promise<SettingsData> {
  return withTtlCache(
    `settings:${userId}:${activeId ?? "none"}`,
    SETTINGS_TTL_MS,
    () => computeSettingsData(activeId)
  );
}

export async function getViewerActiveBusinessId(): Promise<string | null> {
  return getActiveBusinessId();
}
