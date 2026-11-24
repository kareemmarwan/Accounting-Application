"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Boxes,
  ClipboardList,
  Coins,
  PackageOpen,
  Pencil,
  Plus,
  Scale,
  Search,
  Trash2
} from "lucide-react";
import { getDB, type LocalProduct } from "@/core/db/db";
import { formatCurrency } from "@/lib/format";
import { fromMinor } from "@/core/accounting/money";
import {
  fromMilli,
  MOVEMENT_TYPE_LABELS,
  UNIT_MILLI_LABELS,
  inventoryAdjustSchema,
  type InventoryAdjustInput
} from "@/core/validation/product";
import {
  adjustStock,
  softDeleteProduct
} from "@/features/inventory/services/inventory-service";
import { isLowStock } from "@/features/inventory/services/inventory-service";
import { ProductForm } from "@/features/inventory/components/product-form";

const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

type FormFilter = "all" | "low" | "inactive";

export function ProductsPageClient({
  business,
  canManage,
  autoOpenBarcode
}: {
  business: { id: string; name: string; currency: string };
  canManage: boolean;
  autoOpenBarcode?: string;
}) {
  const products = useLiveQuery(
    () =>
      getDB()
        .products.where("businessId")
        .equals(business.id)
        .filter((product) => !product.deletedAt)
        .toArray(),
    []
  );

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FormFilter>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LocalProduct | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<LocalProduct | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [prefillBarcode, setPrefillBarcode] = useState<string | null>(null);

  useEffect(() => {
    if (autoOpenBarcode && canManage) {
      setEditing(null);
      setPrefillBarcode(autoOpenBarcode);
      setFormKey((key) => key + 1);
      setFormOpen(true);
    }
  }, [autoOpenBarcode, canManage]);

  const active = (products ?? []).filter((product) => !product.deletedAt);
  const visible = active.filter((product) => {
    const query = search.trim().toLowerCase();
    if (query && !product.name.toLowerCase().includes(query) && !product.barcode.toLowerCase().includes(query)) {
      return false;
    }
    if (filter === "low") return isLowStock(product);
    if (filter === "inactive") return !product.isActive;
    return true;
  });

  const lowCount = active.filter((product) => product.isActive && isLowStock(product)).length;
  const stockValue = active.reduce(
    (sum, product) => sum + Math.round((product.quantityMilli * product.purchasePriceMinor) / 1000),
    0
  );

  async function handleDelete(product: LocalProduct) {
    setActionError(null);
    try {
      await softDeleteProduct(product.id, { businessId: business.id });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "تعذر حذف المنتج");
    }
  }

  async function handleAdjust(input: InventoryAdjustInput) {
    setActionError(null);
    try {
      const parsed = inventoryAdjustSchema.safeParse(input);
      if (!parsed.success) {
        setActionError(parsed.error.issues[0]?.message ?? "بيانات غير صالحة");
        return;
      }
      await adjustStock(parsed.data, { businessId: business.id });
      setAdjustTarget(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "تعذر تسجيل حركة المخزون");
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">المنتجات</h1>
          <p className="text-sm text-muted">
            منتجات {business.name} — الباركود والأسعار والمخزون، تعمل دون إنترنت وتُزامَن
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            data-tour="products-add"
            onClick={() => {
              setEditing(null);
              setFormKey((key) => key + 1);
              setFormOpen(true);
            }}
            className="btn-primary"
          >
            <Plus className="h-4 w-4" aria-hidden />
            منتج جديد
          </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card flex items-center gap-3">
          <span className="rounded-xl bg-primary-50 p-2.5 text-primary">
            <Boxes className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-xs text-muted">عدد المنتجات</p>
            <p className="num text-xl font-bold">{active.length}</p>
          </div>
        </div>
        <div className="card flex items-center gap-3">
          <span className="rounded-xl bg-warning/10 p-2.5 text-warning">
            <AlertTriangle className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-xs text-muted">تنبيه نقص مخزون</p>
            <p className="num text-xl font-bold">{lowCount}</p>
          </div>
        </div>
        <div className="card flex items-center gap-3">
          <span className="rounded-xl bg-secondary/10 p-2.5 text-secondary">
            <Coins className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-xs text-muted">قيمة المخزون (سعر الشراء)</p>
            <p className="num text-xl font-bold">{formatCurrency(stockValue, business.currency)}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted start-3" aria-hidden />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="بحث بالاسم أو الباركود"
            className="input ps-9"
            aria-label="بحث في المنتجات"
          />
        </div>
        {([
          ["all", "الكل"],
          ["low", "نقص مخزون"],
          ["inactive", "غير النشطة"]
        ] as Array<[FormFilter, string]>).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-xl px-3 py-2 text-xs font-bold transition-colors ${
              filter === value
                ? "bg-primary-50 text-primary-700"
                : "text-muted hover:bg-muted-foreground/10"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {actionError && (
        <p className="flex items-start gap-1.5 rounded-xl bg-danger/10 p-3 text-sm font-medium text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {actionError}
        </p>
      )}

      <div className="space-y-2">
        {products === undefined && (
          <div className="card flex items-center justify-center gap-2 p-6 text-sm text-muted">
            <span
              className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-primary/20 border-t-primary"
              aria-hidden
            />
            جارٍ التحميل...
          </div>
        )}
        {products !== undefined && visible.length === 0 && (
          <div className="card flex flex-col items-center gap-3 p-8 text-center">
            <PackageOpen className="h-8 w-8 text-muted" aria-hidden />
            <p className="text-sm text-muted">
              لا توجد منتجات مطابقة — أضف أول منتج بباركوده لتبدأ البيع من الكاشير
            </p>
          </div>
        )}
        {visible.map((product) => (
          <div key={product.id} className="card flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-bold">{product.name}</p>
                {!product.isActive && (
                  <span className="rounded-full bg-muted-foreground/10 px-2 py-0.5 text-[10px] text-muted">
                    غير نشط
                  </span>
                )}
                {product.isActive && isLowStock(product) && (
                  <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold text-warning">
                    نقص مخزون
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {product.category ? `${product.category} — ` : ""}
                <span className="num" dir="ltr">{product.barcode || "بلا باركود"}</span>
                {" — "}
                {UNIT_MILLI_LABELS[product.unit]}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-4 text-xs">
              <div>
                <p className="text-muted">بيع</p>
                <p className="num font-bold text-primary" dir="ltr">
                  {formatCurrency(product.salePriceMinor, business.currency)}
                </p>
              </div>
              <div>
                <p className="text-muted">شراء</p>
                <p className="num font-bold" dir="ltr">
                  {formatCurrency(product.purchasePriceMinor, business.currency)}
                </p>
              </div>
              <div>
                <p className="text-muted">الكمية</p>
                <p className="num font-bold" dir="ltr">
                  {fromMilli(product.quantityMilli)}
                </p>
              </div>
            </div>
            {canManage && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setAdjustTarget(product)}
                  className="btn-outline !p-2"
                  title="حركة مخزون"
                  aria-label={`حركة مخزون ${product.name}`}
                >
                  <ClipboardList className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(product);
                    setFormKey((key) => key + 1);
                    setFormOpen(true);
                  }}
                  className="btn-outline !p-2"
                  title="تعديل"
                  aria-label={`تعديل ${product.name}`}
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(product)}
                  className="btn-outline !p-2 text-danger"
                  title="حذف"
                  aria-label={`حذف ${product.name}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4">
          <div className="card w-full max-w-2xl">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-base font-bold">
                {editing ? `تعديل: ${editing.name}` : "منتج جديد"}
              </p>
              <button type="button" onClick={() => setFormOpen(false)} aria-label="إغلاق">
                <Archive className="h-4 w-4 text-muted" />
              </button>
            </div>
            <ProductForm
              key={formKey}
              businessId={business.id}
              initial={editing}
              initialBarcode={editing ? undefined : prefillBarcode ?? undefined}
              onDone={() => {
                setFormOpen(false);
                setEditing(null);
                setPrefillBarcode(null);
              }}
              onCancel={() => {
                setFormOpen(false);
                setEditing(null);
                setPrefillBarcode(null);
              }}
            />
          </div>
        </div>
      )}

      {adjustTarget && (
        <AdjustModal
          product={adjustTarget}
          currency={business.currency}
          onSubmit={(input) => void handleAdjust(input)}
          onClose={() => setAdjustTarget(null)}
        />
      )}
    </div>
  );
}

function AdjustModal({
  product,
  currency,
  onSubmit,
  onClose
}: {
  product: LocalProduct;
  currency: string;
  onSubmit: (input: InventoryAdjustInput) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<InventoryAdjustInput["type"]>("in");
  const [quantity, setQuantity] = useState("1.000");
  const [countedQuantity, setCountedQuantity] = useState(fromMilli(product.quantityMilli));
  const [unitCost, setUnitCost] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-sm space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold">حركة مخزون: {product.name}</p>
          <button type="button" onClick={onClose} aria-label="إغلاق">
            <ArchiveRestore className="h-4 w-4 text-muted" />
          </button>
        </div>
        <p className="num text-xs text-muted" dir="ltr">
          الكمية الدفترية: {fromMilli(product.quantityMilli)} {UNIT_MILLI_LABELS[product.unit]}
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {(["in", "out", "adjust"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setType(item)}
              className={`rounded-xl border px-2 py-2 text-xs font-bold transition-colors ${
                type === item
                  ? "border-primary bg-primary-50 text-primary-700"
                  : "border-border text-muted hover:bg-muted-foreground/10"
              }`}
            >
              {MOVEMENT_TYPE_LABELS[item]}
            </button>
          ))}
        </div>
        {type === "adjust" ? (
          <div>
            <label className="mb-1 block text-xs font-semibold" htmlFor="adjust-counted">
              الكمية المعدودة (جرد فعلي)
            </label>
            <input
              id="adjust-counted"
              value={countedQuantity}
              onChange={(event) => setCountedQuantity(event.target.value)}
              className={`${inputClass} num`}
              dir="ltr"
              inputMode="decimal"
            />
          </div>
        ) : (
          <div>
            <label className="mb-1 block text-xs font-semibold" htmlFor="adjust-qty">
              الكمية ({MOVEMENT_TYPE_LABELS[type]})
            </label>
            <input
              id="adjust-qty"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className={`${inputClass} num`}
              dir="ltr"
              inputMode="decimal"
            />
          </div>
        )}
        {type === "in" && (
          <div>
            <label className="mb-1 block text-xs font-semibold" htmlFor="adjust-cost">
              تكلفة الوحدة (₪) — اختياري
            </label>
            <input
              id="adjust-cost"
              value={unitCost}
              onChange={(event) => setUnitCost(event.target.value)}
              placeholder={fromMinor(product.purchasePriceMinor)}
              className={`${inputClass} num`}
              dir="ltr"
              inputMode="decimal"
            />
          </div>
        )}
        <input
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="ملاحظات (اختياري)"
          className={inputClass}
          aria-label="ملاحظات الحركة"
        />
        {error && <p className="text-xs font-medium text-danger">{error}</p>}
        <button
          type="button"
          onClick={() => {
            const parsed = inventoryAdjustSchema.safeParse({
              productId: product.id,
              type,
              quantity,
              countedQuantity: type === "adjust" ? countedQuantity : "",
              unitCost: type === "in" && unitCost.trim() ? unitCost : "",
              notes
            });
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? "بيانات غير صالحة");
              return;
            }
            setError(null);
            onSubmit(parsed.data);
          }}
          className="btn-primary w-full"
        >
          <Scale className="h-4 w-4" aria-hidden />
          تسجيل الحركة
        </button>
        <p className="num text-center text-[10px] text-muted" dir="ltr">
          {formatCurrency(product.salePriceMinor, currency)} — سعر البيع الحالي
        </p>
      </div>
    </div>
  );
}
