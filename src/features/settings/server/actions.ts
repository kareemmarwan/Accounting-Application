"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getSupabaseConfig } from "@/core/supabase/env";
import { getSupabaseServerClient } from "@/core/supabase/server";
import { getSessionUser } from "@/features/auth/server/session";
import { NOT_CONFIGURED_MESSAGE } from "@/features/auth/services/auth-errors";
import {
  computeEffectivePlan,
  maxMembersFor
} from "@/features/subscription/plans";

const inviteSchema = z.object({
  businessId: z.string().uuid("معرّف مشروع غير صالح"),
  email: z
    .string()
    .trim()
    .min(1, "البريد الإلكتروني مطلوب")
    .email("صيغة البريد الإلكتروني غير صحيحة")
    .toLowerCase(),
  role: z.enum(["manager", "accountant", "employee"], {
    errorMap: () => ({ message: "اختر الدور" })
  })
});

export type InviteMemberInput = z.infer<typeof inviteSchema>;

export type InviteMemberResult = { ok: boolean; error?: string };

function getServiceClient() {
  const config = getSupabaseConfig();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!config || !serviceKey) return null;
  return createClient(config.url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

export async function inviteMember(
  input: InviteMemberInput
): Promise<InviteMemberResult> {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة"
    };
  }

  const user = await getSessionUser();
  if (!user) {
    return { ok: false, error: "انتهت الجلسة — سجّل الدخول من جديد" };
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return { ok: false, error: NOT_CONFIGURED_MESSAGE };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("business_members")
    .select("role")
    .eq("business_id", parsed.data.businessId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    return { ok: false, error: "تعذر التحقق من صلاحياتك في هذا المشروع" };
  }
  if (!membership || membership.role !== "owner") {
    return {
      ok: false,
      error: "فقط مالك المشروع يمكنه دعوة المستخدمين"
    };
  }

  const [businessRes, membersRes] = await Promise.all([
    supabase
      .from("businesses")
      .select("plan, subscription_status, trial_ends_at")
      .eq("id", parsed.data.businessId)
      .maybeSingle(),
    supabase
      .from("business_members")
      .select("id", { count: "exact", head: true })
      .eq("business_id", parsed.data.businessId)
      .in("status", ["active", "invited"])
  ]);

  if (!businessRes.error && businessRes.data) {
    const effectivePlan = computeEffectivePlan(
      businessRes.data.plan ?? "free",
      businessRes.data.subscription_status ?? "trialing",
      businessRes.data.trial_ends_at ?? null
    );
    const limit = maxMembersFor(effectivePlan);
    const currentCount = membersRes.count ?? 0;
    if (currentCount >= limit) {
      return {
        ok: false,
        error: `وصلت الحد الأقصى للأعضاء في خطتك الحالية (${limit} أعضاء) — قم بترقية الاشتراك لإضافة موظفين`
      };
    }
  }

  const admin = getServiceClient();
  if (!admin) {
    return {
      ok: false,
      error:
        "خدمة الدعوات غير مهيأة — أضف SUPABASE_SERVICE_ROLE_KEY إلى .env.local"
    };
  }

  const { data: inviteData, error: inviteError } = await admin.auth.admin
    .inviteUserByEmail(parsed.data.email);

  if (inviteError) {
    if (/already|registered|existing/i.test(inviteError.message)) {
      return {
        ok: false,
        error: "هذا البريد مسجل مسبقاً — يمكن إضافته بعد تسجيل دخوله الأول"
      };
    }
    if (/rate|too many/i.test(inviteError.message)) {
      return { ok: false, error: "محاولات كثيرة — انتظر قليلاً ثم أعد المحاولة" };
    }
    return { ok: false, error: "تعذر إرسال الدعوة — أعد المحاولة" };
  }

  const newUserId = inviteData?.user?.id;
  if (!newUserId) {
    return { ok: false, error: "تعذر إنشاء المستخدم — أعد المحاولة" };
  }

  const { error: insertError } = await supabase.from("business_members").insert({
    business_id: parsed.data.businessId,
    user_id: newUserId,
    role: parsed.data.role,
    status: "invited",
    invited_by: user.id
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return { ok: false, error: "المستخدم عضو بالفعل في هذا المشروع" };
    }
    return { ok: false, error: "تعذر إضافة العضو — أعد المحاولة" };
  }

  revalidatePath("/settings");
  return { ok: true };
}
