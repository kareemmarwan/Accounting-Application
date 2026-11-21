"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2, Wallet } from "lucide-react";
import {
  ACCOUNT_PROVIDER_LABELS,
  ACCOUNT_PROVIDERS,
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  accountProviderOrNull,
  accountRequiresProvider,
  financialAccountFormSchema,
  financialAccountUpdateSchema,
  type FinancialAccountFormInput,
  type FinancialAccountUpdateInput
} from "@/core/validation/account";
import { formatCurrency } from "@/lib/format";
import {
  createFinancialAccount,
  updateFinancialAccount,
  type AccountContext
} from "@/features/accounts/services/accounts-service";
import type { LocalFinancialAccount } from "@/core/db/db";

const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

function FormHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary">
        <Wallet className="h-5 w-5" aria-hidden />
      </span>
      <div>
        <p className="text-sm font-bold">{title}</p>
        <p className="text-xs text-muted">{subtitle}</p>
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs leading-relaxed text-danger"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

function ProviderSelect({
  registerField,
  error
}: {
  registerField: object;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor="acc-provider" className="block text-sm font-medium">
        المزود
      </label>
      <select id="acc-provider" className={inputClass} {...registerField}>
        <option value="">— اختر المزود —</option>
        {ACCOUNT_PROVIDERS.map((provider) => (
          <option key={provider} value={provider}>
            {ACCOUNT_PROVIDER_LABELS[provider]}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function CreateAccountForm({
  businessId,
  onSaved,
  onCancel
}: {
  businessId: string;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const ctx: AccountContext = { businessId };
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting }
  } = useForm<FinancialAccountFormInput>({
    resolver: zodResolver(financialAccountFormSchema),
    defaultValues: {
      name: "",
      type: "cash",
      provider: null,
      openingBalance: "0.00"
    }
  });

  const type = watch("type");

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const result = await createFinancialAccount(values, ctx);
      onSaved(
        `أُنشئ حساب «${result.account.name}» برصيد ${formatCurrency(
          result.account.currentBalanceMinor
        )}`
      );
    } catch (error) {
      setServerError(
        error instanceof Error ? error.message : "تعذر إنشاء الحساب"
      );
    }
  });

  return (
    <form
      onSubmit={onSubmit}
      className="card space-y-4 border-primary-200"
      noValidate
    >
      <FormHeader
        title="حساب جديد"
        subtitle="الصندوق والبنوك والمحافظ — الرصيد الافتتاحي يقيد على رأس المال (3100)"
      />

      {serverError && <ErrorBanner message={serverError} />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="acc-name" className="block text-sm font-medium">
            اسم الحساب
          </label>
          <input
            id="acc-name"
            type="text"
            placeholder="مثال: الصندوق الرئيسي، بنك فلسطين"
            className={inputClass}
            {...register("name")}
          />
          {errors.name && (
            <p className="text-xs text-danger">{errors.name.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="acc-type" className="block text-sm font-medium">
            نوع الحساب
          </label>
          <select id="acc-type" className={inputClass} {...register("type")}>
            {ACCOUNT_TYPES.map((typeOption) => (
              <option key={typeOption} value={typeOption}>
                {ACCOUNT_TYPE_LABELS[typeOption]}
              </option>
            ))}
          </select>
          {errors.type && (
            <p className="text-xs text-danger">{errors.type.message}</p>
          )}
        </div>

        {accountRequiresProvider(type) && (
          <ProviderSelect
            registerField={register("provider")}
            error={errors.provider?.message}
          />
        )}

        <div className="space-y-1.5">
          <label htmlFor="acc-opening" className="block text-sm font-medium">
            الرصيد الافتتاحي (₪)
          </label>
          <input
            id="acc-opening"
            type="text"
            inputMode="decimal"
            dir="ltr"
            placeholder="0.00"
            className={`${inputClass} num`}
            {...register("openingBalance")}
          />
          {errors.openingBalance && (
            <p className="text-xs text-danger">
              {errors.openingBalance.message}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="btn-primary w-full sm:w-auto"
        >
          {isSubmitting && (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          )}
          {isSubmitting ? "جارٍ الحفظ..." : "إنشاء الحساب"}
        </button>
        <button type="button" onClick={onCancel} className="btn-outline">
          إلغاء
        </button>
      </div>
    </form>
  );
}

function EditAccountForm({
  account,
  businessId,
  onSaved,
  onCancel
}: {
  account: LocalFinancialAccount;
  businessId: string;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const ctx: AccountContext = { businessId };
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<FinancialAccountUpdateInput>({
    resolver: zodResolver(financialAccountUpdateSchema),
    defaultValues: {
      name: account.name,
      provider: accountProviderOrNull(account.provider)
    }
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const result = await updateFinancialAccount(account.id, values, ctx);
      onSaved(`حُفظ تعديل حساب «${result.account.name}»`);
    } catch (error) {
      setServerError(
        error instanceof Error ? error.message : "تعذر تعديل الحساب"
      );
    }
  });

  return (
    <form
      onSubmit={onSubmit}
      className="card space-y-4 border-primary-200"
      noValidate
    >
      <FormHeader
        title="تعديل حساب"
        subtitle="الاسم والمزود فقط قابلان للتعديل — النوع والرصيد الافتتاحي ثابتان"
      />

      {serverError && <ErrorBanner message={serverError} />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="acc-name" className="block text-sm font-medium">
            اسم الحساب
          </label>
          <input
            id="acc-name"
            type="text"
            className={inputClass}
            {...register("name")}
          />
          {errors.name && (
            <p className="text-xs text-danger">{errors.name.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <span className="block text-sm font-medium">نوع الحساب</span>
          <p className="rounded-xl bg-muted-foreground/5 px-3 py-2.5 text-sm text-muted">
            {ACCOUNT_TYPE_LABELS[account.type]}
          </p>
        </div>

        {accountRequiresProvider(account.type) && (
          <ProviderSelect
            registerField={register("provider")}
            error={errors.provider?.message}
          />
        )}

        <div className="space-y-1.5">
          <span className="block text-sm font-medium">الرصيد الحالي</span>
          <p className="num rounded-xl bg-muted-foreground/5 px-3 py-2.5 text-sm font-bold">
            {formatCurrency(account.currentBalanceMinor)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="btn-primary w-full sm:w-auto"
        >
          {isSubmitting && (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          )}
          {isSubmitting ? "جارٍ الحفظ..." : "حفظ التعديل"}
        </button>
        <button type="button" onClick={onCancel} className="btn-outline">
          إلغاء
        </button>
      </div>
    </form>
  );
}

export function AccountForm(props: {
  mode: "create" | "edit";
  account?: LocalFinancialAccount;
  businessId: string;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  if (props.mode === "edit" && props.account) {
    return (
      <EditAccountForm
        account={props.account}
        businessId={props.businessId}
        onSaved={props.onSaved}
        onCancel={props.onCancel}
      />
    );
  }
  return (
    <CreateAccountForm
      businessId={props.businessId}
      onSaved={props.onSaved}
      onCancel={props.onCancel}
    />
  );
}
