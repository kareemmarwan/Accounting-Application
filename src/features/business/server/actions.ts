"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { getSupabaseServerClient } from "@/core/supabase/server";
import { ACTIVE_BUSINESS_COOKIE } from "../business-constants";

const businessIdSchema = z.string().uuid();

export async function setActiveBusiness(
  businessId: string
): Promise<{ ok: boolean; error?: string }> {
  const parsed = businessIdSchema.safeParse(businessId);
  if (!parsed.success) {
    return { ok: false, error: "معرّف مشروع غير صالح" };
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return { ok: false, error: "لم يتم إعداد Supabase بعد" };
  }

  const { data } = await supabase
    .from("businesses")
    .select("id")
    .eq("id", parsed.data)
    .limit(1);

  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "لا تملك صلاحية الوصول إلى هذا المشروع"
    };
  }

  cookies().set(ACTIVE_BUSINESS_COOKIE, parsed.data, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365
  });

  return { ok: true };
}

export async function clearActiveBusiness(): Promise<void> {
  cookies().delete(ACTIVE_BUSINESS_COOKIE);
}
