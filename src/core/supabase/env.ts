import { z } from "zod";

const configSchema = z.object({
  url: z.string().url(),
  anonKey: z.string().min(10)
});

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export function getSupabaseConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const parsed = configSchema.safeParse({ url, anonKey });
  return parsed.success ? parsed.data : null;
}
