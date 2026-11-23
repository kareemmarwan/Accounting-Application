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

const updateBusinessSchema = z.object({
  businessId: z.string().uuid("معرّف مشروع غير صالح"),
  name: z.string().trim().min(2, "اسم المشروع مطلوب (حرفان على الأقل)").max(80, "الاسم طويل جداً"),
  phone: z.string().trim().max(24, "رقم الهاتف طويل جداً").optional().default(""),
  address: z.string().trim().max(200, "العنوان طويل جداً").optional().default("")
});

export type UpdateBusinessInput = z.infer<typeof updateBusinessSchema>;

export type UpdateBusinessResult = { ok: boolean; error?: string };

async function requireOwnerRole(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  businessId: string,
  userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: NOT_CONFIGURED_MESSAGE };
  const { data: membership, error } = await supabase
    .from("business_members")
    .select("role")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { ok: false, error: "تعذر التحقق من صلاحياتك" };
  if (!membership || membership.role !== "owner") {
    return { ok: false, error: "أدوات إدارة المشروع متاحة لمالك المشروع فقط" };
  }
  return { ok: true };
}

export async function updateBusiness(
  input: UpdateBusinessInput
): Promise<UpdateBusinessResult> {
  const parsed = updateBusinessSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const user = await getSessionUser();
  if (!user) return { ok: false, error: "انتهت الجلسة — سجّل الدخول من جديد" };

  const supabase = getSupabaseServerClient();
  const ownerCheck = await requireOwnerRole(supabase, parsed.data.businessId, user.id);
  if (!ownerCheck.ok) return { ok: false, error: ownerCheck.error };

  const { error: updateError } = await supabase!
    .from("businesses")
    .update({
      name: parsed.data.name,
      phone: parsed.data.phone || null,
      address: parsed.data.address || null
    })
    .eq("id", parsed.data.businessId);

  if (updateError) {
    return { ok: false, error: "تعذر حفظ معلومات المشروع — أعد المحاولة" };
  }

  revalidatePath("/settings");
  return { ok: true };
}

const archiveBusinessSchema = z.object({
  businessId: z.string().uuid("معرّف مشروع غير صالح"),
  confirmName: z.string().trim().min(1, "اكتب اسم المشروع للتأكيد")
});

export type ArchiveBusinessInput = z.infer<typeof archiveBusinessSchema>;

export type ArchiveBusinessResult = { ok: boolean; error?: string };

export async function archiveBusiness(
  input: ArchiveBusinessInput
): Promise<ArchiveBusinessResult> {
  const parsed = archiveBusinessSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const user = await getSessionUser();
  if (!user) return { ok: false, error: "انتهت الجلسة — سجّل الدخول من جديد" };

  const supabase = getSupabaseServerClient();
  const ownerCheck = await requireOwnerRole(supabase, parsed.data.businessId, user.id);
  if (!ownerCheck.ok) return { ok: false, error: ownerCheck.error };

  const { data: business } = await supabase!
    .from("businesses")
    .select("name")
    .eq("id", parsed.data.businessId)
    .maybeSingle();

  if (!business || (business as { name: string }).name !== parsed.data.confirmName) {
    return { ok: false, error: "الاسم المكتوب لا يطابق اسم المشروع" };
  }

  const { error: updateError } = await supabase!
    .from("businesses")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", parsed.data.businessId);

  if (updateError) {
    return { ok: false, error: "تعذر إغلاق المشروع — أعد المحاولة" };
  }

  revalidatePath("/");
  revalidatePath("/settings");
  return { ok: true };
}
