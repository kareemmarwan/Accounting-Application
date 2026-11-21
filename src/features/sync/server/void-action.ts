"use server";

import { getSupabaseServerClient } from "@/core/supabase/server";
import { getSessionUser } from "@/features/auth/server/session";
import { z } from "zod";

const voidSchema = z.object({
  businessId: z.string().uuid("معرّف مشروع غير صالح"),
  docType: z.enum(["sale", "purchase", "expense", "debt_payment"], {
    errorMap: () => ({ message: "نوع مستند غير مدعوم للإلغاء" })
  }),
  docId: z.string().uuid("معرّف مستند غير صالح"),
  reason: z
    .string()
    .trim()
    .min(3, "سبب الإلغاء مطلوب (3 أحرف على الأقل)")
    .max(300, "سبب الإلغاء طويل جداً")
});

export type VoidDocumentInput = z.infer<typeof voidSchema>;

export type VoidDocumentResult = { ok: boolean; error?: string };

export async function voidDocument(input: VoidDocumentInput): Promise<VoidDocumentResult> {
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const user = await getSessionUser();
  if (!user) {
    return { ok: false, error: "انتهت الجلسة — سجّل الدخول من جديد" };
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return {
      ok: false,
      error: "الإلغاء يتم على الخادم ويتطلب الاتصال — أعد المحاولة عند توفر الإنترنت"
    };
  }

  const { error } = await supabase.rpc("void_posted_document", {
    bid: parsed.data.businessId,
    doc_type: parsed.data.docType,
    doc_id: parsed.data.docId,
    reason: parsed.data.reason
  });

  if (error) {
    if (/OVERPAYMENT/.test(error.message)) {
      return { ok: false, error: "لا يمكن الإلغاء — الدفعة تجاوزت المتبقي" };
    }
    if (/FORBIDDEN/.test(error.message)) {
      return { ok: false, error: "دورك لا يسمح بإلغاء المستندات" };
    }
    if (/VALIDATION:/.test(error.message)) {
      return { ok: false, error: error.message.replace("VALIDATION:", "").trim() };
    }
    return { ok: false, error: "تعذر إلغاء المستند — أعد المحاولة" };
  }

  return { ok: true };
}
