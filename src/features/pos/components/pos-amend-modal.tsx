"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  AlertTriangle,
  FilePenLine,
  Loader2,
  Minus,
  Plus,
  ReceiptText,
  ScanLine,
  Search,
  Trash2,
  X
} from "lucide-react";
import { getDB, type LocalSale } from "@/core/db/db";
import { fromMinor, toMinor } from "@/core/accounting/money";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { fromMilli, parseQuantityToMilli, UNIT_MILLI_LABELS } from "@/core/validation/product";
import { findProductByBarcode } from "@/features/inventory/services/inventory-service";
import { lineTotalMinor, newCartLine, type PosCartLine } from "@/features/pos/cart";
import { amendSale } from "@/features/pos/services/sale-amendment-service";

interface SaleItemRow {
  id: string;
  name: string;
  quantityMilli: number;
  totalMinor: number;
  lineNote: string;
}

function safeToMinor(input: string): number | null {
  try {
    return toMinor(input);
  } catch {
    return null;
  }
}

export function PosAmendModal({
  business,
  onClose,
  onAmended
}: {
  business: { id: string; name: string; currency: string };
  onClose: () => void;
  onAmended: () => void;
}) {
  const sales = useLiveQuery(
    () =>
      getDB()
        .sales.where("businessId")
        .equals(business.id)
        .filter((sale) => !sale.deletedAt && sale.status === "posted")
        .toArray(),
    []
  );
  const accounts = useLiveQuery(
    () =>
      getDB().financialAccounts
        .where("businessId")
        .equals(business.id)
        .filter((account) => account.isActive && !account.deletedAt)
        .toArray(),
    []
  );
  const customers = useLiveQuery(
    () =>
      getDB().customers
        .where("businessId")
        .equals(business.id)
        .filter((customer) => !customer.deletedAt)
        .toArray(),
    []
  );

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<LocalSale | null>(null);
  const [existingItems, setExistingItems] = useState<SaleItemRow[]>([]);
  const [newLines, setNewLines] = useState<PosCartLine[]>([]);
  const [scan, setScan] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [paidInput, setPaidInput] = useState("");
  const [accountId, setAccountId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const deltaMinor = useMemo(
    () => newLines.reduce((sum, line) => sum + lineTotalMinor(line), 0),
    [newLines]
  );
  const paidMinor = useMemo(() => {
    if (paidInput.trim() === "") return deltaMinor;
    return Math.max(0, Math.min(safeToMinor(paidInput) ?? 0, deltaMinor));
  }, [paidInput, deltaMinor]);
  const remainingMinor = deltaMinor - paidMinor;

  const visibleSales = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (sales ?? [])
      .filter((sale) => {
        if (!query) return true;
        return (
          sale.saleNumber.toLowerCase().includes(query) ||
          String(sale.totalAmountMinor).includes(query)
        );
      })
      .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
      .slice(0, 50);
  }, [sales, search]);

  async function openSale(sale: LocalSale) {
    const items = await getDB().saleItems.where("saleId").equals(sale.id).toArray();
    setSelected(sale);
    setExistingItems(
      items.map((item) => ({
        id: item.id,
        name: item.name,
        quantityMilli: item.quantityMilli,
        totalMinor: item.totalMinor,
        lineNote: item.lineNote
      }))
    );
    setNewLines([]);
    setPaidInput("");
    setCustomerId(sale.customerId ?? "");
    setNotes("");
    setError(null);
    setScanError(null);
  }

  function addLine(product: { id: string; name: string; unit: PosCartLine["unit"]; salePriceMinor: number }, quantityMilli: number, lineNote = "") {
    setError(null);
    const key = product.id + (lineNote ? `:${lineNote}` : "");
    setNewLines((current) => {
      const existing = current.find((line) => line.key === key);
      if (existing) {
        return current.map((line) =>
          line.key === key ? { ...line, quantityMilli: line.quantityMilli + quantityMilli } : line
        );
      }
      return [...current, newCartLine(product, quantityMilli, lineNote)];
    });
  }

  async function handleScan() {
    const code = scan.trim();
    setScan("");
    if (!code) return;
    const product = await findProductByBarcode(code, business.id);
    if (!product) {
      setScanError(`لا يوجد منتج بالباركود: ${code}`);
      return;
    }
    setScanError(null);
    addLine(product, 1000);
  }

  function removeLine(key: string) {
    setNewLines((current) => current.filter((line) => line.key !== key));
  }

  function updateLine(key: string, patch: Partial<PosCartLine>) {
    setNewLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line))
    );
  }

  async function submitAmendment() {
    if (!selected) return;
    setError(null);
    if (newLines.length === 0) {
      setError("أضف صنفاً واحداً على الأقل إلى الفاتورة");
      return;
    }
    const effectiveCustomer = remainingMinor > 0 ? customerId || selected.customerId || "" : "";
    if (remainingMinor > 0 && !effectiveCustomer) {
      setError("الجزء الآجل يتطلب تحديد العميل");
      return;
    }
    if (paidMinor > 0 && !accountId) {
      setError("حدد الحساب المستلم للمبلغ المدفوع");
      return;
    }
    setBusy(true);
    try {
      await amendSale(
        {
          saleId: selected.id,
          newLines,
          paymentMethod: "cash",
          accountId: accountId || "",
          paidAmountMinor: paidMinor,
          customerId: effectiveCustomer,
          notes
        },
        {
          businessId: business.id,
          accountRef: accountId
            ? {
                id: accountId,
                type: (accounts ?? []).find((account) => account.id === accountId)?.type ?? "cash"
              }
            : undefined
        }
      );
      onAmended();
    } catch (amendError) {
      setError(amendError instanceof Error ? amendError.message : "تعذر إضافة الأصناف");
    } finally {
      setBusy(false);
    }
  }

  if (!selected) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal>
        <div className="card flex max-h-[80vh] w-full max-w-xl flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 text-base font-bold">
              <FilePenLine className="h-5 w-5 text-primary" aria-hidden />
              تعديل فاتورة — إضافة أصناف
            </p>
            <button type="button" onClick={onClose} aria-label="إغلاق">
              <X className="h-4 w-4 text-muted" />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted start-3" aria-hidden />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="بحث برقم الفاتورة"
              className="input ps-9"
              autoFocus
              aria-label="بحث في الفواتير"
            />
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto">
            {sales === undefined && <p className="p-4 text-sm text-muted">جارٍ التحميل...</p>}
            {sales !== undefined && visibleSales.length === 0 && (
              <p className="rounded-xl bg-muted-foreground/5 p-4 text-center text-sm text-muted">
                لا فواتير قابلة للتعديل
              </p>
            )}
            {visibleSales.map((sale) => (
              <button
                key={sale.id}
                type="button"
                onClick={() => void openSale(sale)}
                className="flex w-full items-center justify-between rounded-xl border border-border p-3 text-start transition-colors hover:border-primary/60 hover:bg-primary-50/30"
              >
                <div>
                  <p className="num text-sm font-bold" dir="ltr">{sale.saleNumber}</p>
                  <p className="text-xs text-muted">{formatDateTime(sale.occurredAt)}</p>
                </div>
                <div className="text-end">
                  <p className="num text-sm font-bold text-primary" dir="ltr">
                    {formatCurrency(sale.netAmountMinor, business.currency)}
                  </p>
                  {sale.remainingAmountMinor > 0 && (
                    <p className="num text-xs text-warning" dir="ltr">
                      آجل {formatCurrency(sale.remainingAmountMinor, business.currency)}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal>
      <div className="card flex max-h-[90vh] w-full max-w-3xl flex-col gap-3 overflow-y-auto">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-base font-bold">
            <ReceiptText className="h-5 w-5 text-primary" aria-hidden />
            فاتورة <span className="num" dir="ltr">{selected.saleNumber}</span> — إضافة أصناف
          </p>
          <button type="button" onClick={onClose} aria-label="إغلاق">
            <X className="h-4 w-4 text-muted" />
          </button>
        </div>

        <div className="rounded-xl bg-muted-foreground/5 p-3">
          <p className="mb-1.5 text-xs font-bold text-muted">أصناف الفاتورة الحالية</p>
          <div className="max-h-32 space-y-1 overflow-y-auto text-xs">
            {existingItems.length === 0 && <p className="text-muted">فاتورة بلا سطور (بيع سريع بدون أصناف)</p>}
            {existingItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {item.name}
                  {item.lineNote && <span className="text-muted"> — {item.lineNote}</span>}
                </span>
                <span className="num shrink-0" dir="ltr">
                  ×{fromMilli(item.quantityMilli)} = {formatCurrency(item.totalMinor, business.currency)}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-1.5 num border-t border-border pt-1.5 text-xs font-bold" dir="ltr">
            الحالي: {formatCurrency(selected.netAmountMinor, business.currency)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <ScanLine className="h-5 w-5 shrink-0 text-primary" aria-hidden />
          <input
            value={scan}
            onChange={(event) => {
              setScan(event.target.value);
              setScanError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleScan();
              }
            }}
            placeholder="امسح الباركود لإضافة صنف جديد إلى الفاتورة ثم Enter"
            className="input num"
            dir="ltr"
            autoFocus
            aria-label="ماسح الباركود للإضافة"
          />
          <button type="button" onClick={() => void handleScan()} className="btn-primary shrink-0">
            إضافة
          </button>
        </div>
        {scanError && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-danger">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {scanError}
          </p>
        )}

        <div className="space-y-2">
          {newLines.length === 0 && (
            <p className="rounded-xl bg-muted-foreground/5 p-3 text-center text-xs text-muted">
              امسح الباركود أو أضف يدوياً — تُحسب الأصناف الجديدة فقط
            </p>
          )}
          {newLines.map((line) => (
            <div key={line.key} className="flex items-center gap-2 rounded-xl border border-border p-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold">{line.name}</p>
                {line.lineNote && <p className="truncate text-[10px] text-muted">{line.lineNote}</p>}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => updateLine(line.key, { quantityMilli: Math.max(0, line.quantityMilli - 1000) })}
                  className="rounded-lg border border-border p-1 hover:bg-muted-foreground/10"
                  aria-label="نقص"
                >
                  <Minus className="h-3 w-3" aria-hidden />
                </button>
                <input
                  value={fromMilli(line.quantityMilli)}
                  onChange={(event) => {
                    const milli = parseQuantityToMilli(event.target.value || "0");
                    if (Number.isFinite(milli)) updateLine(line.key, { quantityMilli: milli });
                  }}
                  className="input num !w-20 !px-2 !py-1 text-center text-xs"
                  dir="ltr"
                  inputMode="decimal"
                  aria-label={`كمية ${line.name}`}
                />
                <button
                  type="button"
                  onClick={() => updateLine(line.key, { quantityMilli: line.quantityMilli + 1000 })}
                  className="rounded-lg border border-border p-1 hover:bg-muted-foreground/10"
                  aria-label="زيادة"
                >
                  <Plus className="h-3 w-3" aria-hidden />
                </button>
                <span className="text-[10px] text-muted">{UNIT_MILLI_LABELS[line.unit]}</span>
              </div>
              <input
                value={fromMinor(line.unitPriceMinor)}
                onChange={(event) => {
                  const value = safeToMinor(event.target.value || "0");
                  if (value !== null) updateLine(line.key, { unitPriceMinor: value });
                }}
                className="input num !w-24 !px-2 !py-1 text-xs"
                dir="ltr"
                inputMode="decimal"
                aria-label={`سعر ${line.name}`}
              />
              <span className="num w-20 text-end text-xs font-bold" dir="ltr">
                {formatCurrency(lineTotalMinor(line), business.currency)}
              </span>
              <button
                type="button"
                onClick={() => removeLine(line.key)}
                className="text-muted hover:text-danger"
                aria-label={`حذف ${line.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ))}
        </div>

        <div className="space-y-2 rounded-xl border border-border p-3">
          <div className="flex items-center justify-between text-sm font-bold">
            <span>قيمة الإضافة</span>
            <span className="num text-primary" dir="ltr">
              {formatCurrency(deltaMinor, business.currency)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <label className="shrink-0 text-xs text-muted" htmlFor="amend-paid">المدفوع الآن</label>
            <input
              id="amend-paid"
              value={paidInput}
              onChange={(event) => setPaidInput(event.target.value)}
              placeholder={fromMinor(deltaMinor)}
              className="input num flex-1 text-xs"
              dir="ltr"
              inputMode="decimal"
            />
          </div>
          <select
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            className="input text-xs"
            aria-label="الحساب المستلم"
          >
            <option value="">الحساب المستلم — تلقائي</option>
            {(accounts ?? []).map((account) => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </select>
          {(remainingMinor > 0 || customerId) && (
            <select
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
              className="input text-xs"
              aria-label="العميل"
            >
              <option value="">بدون عميل</option>
              {(customers ?? []).map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.name}</option>
              ))}
            </select>
          )}
          {remainingMinor > 0 && (
            <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              آجل: {formatCurrency(remainingMinor, business.currency)} تُضاف على العميل
            </p>
          )}
          <input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="ملاحظة (اختياري)"
            className="input text-xs"
            aria-label="ملاحظة الإضافة"
          />
          {error && (
            <p className="flex items-start gap-1.5 rounded-xl bg-danger/10 p-2 text-xs font-medium text-danger">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => void submitAmendment()}
            disabled={busy || newLines.length === 0}
            className="btn-primary w-full"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            إضافة إلى الفاتورة — {formatCurrency(deltaMinor, business.currency)}
          </button>
          <p className="text-center text-[10px] text-muted">
            الأصناف تُضاف بسطر مستقل وتُخصم من المخزون — القيد الأصلي لا يُمس ويُنشأ قيد إضافة متوازن
          </p>
        </div>
      </div>
    </div>
  );
}
