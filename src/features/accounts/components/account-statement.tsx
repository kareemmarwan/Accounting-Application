"use client";

import { useEffect, useState } from "react";
import { FileText, X } from "lucide-react";
import type { LocalFinancialAccount } from "@/core/db/db";
import { formatCurrency, formatDateTime } from "@/lib/format";
import {
  buildAccountStatement,
  STATEMENT_SOURCE_LABELS,
  type AccountStatement
} from "@/features/accounts/services/accounts-service";
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_PROVIDER_LABELS
} from "@/core/validation/account";

export function AccountStatementCard({
  account,
  refreshKey,
  onClose
}: {
  account: LocalFinancialAccount;
  refreshKey: number;
  onClose: () => void;
}) {
  const [statement, setStatement] = useState<AccountStatement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    buildAccountStatement(account.id)
      .then((data) => {
        if (!cancelled) {
          setStatement(data);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("تعذر توليد كشف الحساب");
          setStatement(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [account.id, refreshKey]);

  const providerLabel =
    account.provider != null
      ? (ACCOUNT_PROVIDER_LABELS[account.provider] ?? account.provider)
      : null;

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary">
            <FileText className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-bold">كشف حساب — {account.name}</p>
            <p className="text-xs text-muted">
              {ACCOUNT_TYPE_LABELS[account.type]}
              {providerLabel ? ` — ${providerLabel}` : ""}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="btn-outline !px-3 !py-1.5 text-xs"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          إغلاق
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
          {error}
        </div>
      )}

      {statement && (
        <>
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <p className="text-xs text-muted">الرصيد الافتتاحي</p>
              <p className="num font-bold">
                {formatCurrency(statement.openingBalanceMinor)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">الرصيد الحالي</p>
              <p className="num font-bold text-primary">
                {formatCurrency(statement.currentBalanceMinor)}
              </p>
            </div>
          </div>

          {statement.rows.length === 0 ? (
            <p className="text-sm text-muted">لا حركات على هذا الحساب بعد</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead>
                  <tr className="border-b border-border text-muted">
                    <th className="py-2 text-start font-medium">التاريخ</th>
                    <th className="py-2 text-start font-medium">النوع</th>
                    <th className="py-2 text-start font-medium">البيان</th>
                    <th className="py-2 text-start font-medium">القيد</th>
                    <th className="py-2 text-start font-medium">المبلغ</th>
                    <th className="py-2 text-start font-medium">الرصيد بعده</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.rows.map((row) => (
                    <tr
                      key={row.entryId}
                      className="border-b border-border/60"
                    >
                      <td className="py-2 text-muted">
                        {formatDateTime(row.occurredAt)}
                      </td>
                      <td className="py-2 font-medium">
                        {STATEMENT_SOURCE_LABELS[row.sourceType]}
                      </td>
                      <td className="py-2">{row.description}</td>
                      <td className="py-2 text-muted">
                        <span className="num" dir="ltr">
                          {row.entryNumber}
                        </span>
                      </td>
                      <td
                        className={`num py-2 font-medium ${
                          row.amountMinor >= 0 ? "text-primary" : "text-danger"
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
        </>
      )}
    </div>
  );
}
