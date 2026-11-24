import type { User } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/core/supabase/server";
import { withTimeout } from "@/core/supabase/safe-query";

export async function getSessionUser(): Promise<User | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return null;

  try {
    const user = await withTimeout(
      supabase.auth.getUser().then(({ data }) => data.user ?? null),
      null
    );
    if (user) return user;
  } catch {
    void 0;
  }

  try {
    const session = await withTimeout(
      supabase.auth.getSession().then(({ data }) => data.session ?? null),
      null
    );
    return session?.user ?? null;
  } catch {
    return null;
  }
}
