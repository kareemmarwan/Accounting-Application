"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CloudUpload, Receipt, Search } from "lucide-react";
import { getDB, type LocalExpense } from "@/core/db/db";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { EXPENSE_METHOD_LABELS } from "@/core/validation/expense";
import type { CashPaymentMethod } from "@/core/accounting/types";

const SYNC_BADGES: Record<
  LocalExpense["syncStatus"],
  { label: string; className: string }
> = {
  pending: { label: "بانتظار المزامنة", className: "bg-warning/10 text-warning" },
  syncing: { label: "جارٍ المزامنة", className: "bg-primary-50 text-primary-700" },
  synced: { label: "متزامن", className: "bg-primary-50 text-primary-700" },
  failed: { label: "فشل المزامنة", className: "bg-danger/10 text-danger" },
  conflict: { label: "تعارض", className: "bg-danger/10 text-danger" }
};

export function ExpensesList({ refreshKey }: { refreshKey: number }) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const expenses = useLiveQuery(
    () => getDB().expenses.orderBy("occurredAt").reverse().toArray(),
    [refreshKey]
  );
  const categories = useLiveQuery(() => getDB().expenseCategories.toArray(), []);

  const categoryNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const category of categories ?? []) {
      map.set(category.id, category.name);
    }
    return map;
  }, [categories]);

  const filtered = useMemo(() => {
    let rows = expenses ?? [];
    if (search.trim()) {
      const term = search.trim();
      rows = rows.filter(
        (expense) => expense.title.includes(term) || expense.notes.includes(term)
      );
    }
    if (categoryFilter !== "all") {
      rows = rows.filter((expense) => expense.categoryId === categoryFilter);
    }
    return rows;
  }, [expenses, search, categoryFilter]);

  const filteredTotal = useMemo(
    () => filtered.reduce((sum, expense) => sum + expense.amountMinor, 0),
    [filtered]
  );

  const inputClass =
    "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

  return (
    <div className="card space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="absolute inset-y-0 start-3 my-auto h-4 w-4 text-muted"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ابحث بعنوان المصروف أو الملاحظات..."
            className={`${inputClass} ps-9`}
            aria-label="بحث في المصروفات"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
          className={`${inputClass} sm:w-48`}
          aria-label="تصفية بالتصنيف"
        >
          <option value="all">كل التصنيفات</option>
          {(categories ?? [])
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
        </select>
      </div>

      {filtered.length > 0 && (
        <div className="flex items-center justify-between rounded-xl bg-muted-foreground/5 px-4 py-2.5 text-sm">
          <span className="text-muted">المجموع المعروض ({filtered.length})</span>
          <span className="num font-bold text-danger">
            {formatCurrency(filteredTotal)}
          </span>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="inline-flex rounded-xl bg-primary-50 p-3 text-primary">
            <Receipt className="h-6 w-6" aria-hidden />
          </div>
          <p className="text-sm text-muted">
            {(expenses ?? []).length === 0
              ? "لا مصروفات بعد — سجّل أول مصروف"
              : "لا نتائج مطابقة للبحث أو التصفية"}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted">
                <th className="py-2 text-start font-medium">التاريخ</th>
                <th className="py-2 text-start font-medium">العنوان</th>
                <th className="py-2 text-start font-medium">التصنيف</th>
                <th className="py-2 text-start font-medium">المبلغ</th>
                <th className="py-2 text-start font-medium">الطريقة</th>
                <th className="py-2 text-start font-medium">الإيصال</th>
                <th className="py-2 text-start font-medium">المزامنة</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((expense) => {
                const badge = SYNC_BADGES[expense.syncStatus];
                return (
                  <tr key={expense.id} className="border-b border-border/60">
                    <td className="py-2.5 text-muted">
                      {formatDateTime(expense.occurredAt)}
                    </td>
                    <td className="py-2.5 font-medium">{expense.title}</td>
                    <td className="py-2.5 text-muted">
                      {categoryNames.get(expense.categoryId) ?? expense.glCode}
                    </td>
                    <td className="py-2.5 font-bold text-danger">
                      <span className="num">
                        {formatCurrency(expense.amountMinor)}
                      </span>
                    </td>
                    <td className="py-2.5 text-muted">
                      {
                        EXPENSE_METHOD_LABELS[
                          expense.paymentMethod as CashPaymentMethod
                        ]
                      }
                    </td>
                    <td className="py-2.5 text-muted">
                      {expense.receiptPath ? "مرفق ✓" : "—"}
                    </td>
                    <td className="py-2.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${badge.className}`}
                      >
                        <CloudUpload className="h-3 w-3" aria-hidden />
                        {badge.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
