"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, ArrowRight, Loader2, Store } from "lucide-react";
import type { ZodError } from "zod";
import {
  getDB,
  type LocalBusiness,
  type LocalExpenseCategory,
  type LocalFinancialAccount
} from "@/core/db/db";
import { toMinor } from "@/core/accounting/money";
import { formatCurrency } from "@/lib/format";
import {
  ACCOUNT_PROVIDER_LABELS,
  ACCOUNT_PROVIDERS,
  BUSINESS_TYPE_LABELS,
  BUSINESS_TYPES,
  CURRENCIES,
  bankAccountStepSchema,
  businessNameStepSchema,
  businessStepSchema,
  cashAccountStepSchema,
  currencyStepSchema,
  customerStepSchema,
  ownerStepSchema,
  supplierStepSchema,
  type AccountProviderValue,
  type BusinessTypeValue
} from "@/core/validation/onboarding";
import { createBusinessWithSetup } from "@/features/onboarding/server/actions";

const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

const CURRENCY_LABELS: Record<string, string> = {
  ILS: "شيكل (₪)",
  USD: "دولار ($)",
  JOD: "دينار أردني"
};

const BANK_TYPE_LABELS: Record<string, string> = {
  bank: "حساب بنكي",
  wallet: "محفظة إلكترونية",
  other: "أخرى"
};

interface WizardState {
  ownerName: string;
  businessName: string;
  businessType: BusinessTypeValue | "";
  currency: (typeof CURRENCIES)[number];
  cashName: string;
  cashOpeningBalance: string;
  addBank: boolean;
  bankName: string;
  bankType: "bank" | "wallet" | "other";
  bankProvider: AccountProviderValue;
  bankOpeningBalance: string;
  customerName: string;
  customerPhone: string;
  supplierName: string;
  supplierPhone: string;
}

const initialState: WizardState = {
  ownerName: "",
  businessName: "",
  businessType: "",
  currency: "ILS",
  cashName: "الصندوق الرئيسي",
  cashOpeningBalance: "0.00",
  addBank: false,
  bankName: "",
  bankType: "bank",
  bankProvider: "bank_palestine",
  bankOpeningBalance: "0.00",
  customerName: "",
  customerPhone: "",
  supplierName: "",
  supplierPhone: ""
};

const STEP_TITLES = [
  "اسم صاحب المشروع",
  "اسم المشروع",
  "نوع النشاط",
  "العملة",
  "حساب الصندوق",
  "حساب بنكي أو محفظة",
  "أول عميل",
  "أول مورد",
  "المراجعة والإنشاء"
];

function firstIssueMessage(error: ZodError): string {
  return error.issues[0]?.message ?? "قيمة غير صالحة";
}

export function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(initialState);
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof WizardState>(key: K, value: WizardState[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  function validateCurrentStep(): string | null {
    switch (step) {
      case 0: {
        const result = ownerStepSchema.safeParse(state);
        return result.success ? null : firstIssueMessage(result.error);
      }
      case 1: {
        const result = businessNameStepSchema.safeParse(state);
        return result.success ? null : firstIssueMessage(result.error);
      }
      case 2: {
        const result = businessStepSchema.safeParse({
          businessName: state.businessName,
          businessType: state.businessType
        });
        return result.success ? null : firstIssueMessage(result.error);
      }
      case 3: {
        const result = currencyStepSchema.safeParse({ currency: state.currency });
        return result.success ? null : firstIssueMessage(result.error);
      }
      case 4: {
        const result = cashAccountStepSchema.safeParse({
          cashName: state.cashName,
          cashOpeningBalance: state.cashOpeningBalance
        });
        return result.success ? null : firstIssueMessage(result.error);
      }
      case 5: {
        if (!state.addBank) return null;
        const result = bankAccountStepSchema.safeParse({
          bankName: state.bankName,
          bankType: state.bankType,
          bankProvider: state.bankProvider,
          bankOpeningBalance: state.bankOpeningBalance
        });
        return result.success ? null : firstIssueMessage(result.error);
      }
      case 6: {
        if (!state.customerName) return null;
        const result = customerStepSchema.safeParse({
          customerName: state.customerName,
          customerPhone: state.customerPhone
        });
        return result.success ? null : firstIssueMessage(result.error);
      }
      case 7: {
        if (!state.supplierName) return null;
        const result = supplierStepSchema.safeParse({
          supplierName: state.supplierName,
          supplierPhone: state.supplierPhone
        });
        return result.success ? null : firstIssueMessage(result.error);
      }
      default:
        return null;
    }
  }

  function goNext() {
    const error = validateCurrentStep();
    setStepError(error);
    if (!error) setStep((value) => Math.min(value + 1, STEP_TITLES.length - 1));
  }

  function goBack() {
    setStepError(null);
    setStep((value) => Math.max(value - 1, 0));
  }

  async function submit() {
    if (!state.businessType) {
      setStepError("أكمل الخطوات السابقة أولاً");
      return;
    }
    setSubmitting(true);
    setStepError(null);
    try {
      const result = await createBusinessWithSetup({
        ownerName: state.ownerName,
        businessName: state.businessName,
        businessType: state.businessType,
        currency: state.currency,
        cashAccount: {
          name: state.cashName,
          openingBalanceMinor: toMinor(state.cashOpeningBalance)
        },
        bankAccount: state.addBank
          ? {
              name: state.bankName,
              type: state.bankType,
              provider: state.bankProvider,
              openingBalanceMinor: toMinor(state.bankOpeningBalance)
            }
          : null,
        firstCustomer: state.customerName
          ? { name: state.customerName, phone: state.customerPhone }
          : null,
        firstSupplier: state.supplierName
          ? { name: state.supplierName, phone: state.supplierPhone }
          : null
      });

      if (!result.ok) {
        setStepError(result.error);
        setSubmitting(false);
        return;
      }

      await cacheLocally(result);
      router.replace("/dashboard");
    } catch {
      setStepError("تعذر الاتصال بالخادم — تحقق من اتصالك بالإنترنت");
      setSubmitting(false);
    }
  }

  async function cacheLocally(result: Awaited<
    ReturnType<typeof createBusinessWithSetup>
  >) {
    if (!result.ok) return;
    const now = new Date().toISOString();
    const business: LocalBusiness = {
      id: result.business.id,
      name: result.business.name,
      businessType: result.business.businessType,
      ownerId: result.business.ownerId,
      currency: result.business.currency,
      phone: null,
      plan: result.business.plan,
      createdAt: now,
      updatedAt: now,
      version: 1
    };
    const accounts: LocalFinancialAccount[] = result.accounts.map((account) => ({
      id: account.id,
      businessId: account.businessId,
      name: account.name,
      type: account.type,
      provider: account.provider,
      currency: account.currency,
      openingBalanceMinor: account.openingBalanceMinor,
      currentBalanceMinor: account.currentBalanceMinor,
      totalDepositsMinor: account.totalDepositsMinor,
      totalWithdrawalsMinor: account.totalWithdrawalsMinor,
      isActive: account.isActive,
      updatedAt: account.updatedAt,
      syncStatus: "synced",
      version: account.version,
      deletedAt: null
    }));

    const categories: LocalExpenseCategory[] = result.categories.map(
      (category) => ({
        id: category.id,
        businessId: category.businessId,
        name: category.name,
        glCode: category.glCode,
        isSystem: category.isSystem,
        sortOrder: category.sortOrder
      })
    );

    try {
      const db = getDB();
      await db.transaction(
        "rw",
        db.businesses,
        db.financialAccounts,
        db.expenseCategories,
        async () => {
          await db.businesses.put(business);
          for (const account of accounts) {
            await db.financialAccounts.put(account);
          }
          for (const category of categories) {
            await db.expenseCategories.put(category);
          }
        }
      );
    } catch {
      void 0;
    }
  }

  const total = STEP_TITLES.length;

  return (
    <div className="card">
      <div className="mb-5 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary">
          <Store className="h-5 w-5" aria-hidden />
        </span>
        <div className="flex-1">
          <p className="text-sm font-bold">{STEP_TITLES[step]}</p>
          <p className="text-xs text-muted">
            خطوة {step + 1} من {total}
          </p>
        </div>
      </div>

      <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${((step + 1) / total) * 100}%` }}
        />
      </div>

      {stepError && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs leading-relaxed text-danger"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{stepError}</span>
        </div>
      )}

      <div className="space-y-4">
        {step === 0 && (
          <div className="space-y-1.5">
            <label htmlFor="ownerName" className="block text-sm font-medium">
              الاسم الكامل
            </label>
            <input
              id="ownerName"
              className={inputClass}
              value={state.ownerName}
              onChange={(event) => update("ownerName", event.target.value)}
              placeholder="مثال: أحمد محمد"
              autoComplete="name"
            />
            <p className="text-xs text-muted">
              يظهر في الملف الشخصي وسجلات العمليات
            </p>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-1.5">
            <label htmlFor="businessName" className="block text-sm font-medium">
              اسم المشروع
            </label>
            <input
              id="businessName"
              className={inputClass}
              value={state.businessName}
              onChange={(event) => update("businessName", event.target.value)}
              placeholder="مثال: بقالة النور"
            />
          </div>
        )}

        {step === 2 && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {BUSINESS_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => update("businessType", type)}
                className={`rounded-xl border px-4 py-3 text-start text-sm font-medium transition-colors ${
                  state.businessType === type
                    ? "border-primary bg-primary-50 text-primary-800"
                    : "border-border bg-surface hover:border-primary-200"
                }`}
              >
                {BUSINESS_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        )}

        {step === 3 && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {CURRENCIES.map((currency) => (
              <button
                key={currency}
                type="button"
                onClick={() => update("currency", currency)}
                className={`rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${
                  state.currency === currency
                    ? "border-primary bg-primary-50 text-primary-800"
                    : "border-border bg-surface hover:border-primary-200"
                }`}
              >
                {CURRENCY_LABELS[currency]}
              </button>
            ))}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="cashName" className="block text-sm font-medium">
                اسم حساب الصندوق
              </label>
              <input
                id="cashName"
                className={inputClass}
                value={state.cashName}
                onChange={(event) => update("cashName", event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="cashOpening" className="block text-sm font-medium">
                الرصيد الافتتاحي ({CURRENCY_LABELS[state.currency]})
              </label>
              <input
                id="cashOpening"
                type="text"
                inputMode="decimal"
                dir="ltr"
                className={`${inputClass} num`}
                value={state.cashOpeningBalance}
                onChange={(event) =>
                  update("cashOpeningBalance", event.target.value)
                }
              />
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-4">
            <label className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={state.addBank}
                onChange={(event) => update("addBank", event.target.checked)}
              />
              <span className="text-sm font-medium">
                إضافة حساب بنكي أو محفظة إلكترونية (اختياري)
              </span>
            </label>

            {state.addBank && (
              <>
                <div className="space-y-1.5">
                  <label htmlFor="bankName" className="block text-sm font-medium">
                    اسم الحساب
                  </label>
                  <input
                    id="bankName"
                    className={inputClass}
                    value={state.bankName}
                    onChange={(event) => update("bankName", event.target.value)}
                    placeholder="مثال: بنك فلسطين — حساب جاري"
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label htmlFor="bankType" className="block text-sm font-medium">
                      نوع الحساب
                    </label>
                    <select
                      id="bankType"
                      className={inputClass}
                      value={state.bankType}
                      onChange={(event) =>
                        update("bankType", event.target.value as WizardState["bankType"])
                      }
                    >
                      {Object.entries(BANK_TYPE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="bankProvider" className="block text-sm font-medium">
                      المزوّد
                    </label>
                    <select
                      id="bankProvider"
                      className={inputClass}
                      value={state.bankProvider}
                      onChange={(event) =>
                        update("bankProvider", event.target.value as AccountProviderValue)
                      }
                    >
                      {ACCOUNT_PROVIDERS.map((provider) => (
                        <option key={provider} value={provider}>
                          {ACCOUNT_PROVIDER_LABELS[provider]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="bankOpening" className="block text-sm font-medium">
                    الرصيد الافتتاحي ({CURRENCY_LABELS[state.currency]})
                  </label>
                  <input
                    id="bankOpening"
                    type="text"
                    inputMode="decimal"
                    dir="ltr"
                    className={`${inputClass} num`}
                    value={state.bankOpeningBalance}
                    onChange={(event) =>
                      update("bankOpeningBalance", event.target.value)
                    }
                  />
                </div>
              </>
            )}
          </div>
        )}

        {step === 6 && (
          <div className="space-y-4">
            <p className="text-xs text-muted">
              اختياري — يمكنك إضافة عملاء لاحقاً من شاشة العملاء
            </p>
            <div className="space-y-1.5">
              <label htmlFor="customerName" className="block text-sm font-medium">
                اسم العميل
              </label>
              <input
                id="customerName"
                className={inputClass}
                value={state.customerName}
                onChange={(event) => update("customerName", event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="customerPhone" className="block text-sm font-medium">
                رقم الهاتف
              </label>
              <input
                id="customerPhone"
                type="tel"
                dir="ltr"
                className={inputClass}
                value={state.customerPhone}
                onChange={(event) => update("customerPhone", event.target.value)}
                placeholder="0599••••••"
              />
            </div>
          </div>
        )}

        {step === 7 && (
          <div className="space-y-4">
            <p className="text-xs text-muted">
              اختياري — يمكنك إضافة موردين لاحقاً من شاشة الموردين
            </p>
            <div className="space-y-1.5">
              <label htmlFor="supplierName" className="block text-sm font-medium">
                اسم المورد
              </label>
              <input
                id="supplierName"
                className={inputClass}
                value={state.supplierName}
                onChange={(event) => update("supplierName", event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="supplierPhone" className="block text-sm font-medium">
                رقم الهاتف
              </label>
              <input
                id="supplierPhone"
                type="tel"
                dir="ltr"
                className={inputClass}
                value={state.supplierPhone}
                onChange={(event) => update("supplierPhone", event.target.value)}
                placeholder="0599••••••"
              />
            </div>
          </div>
        )}

        {step === 8 && (
          <dl className="divide-y divide-border rounded-xl border border-border">
            <ReviewRow label="صاحب المشروع" value={state.ownerName} />
            <ReviewRow label="اسم المشروع" value={state.businessName} />
            <ReviewRow
              label="نوع النشاط"
              value={
                state.businessType
                  ? BUSINESS_TYPE_LABELS[state.businessType]
                  : ""
              }
            />
            <ReviewRow label="العملة" value={CURRENCY_LABELS[state.currency] ?? state.currency} />
            <ReviewRow
              label="حساب الصندوق"
              value={`${state.cashName} — رصيد افتتاحي ${formatCurrency(
                toMinor(state.cashOpeningBalance)
              )}`}
            />
            {state.addBank && (
              <ReviewRow
                label="الحساب البنكي/المحفظة"
                value={`${state.bankName} (${BANK_TYPE_LABELS[state.bankType] ?? state.bankType}) — رصيد افتتاحي ${formatCurrency(
                  toMinor(state.bankOpeningBalance)
                )}`}
              />
            )}
            {state.customerName && (
              <ReviewRow label="أول عميل" value={state.customerName} />
            )}
            {state.supplierName && (
              <ReviewRow label="أول مورد" value={state.supplierName} />
            )}
          </dl>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={goBack}
          disabled={step === 0 || submitting}
          className="btn-outline"
        >
          <ArrowRight className="h-4 w-4" aria-hidden />
          السابق
        </button>

        {step < total - 1 ? (
          <button type="button" onClick={goNext} className="btn-primary">
            التالي
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="btn-primary"
          >
            {submitting && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            )}
            {submitting ? "جارٍ إنشاء المشروع..." : "إنشاء المشروع"}
          </button>
        )}
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-2.5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}
