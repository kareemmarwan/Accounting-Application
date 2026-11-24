"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Printer, Store } from "lucide-react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { LoadingScreen } from "@/components/loading-screen";
import { getDB } from "@/core/db/db";
import { defaultRange, buildReports, buildCsv, downloadCsv, REPORT_LABELS, type ReportKind, type ReportRange, type ReportsBundle } from "@/features/reports/services/reports-service";

const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

const REPORT_ORDER: ReportKind[] = [
  "sales",
  "purchases",
  "expenses",
  "pl",
  "cashflow",
  "customer_debts",
  "supplier_dues",
  "account_balances",
  "daily_performance",
  "monthly_performance"
];

function toInputDate(iso: string | Date): string {
  if (iso instanceof Date) {
    return iso.toISOString().slice(0, 10);
  }
  return iso.slice(0, 10);
}

export function ReportsPageClient() {
  const [kind, setKind] = useState<ReportKind>("sales");
  const [range, setRange] = useState<ReportRange>(defaultRange);
  const [bundle, setBundle] = useState<ReportsBundle | null>(null);
  const [loading, setLoading] = useState(true);

  const businesses = useLiveQuery(() => getDB().businesses.toArray(), []);
  const business = useMemo(() => {
    const sorted = [...(businesses ?? [])].sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
    );
    return sorted[0] ?? null;
  }, [businesses]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    buildReports(range)
      .then((result) => {
        if (!cancelled) {
          setBundle(result);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  if (businesses === undefined || (loading && !bundle)) {
    return <LoadingScreen />;
  }

  if (!business) {
    return (
      <div className="card flex flex-col items-start gap-4">
        <div className="inline-flex rounded-xl bg-primary-50 p-3 text-primary">
          <Store className="h-6 w-6" aria-hidden />
        </div>
        <p className="text-sm leading-relaxed text-muted">
          لا يوجد مشروع نشط — أكمل إعداد المشروع أولاً
        </p>
        <Link href="/onboarding" className="btn-primary">
          إعداد المشروع
        </Link>
      </div>
    );
  }

  const table = bundle?.tables[kind];

  function handleExport() {
    if (!table) return;
    const csv = buildCsv(table.columns, table.rows, table.totals);
    const label = REPORT_LABELS[kind].replace(/\s/g, "_");
    downloadCsv(`${label}_${toInputDate(range.fromIso)}_${toInputDate(range.toIso)}.csv`, csv);
  }

  function setQuickRange(period: "today" | "this_month" | "last_month" | "this_year") {
    const now = new Date();
    if (period === "today") {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      setRange({ fromIso: start.toISOString(), toIso: now.toISOString() });
    } else if (period === "this_month") {
      setRange(defaultRange());
    } else if (period === "last_month") {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      setRange({ fromIso: start.toISOString(), toIso: end.toISOString() });
    } else {
      const start = new Date(now.getFullYear(), 0, 1);
      setRange({ fromIso: start.toISOString(), toIso: now.toISOString() });
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">التقارير</h1>
        <p className="text-sm text-muted">
          10 تقارير مالية — مصدرها دفتر الأستاذ المحلي (يتطابق مع الأرصدة) مع
          تصدير CSV وطباعة
        </p>
      </div>

      <div className="card space-y-4 print:hidden" data-tour="reports-period">
        <div className="flex flex-wrap gap-2">
          {REPORT_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setKind(key)}
              className={`rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                kind === key
                  ? "border-primary bg-primary-50 text-primary-800"
                  : "border-border bg-surface hover:border-primary-200"
              }`}
            >
              {REPORT_LABELS[key]}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">من</span>
            <input
              type="date"
              value={toInputDate(range.fromIso)}
              onChange={(event) => {
                const from = new Date(`${event.target.value}T00:00:00`);
                if (!Number.isNaN(from.getTime())) {
                  setRange((current) => ({ ...current, fromIso: from.toISOString() }));
                }
              }}
              className={`${inputClass} w-40`}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">إلى</span>
            <input
              type="date"
              value={toInputDate(range.toIso)}
              onChange={(event) => {
                const to = new Date(`${event.target.value}T23:59:59`);
                if (!Number.isNaN(to.getTime())) {
                  setRange((current) => ({ ...current, toIso: to.toISOString() }));
                }
              }}
              className={`${inputClass} w-40`}
            />
          </label>
          <button
            type="button"
            onClick={() => setQuickRange("today")}
            className="btn-outline !px-3 !py-2 text-xs"
          >
            اليوم
          </button>
          <button
            type="button"
            onClick={() => setQuickRange("this_month")}
            className="btn-outline !px-3 !py-2 text-xs"
          >
            هذا الشهر
          </button>
          <button
            type="button"
            onClick={() => setQuickRange("last_month")}
            className="btn-outline !px-3 !py-2 text-xs"
          >
            الشهر الماضي
          </button>
          <button
            type="button"
            onClick={() => setQuickRange("this_year")}
            className="btn-outline !px-3 !py-2 text-xs"
          >
            هذه السنة
          </button>
          <div className="ms-auto flex gap-2">
            <button type="button" onClick={handleExport} className="btn-outline text-xs" disabled={!table}>
              <Download className="h-3.5 w-3.5" aria-hidden />
              تصدير CSV
            </button>
            <button type="button" onClick={() => window.print()} className="btn-outline text-xs">
              <Printer className="h-3.5 w-3.5" aria-hidden />
              طباعة / PDF
            </button>
          </div>
        </div>
      </div>

      {table && (
        <div className="card">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-bold">
              <FileText className="h-4 w-4 text-primary" aria-hidden />
              {REPORT_LABELS[kind]}
            </p>
            <p className="text-xs text-muted" dir="ltr">
              {toInputDate(range.fromIso)} ← {toInputDate(range.toIso)}
            </p>
          </div>

          {table.note && (
            <p className="mb-3 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs leading-relaxed text-warning">
              {table.note}
            </p>
          )}

          {table.rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">
              لا بيانات في الفترة المحددة
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead>
                  <tr className="border-b border-border text-muted">
                    {table.columns.map((column) => (
                      <th key={column} className="py-2 text-start font-medium">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, index) => (
                    <tr key={index} className="border-b border-border/60">
                      {row.cells.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          className={`py-2 ${cellIndex === 0 ? "text-muted" : ""}`}
                        >
                          <span className={/^[\d.\-()]+$/.test(cell) ? "num" : ""}>{cell}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {table.totals && (
                  <tfoot>
                    <tr className="border-t-2 border-border font-bold">
                      {table.totals.map((cell, index) => (
                        <td key={index} className="py-2.5">
                          <span className={/^[\d.\-()]+$/.test(cell) ? "num" : ""}>{cell}</span>
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
