import type { User } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/core/supabase/server";

export async function getSessionUser(): Promise<User | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}
