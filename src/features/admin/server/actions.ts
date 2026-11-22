"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getSupabaseServerClient } from "@/core/supabase/server";
import { getSessionUser } from "@/features/auth/server/session";
import { NOT_CONFIGURED_MESSAGE } from "@/features/auth/services/auth-errors";
import {
  getAdminServiceClient
} from "@/features/admin/services/admin-service";

const planSchema = z.enum(["basic", "pro", "business"], {
  errorMap: () => ({ message: "اختر خطة صحيحة" })
});

const activateSchema = z.object({
  businessId: z.string().uuid("معرّف مشروع غير صالح"),
  plan: planSchema,
  months: z
    .number()
    .int("عدد الأشهر غير صالح")
    .min(1, "أقل مدة شهر واحد")
    .max(36, "الحد الأقصى 36 شهراً"),
  requestId: z.string().uuid("معرّف طلب غير صالح").nullable().optional(),
  notes: z.string().trim().max(200, "الملاحظة طويلة جداً").optional()
});

const rejectSchema = z.object({
  requestId: z.string().uuid("معرّف طلب غير صالح")
});

const extendSchema = z.object({
  businessId: z.string().uuid("معرّف مشروع غير صالح"),
  days: z
    .number()
    .int("عدد الأيام غير صالح")
    .min(1, "أقل مدة يوم واحد")
    .max(365, "الحد الأقصى 365 يوماً")
});

const cancelSchema = z.object({
  businessId: z.string().uuid("معرّف مشروع غير صالح")
});

export type AdminActionResult = { ok: boolean; error?: string };

interface AdminContext {
  admin: SupabaseClient;
  userId: string;
}

type AdminContextResult =
  | { ok: true; ctx: AdminContext }
  | { ok: false; error: string };

async function requireAdminContext(): Promise<AdminContextResult> {
  const user = await getSessionUser();
  if (!user) {
    return { ok: false, error: "انتهت الجلسة — سجّل الدخول من جديد" };
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return { ok: false, error: NOT_CONFIGURED_MESSAGE };
  }

  const { data: adminRow } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!adminRow) {
    return { ok: false, error: "هذه العملية للمسؤول الأول للتطبيق فقط" };
  }

  const admin = getAdminServiceClient();
  if (!admin) {
    return {
      ok: false,
      error: "خدمة الإدارة غير مهيأة — أضف SUPABASE_SERVICE_ROLE_KEY إلى .env.local"
    };
  }

  return { ok: true, ctx: { admin, userId: user.id } };
}

function dbError(source: string, error: { code: string | null; message: string }): string {
  return `${source} (${error.code ?? "خطأ"}): ${error.message.slice(0, 160)}`;
}

export async function adminActivateSubscription(
  input: z.input<typeof activateSchema>
): Promise<AdminActionResult> {
  const parsed = activateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const guard = await requireAdminContext();
  if (!guard.ok) return { ok: false, error: guard.error };
  const { admin, userId } = guard.ctx;
  const { businessId, plan, months, requestId, notes } = parsed.data;

  const periodEnd = new Date();
  periodEnd.setMonth(periodEnd.getMonth() + months);
  const periodEndIso = periodEnd.toISOString();
  const nowIso = new Date().toISOString();

  if (requestId) {
    const { data: requestRow } = await admin
      .from("subscriptions")
      .select("id, business_id, status")
      .eq("id", requestId)
      .maybeSingle();
    if (!requestRow || requestRow.business_id !== businessId) {
      return { ok: false, error: "الطلب غير موجود" };
    }
    if (requestRow.status !== "requested") {
      return { ok: false, error: "هذا الطلب مُعالج سابقاً" };
    }

    const { error } = await admin
      .from("subscriptions")
      .update({
        plan,
        status: "active",
        activated_at: nowIso,
        period_end: periodEndIso,
        notes: notes ? `مفعّل من الإدارة: ${notes}` : "مفعّل من الإدارة"
      })
      .eq("id", requestId);
    if (error) {
      return { ok: false, error: dbError("تعذر تفعيل الاشتراك", error) };
    }
  } else {
    const { error } = await admin.from("subscriptions").insert({
      business_id: businessId,
      plan,
      status: "active",
      requested_by: userId,
      activated_at: nowIso,
      period_end: periodEndIso,
      notes: notes ? `تفعيل مباشر من الإدارة: ${notes}` : "تفعيل مباشر من الإدارة"
    });
    if (error) {
      return { ok: false, error: dbError("تعذر إنشاء الاشتراك", error) };
    }
  }

  const { error: businessError } = await admin
    .from("businesses")
    .update({ plan, subscription_status: "active" })
    .eq("id", businessId);
  if (businessError) {
    return { ok: false, error: dbError("تعذر تحديث حالة المشروع", businessError) };
  }

  revalidatePath("/admin");
  return { ok: true };
}

export async function adminRejectRequest(
  input: z.input<typeof rejectSchema>
): Promise<AdminActionResult> {
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const guard = await requireAdminContext();
  if (!guard.ok) return { ok: false, error: guard.error };

  const { data: requestRow } = await guard.ctx.admin
    .from("subscriptions")
    .select("id, status")
    .eq("id", parsed.data.requestId)
    .maybeSingle();
  if (!requestRow) {
    return { ok: false, error: "الطلب غير موجود" };
  }
  if (requestRow.status !== "requested") {
    return { ok: false, error: "هذا الطلب مُعالج سابقاً" };
  }

  const { error } = await guard.ctx.admin
    .from("subscriptions")
    .update({
      status: "canceled",
      notes: "مرفوض من الإدارة"
    })
    .eq("id", parsed.data.requestId);
  if (error) {
    return { ok: false, error: dbError("تعذر رفض الطلب", error) };
  }

  revalidatePath("/admin");
  return { ok: true };
}

export async function adminExtendTrial(
  input: z.input<typeof extendSchema>
): Promise<AdminActionResult> {
  const parsed = extendSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const guard = await requireAdminContext();
  if (!guard.ok) return { ok: false, error: guard.error };
  const { admin } = guard.ctx;

  const { data: businessRow, error: fetchError } = await admin
    .from("businesses")
    .select("subscription_status, trial_ends_at")
    .eq("id", parsed.data.businessId)
    .maybeSingle();
  if (fetchError || !businessRow) {
    return { ok: false, error: "المشروع غير موجود" };
  }
  if (businessRow.subscription_status === "active") {
    return {
      ok: false,
      error: "المشروع مشترك فعلياً — استخدم التفعيل أو الإيقاف بدلاً من تمديد التجربة"
    };
  }

  const current = businessRow.trial_ends_at
    ? Date.parse(businessRow.trial_ends_at)
    : Date.now();
  const base = Math.max(current, Date.now());
  const newEnd = new Date(base + parsed.data.days * 86_400_000).toISOString();

  const { error } = await admin
    .from("businesses")
    .update({ trial_ends_at: newEnd, subscription_status: "trialing" })
    .eq("id", parsed.data.businessId);
  if (error) {
    return { ok: false, error: dbError("تعذر تمديد التجربة", error) };
  }

  revalidatePath("/admin");
  return { ok: true };
}

export async function adminCancelSubscription(
  input: z.input<typeof cancelSchema>
): Promise<AdminActionResult> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const guard = await requireAdminContext();
  if (!guard.ok) return { ok: false, error: guard.error };
  const { admin } = guard.ctx;

  const { error: businessError } = await admin
    .from("businesses")
    .update({ subscription_status: "canceled", plan: "free" })
    .eq("id", parsed.data.businessId);
  if (businessError) {
    return { ok: false, error: dbError("تعذر إيقاف الاشتراك", businessError) };
  }

  const { error: subsError } = await admin
    .from("subscriptions")
    .update({ status: "canceled" })
    .eq("business_id", parsed.data.businessId)
    .in("status", ["active", "requested"]);
  if (subsError) {
    return { ok: false, error: dbError("تعذر تحديث سجل الاشتراكات", subsError) };
  }

  revalidatePath("/admin");
  return { ok: true };
}
