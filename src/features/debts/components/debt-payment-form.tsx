"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, HandCoins, Loader2 } from "lucide-react";
import { fromMinor } from "@/core/accounting/money";
import {
  DEBT_PAYMENT_METHOD_LABELS,
  debtPaymentFormSchema,
  type DebtPaymentFormInput
} from "@/core/validation/debt-payment";
import { formatCurrency } from "@/lib/format";
import { createDebtPayment } from "@/features/debts/services/debts-service";
import type { FinancialAccountRef } from "@/core/accounting/types";
import type { LocalDebt } from "@/core/db/db";

const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

export interface PaymentAccountOption {
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

export function DebtPaymentForm({
  debt,
  accounts,
  businessId,
  onPaid
}: {
  debt: LocalDebt;
  accounts: PaymentAccountOption[];
  businessId: string;
  onPaid: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const defaultAmount = useMemo(
    () => fromMinor(debt.remainingAmountMinor),
    [debt.remainingAmountMinor]
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting }
  } = useForm<DebtPaymentFormInput>({
    resolver: zodResolver(debtPaymentFormSchema),
    defaultValues: {
      debtId: debt.id,
      amount: defaultAmount,
      occurredAt: toDatetimeLocal(new Date().toISOString()),
      paymentMethod: "cash",
      accountId: accounts[0]?.id ?? "",
      notes: ""
    }
  });

  useEffect(() => {
    reset({
      debtId: debt.id,
      amount: fromMinor(debt.remainingAmountMinor),
      occurredAt: toDatetimeLocal(new Date().toISOString()),
      paymentMethod: "cash",
      accountId: accounts[0]?.id ?? "",
      notes: ""
    });
    setServerError(null);
    setSuccessMessage(null);
  }, [debt, accounts, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSuccessMessage(null);
    const accountRef = accounts.find((account) => account.id === values.accountId);
    try {
      const result = await createDebtPayment(values, {
        businessId,
        accountRef: {
          id: values.accountId,
          type: accountRef?.type ?? "cash"
        }
      });
      setSuccessMessage(
        `سُجّلت الدفعة — المتبقي على الدين: ${formatCurrency(
          result.debt.remainingAmountMinor
        )}`
      );
      onPaid();
    } catch (error) {
      setServerError(
        error instanceof Error ? error.message : "تعذر تسجيل الدفعة"
      );
    }
  });

  return (
    <form onSubmit={onSubmit} className="card space-y-4 border-primary-200" noValidate>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary">
          <HandCoins className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-bold">تسجيل دفعة</p>
          <p className="text-xs text-muted">
            المتبقي على الدين:{" "}
            <span className="num font-bold text-foreground">
              {formatCurrency(debt.remainingAmountMinor)}
            </span>
          </p>
        </div>
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
          <label htmlFor="dp-amount" className="block text-sm font-medium">
            مبلغ الدفعة (₪) — جزئية متعددة حتى الصفر
          </label>
          <input
            id="dp-amount"
            type="text"
            inputMode="decimal"
            dir="ltr"
            className={`${inputClass} num`}
            {...register("amount")}
          />
          {errors.amount && (
            <p className="text-xs text-danger">{errors.amount.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="dp-occurredAt" className="block text-sm font-medium">
            التاريخ والوقت
          </label>
          <input
            id="dp-occurredAt"
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
          <label htmlFor="dp-method" className="block text-sm font-medium">
            طريقة الدفع
          </label>
          <select
            id="dp-method"
            className={inputClass}
            {...register("paymentMethod")}
          >
            {Object.entries(DEBT_PAYMENT_METHOD_LABELS).map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              )
            )}
          </select>
          {errors.paymentMethod && (
            <p className="text-xs text-danger">
              {errors.paymentMethod.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="dp-account" className="block text-sm font-medium">
            {debt.direction === "receivable" ? "حساب الاستلام" : "حساب الدفع"}
          </label>
          <select
            id="dp-account"
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
          <label htmlFor="dp-notes" className="block text-sm font-medium">
            ملاحظات
          </label>
          <input
            id="dp-notes"
            type="text"
            className={inputClass}
            {...register("notes")}
          />
        </div>
      </div>

      <button type="submit" disabled={isSubmitting} className="btn-primary w-full sm:w-auto">
        {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {isSubmitting ? "جارٍ الحفظ..." : "تسجيل الدفعة"}
      </button>
    </form>
  );
}
