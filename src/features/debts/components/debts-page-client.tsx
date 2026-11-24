"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { LoadingScreen } from "@/components/loading-screen";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  HandCoins,
  Receipt,
  Store
} from "lucide-react";
import { getDB, type LocalDebt, type LocalParty } from "@/core/db/db";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { DEBT_PAYMENT_METHOD_LABELS } from "@/core/validation/debt-payment";
import type { CashPaymentMethod } from "@/core/accounting/types";
import { DebtPaymentForm } from "@/features/debts/components/debt-payment-form";
import { buildPartyStatement, type PartyStatement } from "@/features/debts/services/debts-service";

type Tab = "receivable" | "payable";

const TAB_LABELS: Record<Tab, string> = {
  receivable: "ديون العملاء (لنا)",
  payable: "مستحقات الموردين (علينا)"
};

const DEBT_STATUS_LABELS: Record<LocalDebt["status"], string> = {
  open: "لم تُسدَّد",
  partial: "سُدِّد جزئياً",
  settled: "مسدد"
};

const SOURCE_LABELS: Record<string, string> = {
  sale: "بيع",
  purchase: "شراء",
  manual: "يدوي"
};

export function DebtsPageClient() {
  const [tab, setTab] = useState<Tab>("receivable");
  const [selectedDebtId, setSelectedDebtId] = useState<string | null>(null);
  const [expandedDebtIds, setExpandedDebtIds] = useState<string[]>([]);
  const [statement, setStatement] = useState<{
    partyName: string;
    data: PartyStatement;
  } | null>(null);
  const [statementError, setStatementError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const businesses = useLiveQuery(() => getDB().businesses.toArray(), []);
  const accounts = useLiveQuery(
    () =>
      getDB().financialAccounts
        .filter((account) => account.isActive && !account.deletedAt)
        .toArray(),
    []
  );

  const sortedBusinesses = [...(businesses ?? [])].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
  );
  const business = sortedBusinesses[0] ?? null;

  const debts = useLiveQuery(
    () =>
      getDB().debts
        .filter((debt) => !debt.deletedAt)
        .toArray(),
    [refreshKey]
  );
  const customers = useLiveQuery(() => getDB().customers.toArray(), []);
  const suppliers = useLiveQuery(() => getDB().suppliers.toArray(), []);
  const payments = useLiveQuery(
    () =>
      getDB().debtPayments
        .filter((payment) => !payment.deletedAt)
        .toArray(),
    [refreshKey]
  );

  const partyNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const party of [...(customers ?? []), ...(suppliers ?? [])] as LocalParty[]) {
      map.set(party.id, party.name);
    }
    return map;
  }, [customers, suppliers]);

  const tabDebts = useMemo(() => {
    const rows = (debts ?? []).filter((debt) => debt.direction === tab);
    return rows.sort((a, b) => {
      const settledDiff =
        (a.status === "settled" ? 1 : 0) - (b.status === "settled" ? 1 : 0);
      if (settledDiff !== 0) return settledDiff;
      return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    });
  }, [debts, tab]);

  const selectedDebt = tabDebts.find((debt) => debt.id === selectedDebtId) ?? null;

  const totals = useMemo(() => {
    const total = tabDebts.reduce(
      (sum, debt) => sum + debt.amountMinor,
      0
    );
    const remaining = tabDebts.reduce(
      (sum, debt) => sum + debt.remainingAmountMinor,
      0
    );
    const paid = total - remaining;
    return { total, paid, remaining };
  }, [tabDebts]);

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
          لا يوجد مشروع نشط على هذا الجهاز — أضِف أول عميل أو مورد من الـ
          Onboarding ثم سجّل مبيعات أو مشتريات آجلة لتظهر الديون هنا.
        </p>
        <Link href="/onboarding" className="btn-primary">
          إعداد المشروع
        </Link>
      </div>
    );
  }

  async function openStatement(debt: LocalDebt) {
    setStatementError(null);
    try {
      const data = await buildPartyStatement(debt.partyId!, tab);
      setStatement({
        partyName: partyNames.get(debt.partyId!) ?? "جهة غير معروفة",
        data
      });
    } catch (error) {
      setStatementError(
        error instanceof Error ? error.message : "تعذر توليد الكشف"
      );
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">الديون</h1>
          <p className="text-sm text-muted">
            دفعات جزئية متعددة حتى الصفر — الدفعة وحدها تحرك رصيد الحساب
            المالي
          </p>
        </div>
      </div>

      <div className="flex gap-2" data-tour="debts-tabs">
        {(Object.keys(TAB_LABELS) as Tab[]).map((key) => {
          const count = (debts ?? []).filter(
            (debt) => debt.direction === key && debt.status !== "settled"
          ).length;
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                setTab(key);
                setSelectedDebtId(null);
                setStatement(null);
              }}
              className={`rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                tab === key
                  ? "border-primary bg-primary-50 text-primary-800"
                  : "border-border bg-surface hover:border-primary-200"
              }`}
            >
              {TAB_LABELS[key]}
              {count > 0 && (
                <span className="ms-2 rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-bold text-danger">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="card flex flex-wrap gap-6 text-sm">
        <div>
          <p className="text-xs text-muted">إجمالي الأديان</p>
          <p className="num text-lg font-bold">{formatCurrency(totals.total)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">المسدد</p>
          <p className="num text-lg font-bold text-primary">
            {formatCurrency(totals.paid)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">المتبقي</p>
          <p
            className={`num text-lg font-bold ${
              totals.remaining > 0 ? "text-danger" : ""
            }`}
          >
            {formatCurrency(totals.remaining)}
          </p>
        </div>
      </div>

      {selectedDebt && (
        <DebtPaymentForm
          debt={selectedDebt}
          accounts={(accounts ?? []).map((account) => ({
            id: account.id,
            name: account.name,
            type: account.type
          }))}
          businessId={business.id}
          onPaid={() => setRefreshKey((key) => key + 1)}
        />
      )}

      {statementError && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
          {statementError}
        </div>
      )}

      {tabDebts.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 py-10 text-center">
          <div className="inline-flex rounded-xl bg-primary-50 p-3 text-primary">
            <HandCoins className="h-6 w-6" aria-hidden />
          </div>
          <p className="text-sm text-muted">
            لا ديون في هذا القسم — الديون تُنشأ تلقائياً من المبيعات
            والمشتريات الآجلة
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted">
                <th className="py-2 text-start font-medium">الجهة</th>
                <th className="py-2 text-start font-medium">المصدر</th>
                <th className="py-2 text-start font-medium">أصل الدين</th>
                <th className="py-2 text-start font-medium">المدفوع</th>
                <th className="py-2 text-start font-medium">المتبقي</th>
                <th className="py-2 text-start font-medium">الحالة</th>
                <th className="py-2 text-start font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {tabDebts.map((debt) => {
                const expanded = expandedDebtIds.includes(debt.id);
                const debtPayments = (payments ?? [])
                  .filter((payment) => payment.debtId === debt.id)
                  .sort(
                    (a, b) =>
                      Date.parse(b.occurredAt) - Date.parse(a.occurredAt)
                  );
                return (
                  <DebtRow
                    key={debt.id}
                    debt={debt}
                    partyName={partyNames.get(debt.partyId) ?? "—"}
                    expanded={expanded}
                    onToggle={() =>
                      setExpandedDebtIds((ids) =>
                        ids.includes(debt.id)
                          ? ids.filter((id) => id !== debt.id)
                          : [...ids, debt.id]
                      )
                    }
                    onPay={() => {
                      setSelectedDebtId(debt.id);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    onStatement={() => openStatement(debt)}
                    payments={debtPayments.map((payment) => ({
                      id: payment.id,
                      occurredAt: payment.occurredAt,
                      amountMinor: payment.amountMinor,
                      method:
                        DEBT_PAYMENT_METHOD_LABELS[
                          payment.paymentMethod as CashPaymentMethod
                        ] ?? payment.paymentMethod,
                      notes: payment.notes
                    }))}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {statement && (
        <PartyStatementCard
          partyName={statement.partyName}
          data={statement.data}
          onClose={() => setStatement(null)}
        />
      )}
    </div>
  );
}

function DebtRow({
  debt,
  partyName,
  expanded,
  onToggle,
  onPay,
  onStatement,
  payments
}: {
  debt: LocalDebt;
  partyName: string;
  expanded: boolean;
  onToggle: () => void;
  onPay: () => void;
  onStatement: () => void;
  payments: Array<{
    id: string;
    occurredAt: string;
    amountMinor: number;
    method: string;
    notes: string;
  }>;
}) {
  return (
    <>
      <tr className="border-b border-border/60">
        <td className="py-2.5 font-medium">{partyName}</td>
        <td className="py-2.5 text-muted">{SOURCE_LABELS[debt.sourceType]}</td>
        <td className="py-2.5">
          <span className="num">{formatCurrency(debt.amountMinor)}</span>
        </td>
        <td className="py-2.5 text-primary">
          <span className="num">{formatCurrency(debt.paidAmountMinor)}</span>
        </td>
        <td className="py-2.5">
          <span
            className={`num ${
              debt.remainingAmountMinor > 0 ? "font-bold text-danger" : ""
            }`}
          >
            {formatCurrency(debt.remainingAmountMinor)}
          </span>
        </td>
        <td className="py-2.5">
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              debt.status === "settled"
                ? "bg-primary-50 text-primary-700"
                : debt.status === "partial"
                  ? "bg-warning/10 text-warning"
                  : "bg-danger/10 text-danger"
            }`}
          >
            {DEBT_STATUS_LABELS[debt.status]}
          </span>
        </td>
        <td className="py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {debt.status !== "settled" && (
              <button
                type="button"
                onClick={onPay}
                className="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary-700"
              >
                دفعة
              </button>
            )}
            <button
              type="button"
              onClick={onToggle}
              className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted-foreground/10"
              aria-label="سجل الدفعات"
            >
              {expanded ? (
                <ChevronUp className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              )}
            </button>
            <button
              type="button"
              onClick={onStatement}
              className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted-foreground/10"
              title="كشف حساب الجهة"
            >
              <FileText className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} className="bg-muted-foreground/5 px-4 py-3">
            {payments.length === 0 ? (
              <p className="text-xs text-muted">لا دفعات مسجلة بعد</p>
            ) : (
              <ul className="space-y-2">
                {payments.map((payment) => (
                  <li
                    key={payment.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2 text-xs"
                  >
                    <span className="flex items-center gap-2">
                      <Receipt className="h-3.5 w-3.5 text-muted" aria-hidden />
                      {formatDateTime(payment.occurredAt)}
                    </span>
                    <span className="num font-bold text-primary">
                      {formatCurrency(payment.amountMinor)}
                    </span>
                    <span className="text-muted">{payment.method}</span>
                    {payment.notes && (
                      <span className="text-muted">— {payment.notes}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function PartyStatementCard({
  partyName,
  data,
  onClose
}: {
  partyName: string;
  data: PartyStatement;
  onClose: () => void;
}) {
  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold">كشف حساب — {partyName}</p>
          <p className="text-xs text-muted">
            {data.direction === "receivable" ? "مديونية لنا" : "مديونية علينا"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="btn-outline !px-3 !py-1.5 text-xs"
        >
          إغلاق
        </button>
      </div>

      <div className="flex flex-wrap gap-6 text-sm">
        <div>
          <p className="text-xs text-muted">الرصيد الافتتاحي</p>
          <p className="num font-bold">{formatCurrency(data.openingBalanceMinor)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">الرصيد الحالي</p>
          <p
            className={`num font-bold ${
              data.currentBalanceMinor > 0 ? "text-danger" : "text-primary"
            }`}
          >
            {formatCurrency(data.currentBalanceMinor)}
          </p>
        </div>
      </div>

      {data.rows.length === 0 ? (
        <p className="text-sm text-muted">لا حركات بعد</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-xs">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="py-2 text-start font-medium">التاريخ</th>
                <th className="py-2 text-start font-medium">البيان</th>
                <th className="py-2 text-start font-medium">مرجع</th>
                <th className="py-2 text-start font-medium">المبلغ</th>
                <th className="py-2 text-start font-medium">الرصيد بعده</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => (
                <tr key={`${row.type}-${index}`} className="border-b border-border/60">
                  <td className="py-2 text-muted">
                    {formatDateTime(row.occurredAt)}
                  </td>
                  <td className="py-2">{row.note}</td>
                  <td className="py-2 text-muted">
                    <span className="num" dir="ltr">
                      {row.ref}
                    </span>
                  </td>
                  <td
                    className={`num py-2 font-medium ${
                      row.amountMinor >= 0 ? "text-danger" : "text-primary"
                    }`}
                  >
                    {formatCurrency(Math.abs(row.amountMinor))}
                  </td>
                  <td className="num py-2">
                    {formatCurrency(row.balanceAfterMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
