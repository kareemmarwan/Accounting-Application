"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2, UserPlus } from "lucide-react";
import { z } from "zod";
import { inviteMember } from "@/features/settings/server/actions";

const formSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "البريد الإلكتروني مطلوب")
    .email("صيغة البريد الإلكتروني غير صحيحة"),
  role: z.enum(["manager", "accountant", "employee"])
});

type FormValues = z.infer<typeof formSchema>;

const ROLE_LABELS: Record<FormValues["role"], string> = {
  manager: "مدير",
  accountant: "محاسب",
  employee: "موظف"
};

const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

export function InviteMemberForm({ businessId }: { businessId: string }) {
  const [resultMessage, setResultMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting }
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "", role: "employee" }
  });

  const onSubmit = handleSubmit(async (values) => {
    setResultMessage(null);
    const result = await inviteMember({
      businessId,
      email: values.email,
      role: values.role
    });
    if (result.ok) {
      setResultMessage({ kind: "ok", text: "أُرسلت الدعوة إلى البريد بنجاح" });
      reset();
    } else {
      setResultMessage({
        kind: "error",
        text: result.error ?? "تعذر إرسال الدعوة"
      });
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      {resultMessage && (
        <div
          role="status"
          className={`flex items-start gap-2 rounded-xl border p-3 text-xs leading-relaxed ${
            resultMessage.kind === "ok"
              ? "border-primary-200 bg-primary-50 text-primary-800"
              : "border-danger/40 bg-danger/10 text-danger"
          }`}
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{resultMessage.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="invite-email" className="block text-sm font-medium">
            البريد الإلكتروني
          </label>
          <input
            id="invite-email"
            type="email"
            dir="ltr"
            className={inputClass}
            placeholder="name@example.com"
            aria-invalid={Boolean(errors.email)}
            {...register("email")}
          />
          {errors.email && (
            <p className="text-xs text-danger">{errors.email.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="invite-role" className="block text-sm font-medium">
            الدور
          </label>
          <select id="invite-role" className={inputClass} {...register("role")}>
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button type="submit" disabled={isSubmitting} className="btn-primary">
        {isSubmitting ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <UserPlus className="h-4 w-4" aria-hidden />
        )}
        {isSubmitting ? "جارٍ الإرسال..." : "دعوة عضو"}
      </button>
    </form>
  );
}
