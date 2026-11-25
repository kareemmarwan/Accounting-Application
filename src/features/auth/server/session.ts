import type { User } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/core/supabase/server";
import { withTimeout } from "@/core/supabase/safe-query";

const EXPIRY_MARGIN_MS = 60_000;

function isFresh(session: { expires_at?: number | null } | null): boolean {
  if (!session?.expires_at) return true;
  return session.expires_at * 1000 - Date.now() > EXPIRY_MARGIN_MS;
}

export async function getSessionUser(): Promise<User | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return null;

  try {
    const session = await withTimeout(
      supabase.auth.getSession().then(({ data }) => data.session ?? null),
      null
    );
    if (session?.user && isFresh(session)) {
      return session.user;
    }
  } catch {
    void 0;
  }

  try {
    const user = await withTimeout(
      supabase.auth.getUser().then(({ data }) => data.user ?? null),
      null
    );
    return user;
  } catch {
    try {
      const fallback = await supabase.auth.getSession();
      return fallback.data.session?.user ?? null;
    } catch {
      return null;
    }
  }
}
