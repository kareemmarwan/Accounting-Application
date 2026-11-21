"use client";

import { useEffect, useState } from "react";
import { Loader2, Printer, Plus } from "lucide-react";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { toMinor } from "@/core/accounting/money";
import {
  buildContactLedger,
  createManualDebt,
  type ContactLedger,
  type LedgerRow
} from "@/features/contacts/services/contacts-service";
import type { ContactType } from "@/core/validation/contact";
import type { LocalParty } from "@/core/db/db";

const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

const ROW_LABELS: Record<LedgerRow["kind"], string> = {
  sale: "بيع آجل",
  purchase: "شراء آجل",
  manual_debt: "دين يدوي",
  payment: "دفعة"
};

interface ContactLedgerProps {
  party: LocalParty;
  type: ContactType;
  businessId: string;
  onClose: () => void;
}

export function ContactLedger({ party, type, businessId, onClose }: ContactLedgerProps) {
  const [ledger, setLedger] = useState<ContactLedger | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDebtForm, setShowDebtForm] = useState(false);
  const [debtAmount, setDebtAmount] = useState("");
  const [debtNotes, setDebtNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const typeLabel = type === "customer" ? "عميل" : "مورد";

  function reload() {
    buildContactLedger(party.id, type)
      .then((data) => {
        setLedger(data);
        setError(null);
      })
      .catch((loadError) => {
        setError(
          loadError instanceof Error ? loadError.message : "تعذر توليد الدفتر"
        );
      });
  }

  useEffect(reload, [party.id, type, party.version]);

  async function submitManualDebt() {
    setError(null);
    if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(debtAmount.trim()) || toMinor(debtAmount) <= 0) {
      setError("أدخل مبلغاً صحيحاً أكبر من صفر");
      return;
    }
    setSubmitting(true);
    try {
      await createManualDebt(
        {
          partyId: party.id,
          amount: debtAmount.trim(),
          occurredAt: new Date().toISOString(),
          notes: debtNotes
        },
        type,
        { businessId }
      );
      setDebtAmount("");
      setDebtNotes("");
      setShowDebtForm(false);
      reload();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "تعذر تسجيل الدين"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg font-bold">دفتر دين — {party.name}</p>
          <p className="text-xs text-muted">
            {typeLabel}
            {party.phone ? ` — ${party.phone}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowDebtForm((value) => !value)}
            className="btn-outline !px-3 !py-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            دين يدوي
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="btn-outline !px-3 !py-1.5 text-xs"
          >
            <Printer className="h-3.5 w-3.5" aria-hidden />
            طباعة
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn-outline !px-3 !py-1.5 text-xs"
          >
            إغلاق
          </button>
        </div>
      </div>

      {showDebtForm && (
        <div className="space-y-3 rounded-xl border border-border bg-muted-foreground/5 p-4">
          <p className="text-xs font-semibold text-muted">
            سجّل ديناً قديماً (سابقاً على استخدام التطبيق) على {typeLabel} — يُقيد
            مقابل رأس المال الافتتاحي
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">المبلغ (₪) *</span>
              <input
                type="number"
                step="0.01"
                min="0"
                dir="ltr"
                value={debtAmount}
                onChange={(event) => setDebtAmount(event.target.value)}
                className={`${inputClass} num`}
                placeholder="0.00"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">ملاحظات</span>
              <input
                type="text"
                value={debtNotes}
                onChange={(event) => setDebtNotes(event.target.value)}
                className={inputClass}
                placeholder="مثال: دين قديم قبل التطبيق"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={submitManualDebt}
            disabled={submitting}
            className="btn-primary !px-4 !py-2 text-xs"
          >
            {submitting ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                جارٍ التسجيل...
              </span>
            ) : (
              "تسجيل الدين"
            )}
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-6 text-sm">
        <div>
          <p className="text-xs text-muted">الرصيد الافتتاحي (محسوب عكسياً)</p>
          <p className="num font-bold">{formatCurrency(ledger?.openingBalanceMinor ?? 0)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">
            الرصيد الحالي — {ledger?.direction === "receivable" ? "مديونية لنا" : "مديونية علينا"}
          </p>
          <p
            className={`num text-lg font-bold ${
              (ledger?.currentBalanceMinor ?? 0) > 0 ? "text-danger" : "text-primary"
            }`}
          >
            {formatCurrency(ledger?.currentBalanceMinor ?? 0)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">إجمالي التعاملات</p>
          <p className="num font-bold">{formatCurrency(ledger?.totalTransactionsMinor ?? 0)}</p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
          {error}
        </div>
      )}

      {!ledger ? (
        <p className="flex items-center gap-2 py-6 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          جارٍ توليد الدفتر...
        </p>
      ) : ledger.rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          لا حركات على هذه الجهة بعد
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="py-2 text-start font-medium">التاريخ</th>
                <th className="py-2 text-start font-medium">البيان</th>
                <th className="py-2 text-start font-medium">مرجع</th>
                <th className="py-2 text-start font-medium">زيادة (+)</th>
                <th className="py-2 text-start font-medium">نقصان (−)</th>
                <th className="py-2 text-start font-medium">الرصيد بعده</th>
              </tr>
            </thead>
            <tbody>
              {ledger.rows.map((row, index) => (
                <tr
                  key={`${row.kind}-${row.ref}-${index}`}
                  className="border-b border-border/60"
                >
                  <td className="py-2 text-muted">{formatDateTime(row.occurredAt)}</td>
                  <td className="py-2 font-medium">{ROW_LABELS[row.kind]}</td>
                  <td className="py-2 text-muted">
                    <span className="num" dir="ltr">
                      {row.ref}
                    </span>
                  </td>
                  <td className="num py-2 font-medium text-danger">
                    {row.deltaMinor > 0 ? formatCurrency(row.deltaMinor) : "—"}
                  </td>
                  <td className="num py-2 font-medium text-primary">
                    {row.deltaMinor < 0 ? formatCurrency(-row.deltaMinor) : "—"}
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
