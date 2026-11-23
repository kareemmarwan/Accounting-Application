"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { LoadingScreen } from "@/components/loading-screen";
import {
  Archive,
  ArchiveRestore,
  ArrowDownCircle,
  ArrowLeftRight,
  ArrowUpCircle,
  Banknote,
  FileText,
  Landmark,
  Pencil,
  Plus,
  Scale,
  Store,
  Trash2,
  Wallet,
  X
} from "lucide-react";
import { getDB, type LocalFinancialAccount } from "@/core/db/db";
import { formatCurrency } from "@/lib/format";
import {
  ACCOUNT_PROVIDER_LABELS,
  ACCOUNT_TYPE_LABELS
} from "@/core/validation/account";
import { AccountForm } from "@/features/accounts/components/account-form";
import {
  AccountOperationForm,
  type AccountOperationType,
  type AccountOption
} from "@/features/accounts/components/account-operation-form";
import { AccountStatementCard } from "@/features/accounts/components/account-statement";
import {
  deleteFinancialAccount,
  setFinancialAccountActive,
  type AccountContext
} from "@/features/accounts/services/accounts-service";

type Filter = "active" | "archived";

const FILTER_LABELS: Record<Filter, string> = {
  active: "النشطة",
  archived: "المؤرشفة"
};

export function AccountsPageClient() {
  const businesses = useLiveQuery(() => getDB().businesses.toArray(), []);
  const accounts = useLiveQuery(() => getDB().financialAccounts.toArray(), []);
  const [filter, setFilter] = useState<Filter>("active");
  const [formState, setFormState] = useState<
    { mode: "create" } | { mode: "edit"; accountId: string } | null
  >(null);
  const [opState, setOpState] = useState<{
    op: AccountOperationType;
    accountId?: string;
  } | null>(null);
  const [statementId, setStatementId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 6000);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const sortedBusinesses = [...(businesses ?? [])].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
  );
  const business = sortedBusinesses[0] ?? null;

  const visibleAccounts = useMemo(() => {
    const rows = (accounts ?? []).filter(
      (account) =>
        !account.deletedAt &&
        (filter === "active" ? account.isActive : !account.isActive)
    );
    return rows.sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [accounts, filter]);

  const activeAccounts = useMemo(
    () =>
      (accounts ?? [])
        .filter((account) => account.isActive && !account.deletedAt)
        .sort((a, b) => a.name.localeCompare(b.name, "ar")),
    [accounts]
  );

  const summary = useMemo(() => {
    let total = 0;
    let cash = 0;
    let bankAndWallets = 0;
    for (const account of activeAccounts) {
      total += account.currentBalanceMinor;
      if (account.type === "cash") {
        cash += account.currentBalanceMinor;
      } else {
        bankAndWallets += account.currentBalanceMinor;
      }
    }
    return { total, cash, bankAndWallets };
  }, [activeAccounts]);

  if (businesses === undefined) {
    return <LoadingScreen />;
  }

  if (!business) {
    return (
      <div className="card flex flex-col items-start gap-4">
        <div className="inline-flex rounded-xl bg-primary-50 p-3 text-primary">
          <Store className="h-6 w-6" aria-hidden />
        </div>
        <p className="text-sm leading-relaxed text-muted">
          لا يوجد مشروع نشط على هذا الجهاز — أكمل الـ Onboarding لإنشاء الصندوق
          والحسابات المالية.
        </p>
        <Link href="/onboarding" className="btn-primary">
          إعداد المشروع
        </Link>
      </div>
    );
  }

  const ctx: AccountContext = { businessId: business.id };
  const editingAccount =
    formState?.mode === "edit"
      ? (accounts ?? []).find((account) => account.id === formState.accountId)
      : undefined;
  const statementAccount =
    statementId != null
      ? (accounts ?? []).find((account) => account.id === statementId)
      : undefined;

  const accountOptions: AccountOption[] = activeAccounts.map((account) => ({
    id: account.id,
    name: account.name,
    type: account.type,
    balanceMinor: account.currentBalanceMinor
  }));

  async function handleArchive(account: LocalFinancialAccount) {
    setActionError(null);
    try {
      await setFinancialAccountActive(account.id, !account.isActive, ctx);
      setFlash(
        account.isActive
          ? `أُرشِف حساب «${account.name}»`
          : `عُيد تنشيط حساب «${account.name}»`
      );
      setRefreshKey((key) => key + 1);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "تعذر تغيير حالة الحساب"
      );
    }
  }

  async function handleDelete(account: LocalFinancialAccount) {
    setActionError(null);
    if (
      !window.confirm(
        `حذف حساب «${account.name}»؟ سيُحذف نهائياً من قوائمك بعد المزامنة.`
      )
    ) {
      return;
    }
    try {
      await deleteFinancialAccount(account.id, ctx);
      setFlash(`حُذف حساب «${account.name}»`);
      setRefreshKey((key) => key + 1);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "تعذر حذف الحساب"
      );
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">الحسابات المالية</h1>
          <p className="text-sm text-muted">
            الصندوق والبنوك والمحافظ — كل عملية بقيد متوازن تلقائي
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpState(null);
            setStatementId(null);
            setFormState({ mode: "create" });
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className="btn-primary"
        >
          <Plus className="h-4 w-4" aria-hidden />
          حساب جديد
        </button>
      </div>

      {flash && (
        <div
          role="status"
          className="flex items-start justify-between gap-2 rounded-xl border border-primary-200 bg-primary-50 p-3 text-xs leading-relaxed text-primary-800"
        >
          <span>{flash}</span>
          <button
            type="button"
            onClick={() => setFlash(null)}
            aria-label="إخفاء الرسالة"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="flex items-start justify-between gap-2 rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs leading-relaxed text-danger"
        >
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label="إخفاء الخطأ"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card flex items-center gap-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary">
            <Wallet className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-xs text-muted">إجمالي الأرصدة</p>
            <p className="num text-xl font-bold">
              {formatCurrency(summary.total)}
            </p>
          </div>
        </div>
        <div className="card flex items-center gap-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary">
            <Banknote className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-xs text-muted">الصناديق النقدية</p>
            <p className="num text-xl font-bold">
              {formatCurrency(summary.cash)}
            </p>
          </div>
        </div>
        <div className="card flex items-center gap-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary">
            <Landmark className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-xs text-muted">البنوك والمحافظ</p>
            <p className="num text-xl font-bold">
              {formatCurrency(summary.bankAndWallets)}
            </p>
          </div>
        </div>
      </div>

      {formState?.mode === "create" && (
        <AccountForm
          mode="create"
          businessId={business.id}
          onSaved={(message) => {
            setFormState(null);
            setFlash(message);
            setRefreshKey((key) => key + 1);
          }}
          onCancel={() => setFormState(null)}
        />
      )}

      {formState?.mode === "edit" && editingAccount && (
        <AccountForm
          mode="edit"
          account={editingAccount}
          businessId={business.id}
          onSaved={(message) => {
            setFormState(null);
            setFlash(message);
            setRefreshKey((key) => key + 1);
          }}
          onCancel={() => setFormState(null)}
        />
      )}

      {opState && (
        <AccountOperationForm
          key={`${opState.op}-${opState.accountId ?? ""}`}
          operation={opState.op}
          accounts={accountOptions}
          defaultAccountId={opState.accountId}
          businessId={business.id}
          onDone={(message) => {
            setOpState(null);
            setFlash(message);
            setRefreshKey((key) => key + 1);
          }}
        />
      )}

      <div className="flex gap-2">
        {(Object.keys(FILTER_LABELS) as Filter[]).map((key) => {
          const count = (accounts ?? []).filter(
            (account) =>
              !account.deletedAt && (key === "active" ? account.isActive : !account.isActive)
          ).length;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                filter === key
                  ? "border-primary bg-primary-50 text-primary-800"
                  : "border-border bg-surface hover:border-primary-200"
              }`}
            >
              {FILTER_LABELS[key]}
              <span className="ms-2 text-xs text-muted">{count}</span>
            </button>
          );
        })}
      </div>

      {visibleAccounts.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 py-10 text-center">
          <div className="inline-flex rounded-xl bg-primary-50 p-3 text-primary">
            <Wallet className="h-6 w-6" aria-hidden />
          </div>
          <p className="text-sm text-muted">
            {filter === "active"
              ? "لا حسابات نشطة — أنشئ صندوقك أو حسابك البنكي الأول"
              : "لا حسابات مؤرشفة"}
          </p>
          {filter === "active" && formState === null && (
            <button
              type="button"
              onClick={() => setFormState({ mode: "create" })}
              className="btn-primary"
            >
              <Plus className="h-4 w-4" aria-hidden />
              حساب جديد
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleAccounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              onDeposit={() => {
                setFormState(null);
                setStatementId(null);
                setOpState({ op: "deposit", accountId: account.id });
              }}
              onWithdraw={() => {
                setFormState(null);
                setStatementId(null);
                setOpState({ op: "withdraw", accountId: account.id });
              }}
              onTransfer={() => {
                setFormState(null);
                setStatementId(null);
                setOpState({ op: "transfer", accountId: account.id });
              }}
              onAdjust={() => {
                setFormState(null);
                setStatementId(null);
                setOpState({ op: "adjust", accountId: account.id });
              }}
              onStatement={() => {
                setFormState(null);
                setOpState(null);
                setStatementId(account.id);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              onEdit={() => {
                setOpState(null);
                setStatementId(null);
                setFormState({ mode: "edit", accountId: account.id });
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              onArchive={() => handleArchive(account)}
              onDelete={() => handleDelete(account)}
            />
          ))}
        </div>
      )}

      {statementAccount && (
        <AccountStatementCard
          account={statementAccount}
          refreshKey={refreshKey}
          onClose={() => setStatementId(null)}
        />
      )}
    </div>
  );
}

const TYPE_BADGES: Record<string, string> = {
  cash: "bg-primary-50 text-primary-700",
  bank: "bg-secondary/10 text-secondary",
  wallet: "bg-warning/10 text-warning",
  other: "bg-muted-foreground/10 text-muted"
};

function AccountCard({
  account,
  onDeposit,
  onWithdraw,
  onTransfer,
  onAdjust,
  onStatement,
  onEdit,
  onArchive,
  onDelete
}: {
  account: LocalFinancialAccount;
  onDeposit: () => void;
  onWithdraw: () => void;
  onTransfer: () => void;
  onAdjust: () => void;
  onStatement: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const providerLabel =
    account.provider != null
      ? (ACCOUNT_PROVIDER_LABELS[account.provider] ?? account.provider)
      : null;

  return (
    <div className="card flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
              TYPE_BADGES[account.type] ?? TYPE_BADGES.other!
            }`}
          >
            {ACCOUNT_TYPE_LABELS[account.type]}
          </span>
          {!account.isActive && (
            <span className="rounded-full bg-muted-foreground/10 px-2.5 py-1 text-[11px] font-bold text-muted">
              مؤرشف
            </span>
          )}
          {account.syncStatus === "pending" && (
            <span className="rounded-full bg-warning/10 px-2.5 py-1 text-[11px] font-bold text-warning">
              بانتظار المزامنة
            </span>
          )}
          {account.syncStatus === "failed" && (
            <span className="rounded-full bg-danger/10 px-2.5 py-1 text-[11px] font-bold text-danger">
              فشل المزامنة
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-lg border border-border p-1.5 hover:bg-muted-foreground/10"
            title="تعديل الحساب"
            aria-label="تعديل الحساب"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </button>
          {account.isActive ? (
            <button
              type="button"
              onClick={onArchive}
              className="rounded-lg border border-border p-1.5 hover:bg-muted-foreground/10"
              title="أرشفة الحساب"
              aria-label="أرشفة الحساب"
            >
              <Archive className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              onClick={onArchive}
              className="rounded-lg border border-border p-1.5 hover:bg-muted-foreground/10"
              title="إعادة التنشيط"
              aria-label="إعادة التنشيط"
            >
              <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
          {account.currentBalanceMinor === 0 && (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-lg border border-danger/40 p-1.5 text-danger hover:bg-danger/10"
              title="حذف الحساب"
              aria-label="حذف الحساب"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div>
        <p className="text-base font-bold">{account.name}</p>
        {providerLabel && (
          <p className="text-xs text-muted">المزود: {providerLabel}</p>
        )}
      </div>

      <div>
        <p className="text-xs text-muted">الرصيد الحالي</p>
        <p className="num text-2xl font-bold text-primary">
          {formatCurrency(account.currentBalanceMinor)}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-xl bg-muted-foreground/5 p-3 text-center text-xs">
        <div>
          <p className="text-muted">افتتاحي</p>
          <p className="num font-bold">
            {formatCurrency(account.openingBalanceMinor)}
          </p>
        </div>
        <div>
          <p className="text-muted">إيداعات</p>
          <p className="num font-bold text-primary">
            {formatCurrency(account.totalDepositsMinor)}
          </p>
        </div>
        <div>
          <p className="text-muted">سحوبات</p>
          <p className="num font-bold text-danger">
            {formatCurrency(account.totalWithdrawalsMinor)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {account.isActive && (
          <>
            <button
              type="button"
              onClick={onDeposit}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary-700"
            >
              <ArrowDownCircle className="h-3.5 w-3.5" aria-hidden />
              إيداع
            </button>
            <button
              type="button"
              onClick={onWithdraw}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted-foreground/10"
            >
              <ArrowUpCircle className="h-3.5 w-3.5" aria-hidden />
              سحب
            </button>
            <button
              type="button"
              onClick={onTransfer}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted-foreground/10"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
              تحويل
            </button>
            <button
              type="button"
              onClick={onAdjust}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted-foreground/10"
            >
              <Scale className="h-3.5 w-3.5" aria-hidden />
              تسوية
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onStatement}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted-foreground/10"
        >
          <FileText className="h-3.5 w-3.5" aria-hidden />
          كشف حساب
        </button>
      </div>
    </div>
  );
}
