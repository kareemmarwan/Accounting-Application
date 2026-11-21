const MAPPINGS: Array<{ match: RegExp; message: string }> = [
  {
    match: /invalid login credentials/i,
    message: "البريد الإلكتروني أو كلمة المرور غير صحيحة"
  },
  {
    match: /email not confirmed/i,
    message: "لم يتم تأكيد البريد الإلكتروني بعد — تحقق من صندوق الوارد"
  },
  {
    match: /user already registered/i,
    message: "هذا البريد مسجل مسبقاً — جرّب تسجيل الدخول"
  },
  {
    match: /rate limit|too many requests/i,
    message: "محاولات كثيرة — انتظر قليلاً ثم أعد المحاولة"
  },
  {
    match: /password.*weak|weak password/i,
    message: "كلمة المرور ضعيفة — استخدم 6 أحرف على الأقل"
  },
  {
    match: /invalid.*email|unable to validate email/i,
    message: "صيغة البريد الإلكتروني غير صحيحة"
  },
  {
    match: /signup requires a valid password/i,
    message: "كلمة المرور مطلوبة (6 أحرف على الأقل)"
  },
  {
    match: /fetch failed|networkerror|failed to fetch|network error/i,
    message: "تعذر الاتصال بالخادم — تحقق من اتصالك بالإنترنت"
  },
  {
    match: /email address .* is invalid/i,
    message: "صيغة البريد الإلكتروني غير صحيحة"
  }
];

export const NOT_CONFIGURED_MESSAGE =
  "لم يتم إعداد Supabase بعد — انسخ .env.example إلى .env.local وأضف بيانات المشروع";

export function mapAuthError(error: unknown): string {
  let message = "";
  if (error instanceof Error) {
    message = error.message;
  } else if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    message = (error as { message: string }).message;
  } else if (typeof error === "string") {
    message = error;
  }

  if (!message) return "حدث خطأ غير متوقع — أعد المحاولة";

  for (const mapping of MAPPINGS) {
    if (mapping.match.test(message)) return mapping.message;
  }

  if (message.startsWith("لم يتم") || message.startsWith("تعذر")) {
    return message;
  }

  return "حدث خطأ غير متوقع — أعد المحاولة";
}
