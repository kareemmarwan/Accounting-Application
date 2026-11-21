"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2, Receipt } from "lucide-react";
import {
  EXPENSE_METHOD_LABELS,
  expenseFormSchema,
  type ExpenseFormInput
} from "@/core/validation/expense";
import { formatCurrency } from "@/lib/format";
import { createExpense } from "@/features/expenses/services/expenses-service";
import type { FinancialAccountRef } from "@/core/accounting/types";
import type { LocalExpenseCategory } from "@/core/db/db";

const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

export interface ExpenseAccountOption {
  id: string;
  name: string;
  type: FinancialAccountRef["type"];
}

function toDatetimeLocal(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ExpenseForm({
  businessId,
  categories,
  accounts,
  onCreated
}: {
  businessId: string;
  categories: LocalExpenseCategory[];
  accounts: ExpenseAccountOption[];
  onCreated: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting }
  } = useForm<ExpenseFormInput>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: {
      title: "",
      categoryId: categories[0]?.id ?? "",
      amount: "",
      occurredAt: toDatetimeLocal(new Date().toISOString()),
      paymentMethod: "cash",
      accountId: accounts[0]?.id ?? "",
      notes: ""
    }
  });

  const amount = watch("amount");

  const amountPreview = useMemo(() => {
    try {
      return Number(amount.replace(/[^\d.]/g, "")) || 0;
    } catch {
      return 0;
    }
  }, [amount]);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setFileError(null);
    if (!file) {
      setReceiptFile(null);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setFileError("حجم الملف أكبر من 10 ميغابايت");
      event.target.value = "";
      setReceiptFile(null);
      return;
    }
    setReceiptFile(file);
  }

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSuccessMessage(null);
    const accountRef = accounts.find((account) => account.id === values.accountId);
    try {
      const result = await createExpense(values, {
        businessId,
        accountRef: {
          id: values.accountId,
          type: accountRef?.type ?? "cash"
        },
        receiptFile
      });
      reset({
        title: "",
        categoryId: values.categoryId,
        amount: "",
        occurredAt: toDatetimeLocal(new Date().toISOString()),
        paymentMethod: values.paymentMethod,
        accountId: values.accountId,
        notes: ""
      });
      setReceiptFile(null);
      setSuccessMessage(
        `سُجّل المصروف ${result.expense.title} — ${
          receiptAttachmentLabel(result.receiptAttachmentId)
        }قيد على ${categoryName(result.expense.glCode, categories)}`
      );
      onCreated();
    } catch (error) {
      setServerError(
        error instanceof Error ? error.message : "تعذر حفظ المصروف"
      );
    }
  });

  return (
    <form onSubmit={onSubmit} className="card space-y-4" noValidate>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary">
          <Receipt className="h-5 w-5" aria-hidden />
        </span>
        <p className="text-sm font-bold">مصروف جديد</p>
      </div>

      {serverError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs leading-relaxed text-danger"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{serverError}</span>
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border border-primary-200 bg-primary-50 p-3 text-xs leading-relaxed text-primary-800"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{successMessage}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="e-title" className="block text-sm font-medium">
            عنوان المصروف
          </label>
          <input
            id="e-title"
            type="text"
            className={inputClass}
            placeholder="مثال: فاتورة كهرباء يناير"
            {...register("title")}
          />
          {errors.title && (
            <p className="text-xs text-danger">{errors.title.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="e-category" className="block text-sm font-medium">
            التصنيف
          </label>
          <select
            id="e-category"
            className={inputClass}
            {...register("categoryId")}
          >
            <option value="">— اختر التصنيف —</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          {errors.categoryId && (
            <p className="text-xs text-danger">{errors.categoryId.message}</p>
          )}
          {categories.length === 0 && (
            <p className="text-xs text-muted">
              لا تصنيفات محلياً — التصنيفات تُخزّن عند إعداد المشروع
              (الـ Onboarding) أو مع المزامنة
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="e-amount" className="block text-sm font-medium">
            المبلغ (₪)
          </label>
          <input
            id="e-amount"
            type="text"
            inputMode="decimal"
            dir="ltr"
            className={`${inputClass} num`}
            placeholder="0.00"
            {...register("amount")}
          />
          {errors.amount && (
            <p className="text-xs text-danger">{errors.amount.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="e-occurredAt" className="block text-sm font-medium">
            التاريخ والوقت
          </label>
          <input
            id="e-occurredAt"
            type="datetime-local"
            dir="ltr"
            className={inputClass}
            {...register("occurredAt")}
          />
          {errors.occurredAt && (
            <p className="text-xs text-danger">{errors.occurredAt.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="e-method" className="block text-sm font-medium">
            طريقة الدفع
          </label>
          <select
            id="e-method"
            className={inputClass}
            {...register("paymentMethod")}
          >
            {Object.entries(EXPENSE_METHOD_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {errors.paymentMethod && (
            <p className="text-xs text-danger">{errors.paymentMethod.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="e-account" className="block text-sm font-medium">
            حساب الدفع
          </label>
          <select
            id="e-account"
            className={inputClass}
            {...register("accountId")}
          >
            <option value="">— اختر الحساب —</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          {errors.accountId && (
            <p className="text-xs text-danger">{errors.accountId.message}</p>
          )}
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="e-receipt" className="block text-sm font-medium">
            إيصال / صورة (اختياري)
          </label>
          <input
            id="e-receipt"
            type="file"
            accept="image/*,application/pdf"
            onChange={handleFileChange}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm file:me-3 file:rounded-lg file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-800"
          />
          {fileError && <p className="text-xs text-danger">{fileError}</p>}
          {receiptFile && (
            <p className="text-xs text-muted">الملف المختار: {receiptFile.name}</p>
          )}
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="e-notes" className="block text-sm font-medium">
            ملاحظات
          </label>
          <textarea
            id="e-notes"
            className={`${inputClass} min-h-20`}
            {...register("notes")}
          />
        </div>
      </div>

      <div className="rounded-xl bg-muted-foreground/5 px-4 py-3 text-sm text-muted">
        القيد: <span className="num font-bold text-foreground">
          {formatCurrency(Math.round(amountPreview * 100))}
        </span>{" "}
        مدين على حساب التصنيف — دائن من حساب الدفع (حركة نقدية فورية)
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="btn-primary w-full sm:w-auto"
      >
        {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {isSubmitting ? "جارٍ الحفظ..." : "تسجيل المصروف"}
      </button>
    </form>
  );
}

function categoryName(
  glCode: string,
  categories: LocalExpenseCategory[]
): string {
  return categories.find((category) => category.glCode === glCode)?.name ?? glCode;
}

function receiptAttachmentLabel(attachmentId: string | null): string {
  return attachmentId ? "مع إيصال — " : "";
}
