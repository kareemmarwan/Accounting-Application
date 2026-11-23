"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertCircle, Loader2, Undo2, X } from "lucide-react";
import { getDB } from "@/core/db/db";
import { formatCurrency } from "@/lib/format";
import { returnSaleItems } from "@/features/sales/services/sale-return-service";

const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

export function SaleReturnModal({
  saleId,
  onClose,
  onReturned
}: {
  saleId: string;
  onClose: () => void;
  onReturned: (message: string) => void;
}) {
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [refundAccountId, setRefundAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sale = useLiveQuery(() => getDB().sales.get(saleId), [saleId]);
  const items = useLiveQuery(
    () => getDB().saleItems.where("saleId").equals(saleId).toArray(),
    [saleId]
  );
  const accounts = useLiveQuery(
    () =>
      getDB().financialAccounts.filter(
        (account) => account.isActive && !account.deletedAt
      ).toArray(),
    []
  );
  const debt = useLiveQuery(
    () => (sale?.debtId ? getDB().debts.get(sale.debtId) : undefined),
    [sale?.debtId]
  );

  const saleItemsList = useMemo(() => items ?? [], [items]);

  const lines = useMemo(
    () =>
      saleItemsList
        .map((item) => {
          const qty = Number(quantities[item.id] ?? 0);
          return {
            saleItemId: item.id,
            quantityMilli: Number.isFinite(qty) && qty > 0 ? qty : 0
          };
        })
        .filter((line) => line.quantityMilli > 0),
    [saleItemsList, quantities]
  );

  const splitPreview = useMemo(() => {
    let returnMinor = 0;
    for (const line of lines) {
      const item = saleItemsList.find(
        (candidate) => candidate.id === line.saleItemId
      );
      if (!item) continue;
      returnMinor += Math.round((line.quantityMilli * item.unitPriceMinor) / 1000);
    }
    const debtRemaining =
      debt && !debt.deletedAt ? debt.remainingAmountMinor : 0;
    const debtReducedMinor = Math.min(returnMinor, debtRemaining);
    return {
      returnMinor,
      debtReducedMinor,
      refundMinor: returnMinor - debtReducedMinor
    };
  }, [lines, saleItemsList, debt]);

  function updateQty(itemId: string, maxMilli: number, value: string) {
    const parsed = Number(value);
    setQuantities((prev) => ({
      ...prev,
      [itemId]: Number.isFinite(parsed)
        ? `${Math.min(Math.max(parsed, 0), maxMilli / 1000)}`
        : "0"
    }));
  }

  async function submit() {
    if (!sale) return;
    setError(null);
    setBusy(true);
    try {
      const result = await returnSaleItems(
        {
          saleId: sale.id,
          lines,
          reason,
          refundAccountId: refundAccountId
        },
        { businessId: sale.businessId }
      );
      onReturned(
        result.refundMinor > 0
          ? `سُجّل الإرجاع بقيمة ${formatCurrency(result.returnMinor)} — رُدّ ${formatCurrency(result.refundMinor)} نقداً`
          : `سُجّل الإرجاع بقيمة ${formatCurrency(result.returnMinor)} — خُفّض دين العميل بمقدار ${formatCurrency(result.debtReducedMinor)}`
      );
    } catch (returnError) {
      setError(
        returnError instanceof Error ? returnError.message : "تعذر تسجيل الإرجاع"
      );
      setBusy(false);
    }
  }

  if (!sale) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="card w-full max-w-lg space-y-3">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm font-bold">
            <Undo2 className="h-5 w-5 text-primary" aria-hidden />
            إرجاع من فاتورة {sale.saleNumber}
          </p>
          <button type="button" onClick={onClose} aria-label="إغلاق">
            <X className="h-4 w-4 text-muted" />
          </button>
        </div>

        {sale.status === "void" ? (
          <p className="rounded-xl bg-danger/10 p-3 text-xs text-danger">
            هذه الفاتورة ملغاة — لا إرجاع عليها
          </p>
        ) : (
          <>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {saleItemsList.map((item) => {
                const returnable = item.quantityMilli - (item.returnedMilli ?? 0);
                const maxUnits = returnable / 1000;
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 rounded-xl border border-border p-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold">{item.name}</p>
                      <p className="text-[10px] text-muted">
                        مباع: {maxUnits} — مرتجع سابقاً:{" "}
                        {(item.returnedMilli ?? 0) / 1000}
                      </p>
                    </div>
                    {returnable > 0 ? (
                      <input
                        value={quantities[item.id] ?? ""}
                        onChange={(event) =>
                          updateQty(item.id, returnable, event.target.value)
                        }
                        placeholder={`حتى ${maxUnits}`}
                        className="input num !w-24 !px-2 !py-1 text-center text-xs"
                        dir="ltr"
                        inputMode="decimal"
                        aria-label={`كمية الإرجاع من ${item.name}`}
                      />
                    ) : (
                      <span className="rounded-full bg-muted-foreground/10 px-2 py-0.5 text-[10px] text-muted">
                        مُرجع بالكامل
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="return-reason" className="block text-xs font-medium">
                سبب الإرجاع *
              </label>
              <input
                id="return-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="مثال: منتج تالف أو تغيير قرار العميل"
                className={inputClass}
              />
            </div>

            {splitPreview.refundMinor > 0 && (
              <div className="space-y-1.5">
                <label
                  htmlFor="return-account"
                  className="block text-xs font-medium"
                >
                  حساب الاسترداد النقدي (
                  {formatCurrency(splitPreview.refundMinor)})
                </label>
                <select
                  id="return-account"
                  value={refundAccountId}
                  onChange={(event) => setRefundAccountId(event.target.value)}
                  className={inputClass}
                >
                  <option value="">— اختر الحساب —</option>
                  {(accounts ?? []).map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {splitPreview.returnMinor > 0 && (
              <div className="rounded-xl bg-muted-foreground/5 p-3 text-xs">
                <p className="flex justify-between">
                  <span className="text-muted">قيمة الإرجاع</span>
                  <span className="num font-bold">
                    {formatCurrency(splitPreview.returnMinor)}
                  </span>
                </p>
                {splitPreview.debtReducedMinor > 0 && (
                  <p className="flex justify-between text-primary-800">
                    <span className="text-muted">خفض دين العميل</span>
                    <span className="num font-bold">
                      {formatCurrency(splitPreview.debtReducedMinor)}
                    </span>
                  </p>
                )}
                {splitPreview.refundMinor > 0 && (
                  <p className="flex justify-between text-danger">
                    <span className="text-muted">استرداد نقدي</span>
                    <span className="num font-bold">
                      {formatCurrency(splitPreview.refundMinor)}
                    </span>
                  </p>
                )}
              </div>
            )}

            {error && (
              <p className="flex items-start gap-1.5 rounded-xl bg-danger/10 p-2 text-xs font-medium text-danger">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {error}
              </p>
            )}

            <button
              type="button"
              disabled={busy || lines.length === 0}
              onClick={() => void submit()}
              className="btn-primary w-full"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              تسجيل الإرجاع
            </button>
          </>
        )}
      </div>
    </div>
  );
}
