"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CloudUpload, Search, ShoppingBag } from "lucide-react";
import { getDB, type LocalPurchase } from "@/core/db/db";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/core/validation/sale";

type StatusFilter = "all" | "cash" | "mixed" | "credit";
type MethodFilter = "all" | LocalPurchase["paymentMethod"];

const STATUS_LABELS: Record<Exclude<StatusFilter, "all">, string> = {
  cash: "مسدد",
  mixed: "مختلط",
  credit: "آجل"
};

const SYNC_BADGES: Record<
  LocalPurchase["syncStatus"],
  { label: string; className: string }
> = {
  pending: { label: "بانتظار المزامنة", className: "bg-warning/10 text-warning" },
  syncing: { label: "جارٍ المزامنة", className: "bg-primary-50 text-primary-700" },
  synced: { label: "متزامن", className: "bg-primary-50 text-primary-700" },
  failed: { label: "فشل المزامنة", className: "bg-danger/10 text-danger" },
  conflict: { label: "تعارض", className: "bg-danger/10 text-danger" }
};

function purchaseStatusOf(sale: LocalPurchase): Exclude<StatusFilter, "all"> {
  if (sale.remainingAmountMinor <= 0) return "cash";
  if (sale.paidAmountMinor > 0) return "mixed";
  return "credit";
}

export function PurchasesList({ refreshKey }: { refreshKey: number }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [methodFilter, setMethodFilter] = useState<MethodFilter>("all");

  const purchases = useLiveQuery(
    () => getDB().purchases.orderBy("occurredAt").reverse().toArray(),
    [refreshKey]
  );
  const suppliers = useLiveQuery(() => getDB().suppliers.toArray(), []);

  const supplierNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const supplier of suppliers ?? []) {
      map.set(supplier.id, supplier.name);
    }
    return map;
  }, [suppliers]);

  const filtered = useMemo(() => {
    let rows = purchases ?? [];
    if (search.trim()) {
      const term = search.trim();
      rows = rows.filter(
        (purchase) =>
          purchase.description.includes(term) ||
          purchase.purchaseNumber.includes(term) ||
          purchase.transferReference.includes(term) ||
          (purchase.supplierId &&
            (supplierNames.get(purchase.supplierId) ?? "").includes(term))
      );
    }
    if (statusFilter !== "all") {
      rows = rows.filter(
        (purchase) => purchaseStatusOf(purchase) === statusFilter
      );
    }
    if (methodFilter !== "all") {
      rows = rows.filter((purchase) => purchase.paymentMethod === methodFilter);
    }
    return rows;
  }, [purchases, search, statusFilter, methodFilter, supplierNames]);

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
            placeholder="ابحث برقم الفاتورة أو الوصف أو المورد..."
            className={`${inputClass} ps-9`}
            aria-label="بحث في المشتريات"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value as StatusFilter)
          }
          className={`${inputClass} sm:w-36`}
          aria-label="تصفية بالحالة"
        >
          <option value="all">كل الحالات</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={methodFilter}
          onChange={(event) =>
            setMethodFilter(event.target.value as MethodFilter)
          }
          className={`${inputClass} sm:w-40`}
          aria-label="تصفية بطريقة الدفع"
        >
          <option value="all">كل طرق الدفع</option>
          {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="inline-flex rounded-xl bg-primary-50 p-3 text-primary">
            <ShoppingBag className="h-6 w-6" aria-hidden />
          </div>
          <p className="text-sm text-muted">
            {(purchases ?? []).length === 0
              ? "لا توجد مشتريات بعد — سجّل أول فاتورة شراء"
              : "لا نتائج مطابقة للبحث أو التصفية"}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted">
                <th className="py-2 text-start font-medium">الرقم</th>
                <th className="py-2 text-start font-medium">التاريخ</th>
                <th className="py-2 text-start font-medium">المورد</th>
                <th className="py-2 text-start font-medium">الوصف</th>
                <th className="py-2 text-start font-medium">الصافي</th>
                <th className="py-2 text-start font-medium">المدفوع</th>
                <th className="py-2 text-start font-medium">المتبقي</th>
                <th className="py-2 text-start font-medium">الإرفاق</th>
                <th className="py-2 text-start font-medium">المزامنة</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((purchase) => {
                const badge = SYNC_BADGES[purchase.syncStatus];
                return (
                  <tr key={purchase.id} className="border-b border-border/60">
                    <td className="py-2.5 font-medium">
                      <span className="num" dir="ltr">
                        {purchase.purchaseNumber}
                      </span>
                    </td>
                    <td className="py-2.5 text-muted">
                      {formatDateTime(purchase.occurredAt)}
                    </td>
                    <td className="py-2.5">
                      {purchase.supplierId
                        ? supplierNames.get(purchase.supplierId) ?? "—"
                        : "—"}
                    </td>
                    <td className="py-2.5 text-muted">{purchase.description}</td>
                    <td className="py-2.5 font-bold">
                      <span className="num">
                        {formatCurrency(purchase.netAmountMinor)}
                      </span>
                    </td>
                    <td className="py-2.5">
                      <span className="num">
                        {formatCurrency(purchase.paidAmountMinor)}
                      </span>
                    </td>
                    <td className="py-2.5">
                      <span
                        className={`num ${
                          purchase.remainingAmountMinor > 0
                            ? "font-bold text-danger"
                            : "text-muted"
                        }`}
                      >
                        {formatCurrency(purchase.remainingAmountMinor)}
                      </span>
                    </td>
                    <td className="py-2.5 text-muted">
                      {purchase.receiptAttachmentId ? "مرفق ✓" : "—"}
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
