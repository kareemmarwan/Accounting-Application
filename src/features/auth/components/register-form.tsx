"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Eye, EyeOff, Loader2, MailCheck } from "lucide-react";
import { registerSchema, type RegisterInput } from "@/core/validation/auth";
import { isSupabaseConfigured } from "@/core/supabase/client";
import { signUp } from "@/features/auth/services/auth-service";
import {
  mapAuthError,
  NOT_CONFIGURED_MESSAGE
} from "@/features/auth/services/auth-errors";

export function RegisterForm() {
  const configured = isSupabaseConfigured();
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(
    null
  );
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
      confirmPassword: ""
    }
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const outcome = await signUp(values);
      if (outcome.status === "email-confirmation-required") {
        setConfirmationEmail(outcome.email);
      }
    } catch (error) {
      setServerError(mapAuthError(error));
    }
  });

  if (confirmationEmail) {
    return (
      <div className="card text-center">
        <div className="mx-auto mb-4 inline-flex rounded-2xl bg-primary-50 p-3 text-primary">
          <MailCheck className="h-6 w-6" aria-hidden />
        </div>
        <h1 className="text-xl font-bold">تم إنشاء الحساب</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          أرسلنا رابط التفعيل إلى{" "}
          <span dir="ltr" className="font-medium text-foreground">
            {confirmationEmail}
          </span>
          . افتح الرابط لتفعيل حسابك ثم سجّل الدخول.
        </p>
        <Link href="/login" className="btn-primary mt-5 w-full">
          الانتقال إلى تسجيل الدخول
        </Link>
      </div>
    );
  }

  return (
    <div className="card">
      <h1 className="text-xl font-bold">إنشاء حساب جديد</h1>
      <p className="mt-1 text-sm text-muted">
        خطوة واحدة تفصلك عن إدارة مشروعك المالية
      </p>

      {!configured && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs leading-relaxed text-warning">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{NOT_CONFIGURED_MESSAGE}</span>
        </div>
      )}

      {serverError && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs leading-relaxed text-danger"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{serverError}</span>
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-5 space-y-4" noValidate>
        <div className="space-y-1.5">
          <label htmlFor="fullName" className="block text-sm font-medium">
            الاسم الكامل
          </label>
          <input
            id="fullName"
            type="text"
            autoComplete="name"
            placeholder="مثال: أحمد محمد"
            className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            aria-invalid={Boolean(errors.fullName)}
            {...register("fullName")}
          />
          {errors.fullName && (
            <p className="text-xs text-danger">{errors.fullName.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="email" className="block text-sm font-medium">
            البريد الإلكتروني
          </label>
          <input
            id="email"
            type="email"
            dir="ltr"
            autoComplete="email"
            placeholder="name@example.com"
            className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            aria-invalid={Boolean(errors.email)}
            {...register("email")}
          />
          {errors.email && (
            <p className="text-xs text-danger">{errors.email.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-sm font-medium">
            كلمة المرور
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              dir="ltr"
              autoComplete="new-password"
              placeholder="6 أحرف على الأقل"
              className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 pe-10 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
              aria-invalid={Boolean(errors.password)}
              {...register("password")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="absolute inset-y-0 end-2 flex items-center px-2 text-muted hover:text-foreground"
              aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" aria-hidden />
              ) : (
                <Eye className="h-4 w-4" aria-hidden />
              )}
            </button>
          </div>
          {errors.password && (
            <p className="text-xs text-danger">{errors.password.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="confirmPassword" className="block text-sm font-medium">
            تأكيد كلمة المرور
          </label>
          <input
            id="confirmPassword"
            type={showPassword ? "text" : "password"}
            dir="ltr"
            autoComplete="new-password"
            placeholder="••••••••"
            className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            aria-invalid={Boolean(errors.confirmPassword)}
            {...register("confirmPassword")}
          />
          {errors.confirmPassword && (
            <p className="text-xs text-danger">
              {errors.confirmPassword.message}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting || !configured}
          className="btn-primary w-full"
        >
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {isSubmitting ? "جارٍ إنشاء الحساب..." : "إنشاء الحساب"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-muted">
        لديك حساب بالفعل؟{" "}
        <Link href="/login" className="font-semibold text-primary hover:underline">
          تسجيل الدخول
        </Link>
      </p>
    </div>
  );
}
