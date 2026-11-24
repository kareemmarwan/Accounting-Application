import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/core/supabase/client";
import { mapAuthError, NOT_CONFIGURED_MESSAGE } from "./auth-errors";
import type { LoginInput, RegisterInput } from "@/core/validation/auth";

export type AuthOutcome =
  | { status: "ok"; redirectTo: string }
  | { status: "email-confirmation-required"; email: string };

function getClient(): SupabaseClient {
  const client = getSupabaseBrowserClient();
  if (!client) throw new Error(NOT_CONFIGURED_MESSAGE);
  return client;
}

function clearAuthCookies(): void {
  for (const pair of document.cookie.split(";")) {
    const name = pair.split("=")[0]?.trim();
    if (name && name.startsWith("sb-")) {
      document.cookie = `${name}=; Path=/; Max-Age=0`;
      document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
    }
  }
}

async function hasAnyBusiness(client: SupabaseClient): Promise<boolean> {
  const { data, error } = await client.from("businesses").select("id").limit(1);
  if (error) return false;
  return data.length > 0;
}

export async function signIn(
  input: LoginInput,
  nextPath?: string
): Promise<AuthOutcome> {
  const client = getClient();
  const { error } = await client.auth.signInWithPassword({
    email: input.email,
    password: input.password
  });
  if (error) throw new Error(mapAuthError(error));

  const hasBusiness = await hasAnyBusiness(client);
  return {
    status: "ok",
    redirectTo: nextPath ?? (hasBusiness ? "/dashboard" : "/onboarding")
  };
}

export async function signUp(input: RegisterInput): Promise<AuthOutcome> {
  const client = getClient();
  const { data, error } = await client.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: { full_name: input.fullName }
    }
  });
  if (error) throw new Error(mapAuthError(error));

  if (!data.session) {
    return { status: "email-confirmation-required", email: input.email };
  }

  return { status: "ok", redirectTo: "/onboarding" };
}

export async function signOut(): Promise<void> {
  const client = getClient();
  try {
    await client.auth.signOut();
  } catch {
    clearAuthCookies();
  }
}
