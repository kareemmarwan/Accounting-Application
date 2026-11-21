"use client";

import { useEffect, useState } from "react";
import { useForm, type FieldValues, type Path, type UseFormRegister } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertCircle,
  ArrowDownCircle,
  ArrowLeftRight,
  ArrowUpCircle,
  Loader2,
  Scale
} from "lucide-react";
import { fromMinor } from "@/core/accounting/money";
import {
  accountAdjustFormSchema,
  accountOperationFormSchema,
  accountTransferFormSchema,
  type AccountAdjustFormInput,
  type AccountOperationFormInput,
  type AccountTransferFormInput
} from "@/core/validation/account";
import { formatCurrency } from "@/lib/format";
import {
  adjustAccountBalance,
  depositToAccount,
  transferBetweenAccounts,
  withdrawFromAccount,
  type AccountContext
} from "@/features/accounts/services/accounts-service";

const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

export type AccountOperationType = "deposit" | "withdraw" | "transfer" | "adjust";

export interface AccountOption {
  id: string;
  name: string;
  type: string;
  balanceMinor: number;
}

const OP_META: Record<
  AccountOperationType,
  { title: string; hint: string; icon: typeof ArrowDownCircle }
> = {
  deposit: {
    title: "إيداع نقدية",
    hint: "يزيد رصيد الحساب ويقيد مدين الحساب ودائن رأس المال (3100)",
    icon: ArrowDownCircle
  },
  withdraw: {
    title: "سحب نقدية",
    hint: "يخفض الرصيد ويقيد مدين رأس المال (3100) ودائن الحساب",
    icon: ArrowUpCircle
  },
  transfer: {
    title: "تحويل بين حسابين",
    hint: "قيد واحد متوازن — بلا إيراد ولا مصروف",
    icon: ArrowLeftRight
  },
  adjust: {
    title: "تسوية الرصيد",
    hint: "مطابقة الرصيد الدفتري مع العدّ الفعلي — الفرق يقيد على 5950",
    icon: Scale
  }
};

function toDatetimeLocal(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function AmountField<T extends FieldValues>({
  id,
  label,
  register,
  name
}: {
  id: string;
  label: string;
  register: UseFormRegister<T>;
  name: Path<T>;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        dir="ltr"
        placeholder="0.00"
        className={`${inputClass} num`}
        {...register(name)}
      />
    </div>
  );
}

function OccurredAtField<T extends FieldValues>({
  id,
  register,
  name
}: {
  id: string;
  register: UseFormRegister<T>;
  name: Path<T>;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        التاريخ والوقت
      </label>
      <input
        id={id}
        type="datetime-local"
        dir="ltr"
        className={inputClass}
        {...register(name)}
      />
    </div>
  );
}

function NotesField<T extends FieldValues>({
  id,
  register,
  name
}: {
  id: string;
  register: UseFormRegister<T>;
  name: Path<T>;
}) {
  return (
    <div className="space-y-1.5 sm:col-span-2">
      <label htmlFor={id} className="block text-sm font-medium">
        ملاحظات
      </label>
      <input id={id} type="text" className={inputClass} {...register(name)} />
    </div>
  );
}

function AccountSelectField<T extends FieldValues>({
  id,
  label,
  register,
  name,
  options,
  showBalance = true
}: {
  id: string;
  label: string;
  register: UseFormRegister<T>;
  name: Path<T>;
  options: AccountOption[];
  showBalance?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <select id={id} className={inputClass} {...register(name)}>
        <option value="">— اختر الحساب —</option>
        {options.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
            {showBalance ? ` (${formatCurrency(account.balanceMinor)})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

export function AccountOperationForm({
  operation,
  accounts,
  defaultAccountId,
  businessId,
  onDone
}: {
  operation: AccountOperationType;
  accounts: AccountOption[];
  defaultAccountId?: string;
  businessId: string;
  onDone: (message: string) => void;
}) {
  const meta = OP_META[operation];
  const ctx: AccountContext = { businessId };
  const [serverError, setServerError] = useState<string | null>(null);

  const fallbackId = defaultAccountId ?? accounts[0]?.id ?? "";

  const simpleForm = useForm<AccountOperationFormInput>({
    resolver: zodResolver(accountOperationFormSchema),
    defaultValues: {
      accountId: fallbackId,
      amount: "",
      occurredAt: toDatetimeLocal(new Date().toISOString()),
      notes: ""
    }
  });

  const transferForm = useForm<AccountTransferFormInput>({
    resolver: zodResolver(accountTransferFormSchema),
    defaultValues: {
      fromAccountId: fallbackId,
      toAccountId: "",
      amount: "",
      occurredAt: toDatetimeLocal(new Date().toISOString()),
      notes: ""
    }
  });

  const adjustForm = useForm<AccountAdjustFormInput>({
    resolver: zodResolver(accountAdjustFormSchema),
    defaultValues: {
      accountId: fallbackId,
      countedBalance: "",
      occurredAt: toDatetimeLocal(new Date().toISOString()),
      notes: ""
    }
  });

  const adjustAccountId = adjustForm.watch("accountId");
  useEffect(() => {
    const selected = accounts.find((account) => account.id === adjustAccountId);
    if (selected) {
      adjustForm.setValue("countedBalance", fromMinor(selected.balanceMinor));
    }
  }, [adjustAccountId, accounts, adjustForm]);

  const selectedAdjustAccount = accounts.find(
    (account) => account.id === adjustAccountId
  );

  const onSimple = simpleForm.handleSubmit(async (values) => {
    setServerError(null);
    try {
      if (operation === "deposit") {
        const result = await depositToAccount(values, ctx);
        onDone(
          `سُجّل الإيداع في «${result.account.name}» — الرصيد الجديد: ${formatCurrency(
            result.account.currentBalanceMinor
          )}`
        );
      } else {
        const result = await withdrawFromAccount(values, ctx);
        onDone(
          `سُجّل السحب من «${result.account.name}» — الرصيد الجديد: ${formatCurrency(
            result.account.currentBalanceMinor
          )}`
        );
      }
    } catch (error) {
      setServerError(
        error instanceof Error ? error.message : "تعذر تسجيل العملية"
      );
    }
  });

  const onTransfer = transferForm.handleSubmit(async (values) => {
    setServerError(null);
    try {
      const result = await transferBetweenAccounts(values, ctx);
      onDone(
        `تم التحويل — ${result.fromAccount.name}: ${formatCurrency(
          result.fromAccount.currentBalanceMinor
        )} / ${result.toAccount.name}: ${formatCurrency(
          result.toAccount.currentBalanceMinor
        )}`
      );
    } catch (error) {
      setServerError(
        error instanceof Error ? error.message : "تعذر تسجيل التحويل"
      );
    }
  });

  const onAdjust = adjustForm.handleSubmit(async (values) => {
    setServerError(null);
    try {
      const result = await adjustAccountBalance(values, ctx);
      onDone(
        result.diffMinor === 0
          ? "الرصيد المعدود مطابق للدفتري — لا حاجة لتسوية"
          : `سُجّلت تسوية «${result.account.name}» — الرصيد الجديد: ${formatCurrency(
              result.account.currentBalanceMinor
            )}`
      );
    } catch (error) {
      setServerError(
        error instanceof Error ? error.message : "تعذر تسجيل التسوية"
      );
    }
  });

  const isSimple = operation === "deposit" || operation === "withdraw";
  const isSubmitting = isSimple
    ? simpleForm.formState.isSubmitting
    : operation === "transfer"
      ? transferForm.formState.isSubmitting
      : adjustForm.formState.isSubmitting;

  if (accounts.length === 0) {
    return (
      <div className="card space-y-2 text-sm text-muted">
        <p className="font-bold text-foreground">{meta.title}</p>
        <p>لا توجد حسابات نشطة — أنشئ حساباً أولاً.</p>
      </div>
    );
  }

  const submitLabel = meta.title;

  return (
    <form
      onSubmit={isSimple ? onSimple : operation === "transfer" ? onTransfer : onAdjust}
      className="card space-y-4 border-primary-200"
      noValidate
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary">
          <meta.icon className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-bold">{meta.title}</p>
          <p className="text-xs text-muted">{meta.hint}</p>
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

      {isSimple && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <AccountSelectField
            id="op-account"
            label={operation === "deposit" ? "الحساب المستلم" : "الحساب المسحوب منه"}
            register={simpleForm.register}
            name="accountId"
            options={accounts}
          />
          <AmountField
            id="op-amount"
            label="المبلغ (₪)"
            register={simpleForm.register}
            name="amount"
          />
          <OccurredAtField
            id="op-occurredAt"
            register={simpleForm.register}
            name="occurredAt"
          />
          <NotesField
            id="op-notes"
            register={simpleForm.register}
            name="notes"
          />
        </div>
      )}

      {operation === "transfer" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <AccountSelectField
            id="tr-from"
            label="من حساب"
            register={transferForm.register}
            name="fromAccountId"
            options={accounts}
          />
          <AccountSelectField
            id="tr-to"
            label="إلى حساب"
            register={transferForm.register}
            name="toAccountId"
            options={accounts.filter(
              (account) => account.id !== transferForm.watch("fromAccountId")
            )}
          />
          <AmountField
            id="tr-amount"
            label="المبلغ (₪)"
            register={transferForm.register}
            name="amount"
          />
          <OccurredAtField
            id="tr-occurredAt"
            register={transferForm.register}
            name="occurredAt"
          />
          <NotesField
            id="tr-notes"
            register={transferForm.register}
            name="notes"
          />
        </div>
      )}

      {operation === "adjust" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <AccountSelectField
            id="adj-account"
            label="الحساب"
            register={adjustForm.register}
            name="accountId"
            options={accounts}
          />
          <AmountField
            id="adj-counted"
            label="الرصيد المعدود فعلياً (₪)"
            register={adjustForm.register}
            name="countedBalance"
          />
          {selectedAdjustAccount ? (
            <div className="space-y-1.5">
              <span className="block text-sm font-medium">
                الرصيد الدفتري الحالي
              </span>
              <p className="num rounded-xl bg-muted-foreground/5 px-3 py-2.5 text-sm font-bold">
                {formatCurrency(selectedAdjustAccount.balanceMinor)}
              </p>
            </div>
          ) : (
            <div />
          )}
          <OccurredAtField
            id="adj-occurredAt"
            register={adjustForm.register}
            name="occurredAt"
          />
          <NotesField
            id="adj-notes"
            register={adjustForm.register}
            name="notes"
          />
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="btn-primary w-full sm:w-auto"
      >
        {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {isSubmitting ? "جارٍ الحفظ..." : submitLabel}
      </button>
    </form>
  );
}
