import { createServerClient } from "@supabase/ssr";
import type { CookieOptionsWithName } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "./env";

export function getSupabaseServerClient(): SupabaseClient | null {
  const config = getSupabaseConfig();
  if (!config) return null;

  const cookieStore = cookies();
  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptionsWithName }[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          void 0;
        }
      }
    }
  });
}
