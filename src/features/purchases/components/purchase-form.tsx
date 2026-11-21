"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2, ShoppingBag } from "lucide-react";
import { toMinor, fromMinor } from "@/core/accounting/money";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS
} from "@/core/validation/sale";
import {
  TRANSFER_METHODS,
  purchaseFormSchema,
  type PurchaseFormInput
} from "@/core/validation/purchase";
import { formatCurrency } from "@/lib/format";
import { createPurchase } from "@/features/purchases/services/purchases-service";
import type { FinancialAccountRef } from "@/core/accounting/types";

const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

export interface PurchaseSupplierOption {
  id: string;
  name: string;
}

export interface PurchaseAccountOption {
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

export function PurchaseForm({
  businessId,
  suppliers,
  accounts,
  onCreated
}: {
  businessId: string;
  suppliers: PurchaseSupplierOption[];
  accounts: PurchaseAccountOption[];
  onCreated: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting }
  } = useForm<PurchaseFormInput>({
    resolver: zodResolver(purchaseFormSchema),
    defaultValues: {
      supplierId: "",
      occurredAt: toDatetimeLocal(new Date().toISOString()),
      description: "",
      totalAmount: "",
      discount: "",
      paymentMethod: "cash",
      accountId: "",
      paidAmount: "",
      transferReference: "",
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
    } else if (paidAmount === "" && netPreview > 0 && !errors.paidAmount) {
      setValue("paidAmount", fromMinor(netPreview));
    }
  }, [paymentMethod, netPreview, paidAmount, errors.paidAmount, setValue]);

  useEffect(() => {
    if (accountId && !accounts.some((account) => account.id === accountId)) {
      setValue("accountId", "");
    }
  }, [accounts, accountId, setValue]);

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
    const accountRef = accounts.find(
      (account) => account.id === values.accountId
    );
    try {
      const result = await createPurchase(values, {
        businessId,
        accountRef: accountRef
          ? { id: accountRef.id, type: accountRef.type }
          : undefined,
        receiptFile
      });
      reset({
        supplierId: "",
        occurredAt: toDatetimeLocal(new Date().toISOString()),
        description: "",
        totalAmount: "",
        discount: "",
        paymentMethod: "cash",
        accountId: "",
        paidAmount: "",
        transferReference: "",
        notes: ""
      });
      setReceiptFile(null);
      setSuccessMessage(
        result.debt
          ? `سُجّل الشراء ${result.purchase.purchaseNumber} — أنشئ دين مستحق على المورد بمبلغ ${formatCurrency(result.debt.amountMinor)}`
          : `سُجّل الشراء ${result.purchase.purchaseNumber} بنجاح`
      );
      onCreated();
    } catch (error) {
      setServerError(
        error instanceof Error ? error.message : "تعذر حفظ الشراء"
      );
    }
  });

  const isCredit = paymentMethod === "credit";
  const showTransferRef = TRANSFER_METHODS.includes(paymentMethod);

  return (
    <form onSubmit={onSubmit} className="card space-y-4" noValidate>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary">
          <ShoppingBag className="h-5 w-5" aria-hidden />
        </span>
        <p className="text-sm font-bold">فاتورة مشتريات جديدة</p>
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
          <label htmlFor="p-occurredAt" className="block text-sm font-medium">
            التاريخ والوقت
          </label>
          <input
            id="p-occurredAt"
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
          <label htmlFor="p-supplierId" className="block text-sm font-medium">
            المورد (اختياري للنقدي)
          </label>
          <select
            id="p-supplierId"
            className={inputClass}
            {...register("supplierId")}
          >
            <option value="">— بدون مورد —</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
          {errors.supplierId && (
            <p className="text-xs text-danger">{errors.supplierId.message}</p>
          )}
          {suppliers.length === 0 && (
            <p className="text-xs text-muted">
              لا يوجد موردون بعد — الشراء الآجل يتطلب مورداً (أضفه من الـ
              Onboarding أو شاشة الموردين لاحقاً)
            </p>
          )}
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="p-description" className="block text-sm font-medium">
            الوصف
          </label>
          <input
            id="p-description"
            type="text"
            className={inputClass}
            placeholder="مثال: فاتورة بضائع من مورد الكهربائيات"
            {...register("description")}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="p-total" className="block text-sm font-medium">
            الإجمالي (₪)
          </label>
          <input
            id="p-total"
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
          <label htmlFor="p-discount" className="block text-sm font-medium">
            الخصم (₪)
          </label>
          <input
            id="p-discount"
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
          <label htmlFor="p-paymentMethod" className="block text-sm font-medium">
            طريقة الدفع
          </label>
          <select
            id="p-paymentMethod"
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

        {showTransferRef && (
          <div className="space-y-1.5">
            <label htmlFor="p-transferRef" className="block text-sm font-medium">
              رقم التحويل
            </label>
            <input
              id="p-transferRef"
              type="text"
              dir="ltr"
              className={`${inputClass} num`}
              placeholder="مثال: TRX-2026-0001"
              {...register("transferReference")}
            />
          </div>
        )}

        {!isCredit && (
          <>
            <div className="space-y-1.5">
              <label htmlFor="p-accountId" className="block text-sm font-medium">
                حساب الدفع
              </label>
              <select
                id="p-accountId"
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

            <div className="space-y-1.5">
              <label htmlFor="p-paid" className="block text-sm font-medium">
                المدفوع (₪)
              </label>
              <input
                id="p-paid"
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
                أقل من الصافي = شراء مختلط (الفرق دين على المورد)
              </p>
            </div>
          </>
        )}

        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="p-receipt" className="block text-sm font-medium">
            صورة الفاتورة / إثبات الدفع (اختياري)
          </label>
          <input
            id="p-receipt"
            type="file"
            accept="image/*,application/pdf"
            onChange={handleFileChange}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm file:me-3 file:rounded-lg file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-800"
          />
          {fileError && <p className="text-xs text-danger">{fileError}</p>}
          {receiptFile && (
            <p className="text-xs text-muted">
              الملف المختار: {receiptFile.name}
            </p>
          )}
          <p className="text-xs text-muted">يُحفظ محلياً ويُرفع مع المزامنة</p>
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="p-notes" className="block text-sm font-medium">
            ملاحظات
          </label>
          <textarea
            id="p-notes"
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

      <button
        type="submit"
        disabled={isSubmitting}
        className="btn-primary w-full sm:w-auto"
      >
        {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {isSubmitting ? "جارٍ الحفظ..." : "تسجيل الشراء"}
      </button>
    </form>
  );
}
