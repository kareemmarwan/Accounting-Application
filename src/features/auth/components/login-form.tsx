"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { loginSchema, type LoginInput } from "@/core/validation/auth";
import { isSupabaseConfigured } from "@/core/supabase/client";
import { signIn } from "@/features/auth/services/auth-service";
import {
  mapAuthError,
  NOT_CONFIGURED_MESSAGE
} from "@/features/auth/services/auth-errors";

export function LoginForm({ nextPath }: { nextPath?: string }) {
  const router = useRouter();
  const configured = isSupabaseConfigured();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" }
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const outcome = await signIn(values, nextPath);
      if (outcome.status === "ok") {
        router.replace(outcome.redirectTo);
      }
    } catch (error) {
      setServerError(mapAuthError(error));
    }
  });

  return (
    <div className="card">
      <h1 className="text-xl font-bold">تسجيل الدخول</h1>
      <p className="mt-1 text-sm text-muted">
        أدخل بياناتك للوصول إلى لوحة التحكم
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
              autoComplete="current-password"
              placeholder="••••••••"
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

        <button
          type="submit"
          disabled={isSubmitting || !configured}
          className="btn-primary w-full"
        >
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {isSubmitting ? "جارٍ تسجيل الدخول..." : "تسجيل الدخول"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-muted">
        ليس لديك حساب؟{" "}
        <Link
          href="/register"
          className="font-semibold text-primary hover:underline"
        >
          إنشاء حساب جديد
        </Link>
      </p>
    </div>
  );
}
