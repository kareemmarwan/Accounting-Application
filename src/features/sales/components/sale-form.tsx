"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2, Plus } from "lucide-react";
import { toMinor, fromMinor } from "@/core/accounting/money";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  saleFormSchema,
  type SaleFormInput
} from "@/core/validation/sale";
import { formatCurrency } from "@/lib/format";
import { createSale } from "@/features/sales/services/sales-service";
import type { FinancialAccountRef } from "@/core/accounting/types";

const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

export interface SaleCustomerOption {
  id: string;
  name: string;
}

export interface SaleAccountOption {
  id: string;
  name: string;
  type: FinancialAccountRef["type"];
}

const CASH_METHODS = PAYMENT_METHODS.filter((method) => method !== "credit");

function toDatetimeLocal(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function SaleForm({
  businessId,
  customers,
  accounts,
  onCreated
}: {
  businessId: string;
  customers: SaleCustomerOption[];
  accounts: SaleAccountOption[];
  onCreated: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting }
  } = useForm<SaleFormInput>({
    resolver: zodResolver(saleFormSchema),
    defaultValues: {
      customerId: "",
      occurredAt: toDatetimeLocal(new Date().toISOString()),
      description: "",
      totalAmount: "",
      discount: "",
      paymentMethod: "cash",
      accountId: "",
      paidAmount: "",
      notes: ""
    }
  });

  const paymentMethod = watch("paymentMethod");
  const totalAmount = watch("totalAmount");
  const discount = watch("discount");
  const paidAmount = watch("paidAmount");
  const accountId = watch("accountId");

  const netPreview = useMemo(() => {
    try {
      const total = toMinor(totalAmount || "0");
      const disc = discount ? toMinor(discount) : 0;
      return total - disc;
    } catch {
      return 0;
    }
  }, [totalAmount, discount]);

  const remainingPreview = useMemo(() => {
    try {
      const paid = paidAmount ? toMinor(paidAmount) : 0;
      return Math.max(netPreview - paid, 0);
    } catch {
      return netPreview;
    }
  }, [netPreview, paidAmount]);

  useEffect(() => {
    if (paymentMethod === "credit") {
      setValue("paidAmount", "");
      setValue("accountId", "");
    } else if (
      paidAmount === "" &&
      netPreview > 0 &&
      !errors.paidAmount
    ) {
      setValue("paidAmount", fromMinor(netPreview));
    }
  }, [paymentMethod, netPreview, paidAmount, errors.paidAmount, setValue]);

  useEffect(() => {
    if (accountId && !accounts.some((account) => account.id === accountId)) {
      setValue("accountId", "");
    }
  }, [accounts, accountId, setValue]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSuccessMessage(null);
    const accountRef = accounts.find((account) => account.id === values.accountId);
    try {
      const result = await createSale(values, {
        businessId,
        accountRef: accountRef
          ? { id: accountRef.id, type: accountRef.type }
          : undefined
      });
      reset({
        customerId: "",
        occurredAt: toDatetimeLocal(new Date().toISOString()),
        description: "",
        totalAmount: "",
        discount: "",
        paymentMethod: "cash",
        accountId: "",
        paidAmount: "",
        notes: ""
      });
      setSuccessMessage(
        result.debt
          ? `سُجّل البيع ${result.sale.saleNumber} — أنشئ دين جديد بمبلغ ${formatCurrency(result.debt.amountMinor)}`
          : `سُجّل البيع ${result.sale.saleNumber} بنجاح`
      );
      onCreated();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "تعذر حفظ البيع");
    }
  });

  const isCredit = paymentMethod === "credit";
  const needsAccount = !isCredit;

  return (
    <form onSubmit={onSubmit} className="card space-y-4" noValidate>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary">
          <Plus className="h-5 w-5" aria-hidden />
        </span>
        <p className="text-sm font-bold">عملية بيع جديدة</p>
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
          <label htmlFor="occurredAt" className="block text-sm font-medium">
            التاريخ والوقت
          </label>
          <input
            id="occurredAt"
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
          <label htmlFor="customerId" className="block text-sm font-medium">
            العميل (اختياري للنقدي)
          </label>
          <select
            id="customerId"
            className={inputClass}
            {...register("customerId")}
          >
            <option value="">— بدون عميل —</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
          {errors.customerId && (
            <p className="text-xs text-danger">{errors.customerId.message}</p>
          )}
          {customers.length === 0 && (
            <p className="text-xs text-muted">
              لا يوجد عملاء بعد — البيع الآجل يتطلب عميلاً (أضفه من الـ
              Onboarding أو شاشة العملاء لاحقاً)
            </p>
          )}
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="description" className="block text-sm font-medium">
            الوصف
          </label>
          <input
            id="description"
            type="text"
            className={inputClass}
            placeholder="مثال: بيع 3 أرز بلكلوري"
            {...register("description")}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="totalAmount" className="block text-sm font-medium">
            الإجمالي (₪)
          </label>
          <input
            id="totalAmount"
            type="text"
            inputMode="decimal"
            dir="ltr"
            className={`${inputClass} num`}
            placeholder="0.00"
            {...register("totalAmount")}
          />
          {errors.totalAmount && (
            <p className="text-xs text-danger">{errors.totalAmount.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="discount" className="block text-sm font-medium">
            الخصم (₪)
          </label>
          <input
            id="discount"
            type="text"
            inputMode="decimal"
            dir="ltr"
            className={`${inputClass} num`}
            placeholder="0.00"
            {...register("discount")}
          />
          {errors.discount && (
            <p className="text-xs text-danger">{errors.discount.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="paymentMethod" className="block text-sm font-medium">
            طريقة الدفع
          </label>
          <select
            id="paymentMethod"
            className={inputClass}
            {...register("paymentMethod")}
          >
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {PAYMENT_METHOD_LABELS[method]}
              </option>
            ))}
          </select>
          {errors.paymentMethod && (
            <p className="text-xs text-danger">{errors.paymentMethod.message}</p>
          )}
        </div>

        {needsAccount && (
          <div className="space-y-1.5">
            <label htmlFor="accountId" className="block text-sm font-medium">
              الحساب المستلم
            </label>
            <select
              id="accountId"
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
            {accounts.length === 0 && (
              <p className="text-xs text-muted">
                لا توجد حسابات مالية — أكمل الـ Onboarding لإنشاء الصندوق
              </p>
            )}
          </div>
        )}

        {!isCredit && (
          <div className="space-y-1.5">
            <label htmlFor="paidAmount" className="block text-sm font-medium">
              المدفوع (₪)
            </label>
            <input
              id="paidAmount"
              type="text"
              inputMode="decimal"
              dir="ltr"
              className={`${inputClass} num`}
              placeholder="0.00"
              {...register("paidAmount")}
            />
            {errors.paidAmount && (
              <p className="text-xs text-danger">{errors.paidAmount.message}</p>
            )}
            <p className="text-xs text-muted">
              أقل من الصافي = بيع مختلط (الفرق دين على العميل)
            </p>
          </div>
        )}

        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="notes" className="block text-sm font-medium">
            ملاحظات
          </label>
          <textarea
            id="notes"
            className={`${inputClass} min-h-20`}
            {...register("notes")}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted-foreground/5 px-4 py-3 text-sm">
        <span className="text-muted">
          الصافي:{" "}
          <span className="num font-bold text-foreground">
            {formatCurrency(netPreview)}
          </span>
        </span>
        <span className="text-muted">
          المتبقي:{" "}
          <span className="num font-bold text-foreground">
            {formatCurrency(remainingPreview)}
          </span>
        </span>
      </div>

      <button type="submit" disabled={isSubmitting} className="btn-primary w-full sm:w-auto">
        {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {isSubmitting ? "جارٍ الحفظ..." : "تسجيل البيع"}
      </button>
    </form>
  );
}

export { CASH_METHODS };
