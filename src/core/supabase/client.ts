import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./env";

let cached: SupabaseClient | null | undefined;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const config = getSupabaseConfig();
  cached = config ? createBrowserClient(config.url, config.anonKey) : null;
  return cached;
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig() !== null;
}
