"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { contactFormSchema, type ContactFormInput, type ContactType } from "@/core/validation/contact";
import {
  createContact,
  updateContact
} from "@/features/contacts/services/contacts-service";
import type { LocalParty } from "@/core/db/db";

interface ContactFormProps {
  type: ContactType;
  businessId: string;
  existing?: LocalParty | null;
  onDone: () => void;
}

export function ContactForm({ type, businessId, existing, onDone }: ContactFormProps) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting }
  } = useForm<ContactFormInput>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      name: existing?.name ?? "",
      phone: existing?.phone ?? "",
      address: existing?.address ?? "",
      notes: existing?.notes ?? ""
    }
  });

  const typeLabel = type === "customer" ? "عميل" : "مورد";

  async function onSubmit(values: ContactFormInput) {
    setError(null);
    try {
      if (existing) {
        await updateContact(existing.id, values, type);
      } else {
        await createContact(values, type, { businessId });
      }
      onDone();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "تعذر الحفظ — أعد المحاولة"
      );
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="card space-y-4"
      noValidate
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold">
          {existing ? `تعديل ${typeLabel}` : `إضافة ${typeLabel} جديد`}
        </p>
        <button
          type="button"
          onClick={onDone}
          className="btn-outline !px-3 !py-1.5 text-xs"
        >
          إلغاء
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">الاسم *</span>
          <input
            type="text"
            {...register("name")}
            placeholder={type === "customer" ? "مثال: أبو محمد" : "مثال: مؤسسة النور"}
            className="input"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">الهاتف</span>
          <input
            type="tel"
            dir="ltr"
            {...register("phone")}
            placeholder="0599xxxxxx"
            className="input"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">العنوان</span>
          <input
            type="text"
            {...register("address")}
            placeholder="اختياري"
            className="input"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">ملاحظات</span>
          <input
            type="text"
            {...register("notes")}
            placeholder="اختياري"
            className="input"
          />
        </label>
      </div>

      {error && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
          {error}
        </div>
      )}

      <button type="submit" disabled={isSubmitting} className="btn-primary w-full md:w-auto">
        {isSubmitting ? (
          <span className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            جارٍ الحفظ...
          </span>
        ) : existing ? (
          "حفظ التعديل"
        ) : (
          "إضافة"
        )}
      </button>
    </form>
  );
}
