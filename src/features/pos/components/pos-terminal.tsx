"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import {
  AlertTriangle,
  Banknote,
  Camera,
  CheckCircle2,
  CreditCard,
  FilePenLine,
  Minus,
  PackageOpen,
  Plus,
  Printer,
  ScanLine,
  Search,
  ShoppingCart,
  Trash2,
  X
} from "lucide-react";
import { getDB, type LocalProduct, type LocalSale } from "@/core/db/db";
import { Modal } from "@/components/ui/modal";
import { fromMinor, toMinor } from "@/core/accounting/money";
import { formatCurrency } from "@/lib/format";
import { fromMilli, parseQuantityToMilli, parseScaleBarcode, PRODUCT_UNIT_LABELS, UNIT_MILLI_LABELS } from "@/core/validation/product";
import {
  findProductByBarcode,
  isLowStock
} from "@/features/inventory/services/inventory-service";
import { PAYMENT_METHOD_LABELS, type SalePaymentMethod } from "@/core/validation/sale";
import { newCartLine, cartTotals, lineTotalMinor, type PosCartLine } from "@/features/pos/cart";
import { checkout } from "@/features/pos/services/pos-service";
import { isWeightUnit, posThemeFor } from "@/features/pos/themes";
import { PosReceipt } from "@/features/pos/components/pos-receipt";
import { PosAmendModal } from "@/features/pos/components/pos-amend-modal";
import { BarcodeCameraScannerLazy } from "@/components/barcode-camera-scanner-lazy";
import type { CreateSaleResult } from "@/features/sales/services/sales-service";

interface BusinessInfo {
  id: string;
  name: string;
  businessType: string;
  currency: string;
}

const QUICK_METHODS: SalePaymentMethod[] = ["cash", "credit", "bank_transfer", "palpay", "jawwal_pay", "electronic"];

function safeToMinor(input: string): number | null {
  try {
    return toMinor(input);
  } catch {
    return null;
  }
}

export function PosTerminal({ business }: { business: BusinessInfo }) {
  const theme = posThemeFor(business.businessType);

  const products = useLiveQuery(
    () =>
      getDB()
        .products.where("businessId")
        .equals(business.id)
        .filter(
          (product) => !product.deletedAt && product.isActive
        )
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

  const [cart, setCart] = useState<PosCartLine[]>([]);
  const [discountInput, setDiscountInput] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<SalePaymentMethod>("cash");
  const [accountId, setAccountId] = useState("");
  const [paidInput, setPaidInput] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [notes, setNotes] = useState("");
  const [scan, setScan] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [weightTarget, setWeightTarget] = useState<LocalProduct | null>(null);
  const [weightInput, setWeightInput] = useState("1.000");
  const [noteTarget, setNoteTarget] = useState<LocalProduct | null>(null);
  const [noteInput, setNoteInput] = useState("");
  const [receipt, setReceipt] = useState<{
    sale: LocalSale;
    items: CreateSaleResult["items"];
    netMinor: number;
  } | null>(null);
  const [amendOpen, setAmendOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  const scanRef = useRef<HTMLInputElement>(null);

  const totals = useMemo(() => {
    const discount = discountInput.trim() ? safeToMinor(discountInput) : 0;
    return cartTotals(cart, discount ?? 0);
  }, [cart, discountInput]);

  const netMinor = totals.netMinor;
  const paidMinor = useMemo(() => {
    if (paymentMethod === "credit") return 0;
    if (paidInput.trim() === "") return netMinor;
    const value = safeToMinor(paidInput);
    if (value === null) return 0;
    return Math.max(0, Math.min(value, netMinor));
  }, [paidInput, netMinor, paymentMethod]);
  const remainingMinor = netMinor - paidMinor;

  useEffect(() => {
    if (receipt) return;
    scanRef.current?.focus();
  }, [receipt]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const product of products ?? []) {
      if (product.category) set.add(product.category);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ar"));
  }, [products]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (products ?? []).filter((product) => {
      if (category && product.category !== category) return false;
      if (!query) return true;
      return (
        product.name.toLowerCase().includes(query) ||
        product.barcode.toLowerCase().includes(query)
      );
    });
  }, [products, search, category]);

  function addLine(product: LocalProduct, quantityMilli: number, lineNote = "") {
    setError(null);
    setCart((current) => [...current, newCartLine(product, quantityMilli, lineNote)]);
  }

  async function submitCode(code: string): Promise<boolean> {
    if (!code) return true;
    const scaleLabel = parseScaleBarcode(code);
    if (scaleLabel) {
      const scaleProduct = await findProductByBarcode(
        `2${scaleLabel.itemCode}`,
        business.id
      );
      if (scaleProduct) {
        setScanError(null);
        addLine(scaleProduct, scaleLabel.quantityMilli);
        return true;
      }
    }
    const product = await findProductByBarcode(code, business.id);
    if (!product) {
      setScanError(`لا يوجد منتج بالباركود: ${code}`);
      return false;
    }
    setScanError(null);
    if (isWeightUnit(product.unit)) {
      setWeightInput("1.000");
      setWeightTarget(product);
      return false;
    }
    if (theme.lineNoteLabel) {
      setNoteInput("");
      setNoteTarget(product);
      return false;
    }
    addLine(product, 1000);
    return true;
  }

  function handleScanSubmit() {
    const code = scan.trim();
    setScan("");
    void submitCode(code);
  }

  function handleCameraCode(code: string): Promise<boolean> {
    return submitCode(code.trim());
  }

  function handleTileClick(product: LocalProduct) {
    setError(null);
    if (isWeightUnit(product.unit)) {
      setWeightInput("1.000");
      setWeightTarget(product);
      return;
    }
    if (theme.lineNoteLabel) {
      setNoteInput("");
      setNoteTarget(product);
      return;
    }
    addLine(product, 1000);
  }

  function updateLine(key: string, patch: Partial<PosCartLine>) {
    setCart((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line))
    );
  }

  function removeLine(key: string) {
    setCart((current) => current.filter((line) => line.key !== key));
  }

  function resetCart() {
    setCart([]);
    setDiscountInput("");
    setPaidInput("");
    setCustomerId("");
    setNotes("");
    setPaymentMethod("cash");
    setError(null);
  }

  async function handleCheckout() {
    setError(null);
    if (!accounts || accounts.length === 0) {
      setError("لا يوجد حساب مالي — أنشئ صندوقاً في الحسابات المالية أولاً");
      return;
    }
    setBusy(true);
    try {
      const firstAccount = accounts[0];
      const effectiveAccount =
        paymentMethod === "credit"
          ? ""
          : accountId || (firstAccount ? firstAccount.id : "");
      const { result } = await checkout(
        {
          lines: cart,
          discountMinor: totals.discountMinor,
          paymentMethod,
          accountId: effectiveAccount,
          paidAmountMinor: paidMinor,
          customerId,
          notes,
          requireCustomer: theme.requireCustomer
        },
        {
          businessId: business.id,
          accountRef: effectiveAccount
            ? {
                id: effectiveAccount,
                type:
                  accounts.find((account) => account.id === effectiveAccount)?.type ??
                  "cash"
              }
            : undefined
        }
      );
      setReceipt({ sale: result.sale, items: result.items, netMinor });
      resetCart();
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "تعذر إتمام البيع");
    } finally {
      setBusy(false);
      scanRef.current?.focus();
    }
  }

  const productGrid = (
    <div
      className={
        theme.layout === "grid"
          ? "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
          : "flex flex-col gap-2"
      }
    >
      {filteredProducts.map((product) => {
        const low = isLowStock(product);
        return (
          <button
            key={product.id}
            type="button"
            onClick={() => handleTileClick(product)}
            className={`${theme.tileClass} ${
              theme.layout === "list" ? "flex-row items-center justify-between" : ""
            }`}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{product.name}</p>
              {product.category && (
                <p className="truncate text-xs text-muted">{product.category}</p>
              )}
            </div>
            <div className="flex flex-col items-start gap-0.5">
              <span className="num text-sm font-bold text-primary">
                {formatCurrency(product.salePriceMinor, business.currency)}
              </span>
              <span className="num text-xs text-muted">
                {fromMilli(product.quantityMilli)} {UNIT_MILLI_LABELS[product.unit]}
              </span>
            </div>
            {low && (
              <span className="absolute -mt-8 ms-auto rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold text-warning">
                مخزون منخفض
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  const emptyState = (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border p-8 text-center">
      <PackageOpen className="h-8 w-8 text-muted" aria-hidden />
      <p className="text-sm text-muted">
        لا توجد منتجات بعد — أضف منتجاتك مع باركودها لبدء البيع بالماسح
      </p>
      <Link href="/products" className="btn-outline">
        إدارة المنتجات
      </Link>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${theme.headerClass}`}>
        <theme.icon className="h-6 w-6" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{theme.label} — {business.name}</p>
          <p className="text-xs opacity-80">{theme.hint}</p>
        </div>
        <div className="flex items-center gap-1.5 rounded-xl bg-black/10 px-3 py-1.5 text-xs font-bold">
          <ScanLine className="h-4 w-4" aria-hidden />
          ماسح الباركود
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          <div className="card p-3">
            <div className="flex items-center gap-2">
              <ScanLine className="h-5 w-5 shrink-0 text-primary" aria-hidden />
              <input
                ref={scanRef}
                value={scan}
                onChange={(event) => {
                  setScan(event.target.value);
                  setScanError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleScanSubmit();
                  }
                }}
                placeholder={theme.scanPlaceholder}
                className="input num"
                dir="ltr"
                autoComplete="off"
                aria-label="إدخال الباركود"
              />
              <button
                type="button"
                onClick={() => setCameraOpen(true)}
                className="btn-outline shrink-0 !px-3"
                aria-label="مسح الباركود بالكاميرا"
              >
                <Camera className="h-5 w-5" aria-hidden />
                <span className="hidden sm:inline">كاميرا</span>
              </button>
              <button type="button" onClick={handleScanSubmit} className="btn-primary shrink-0">
                إضافة
              </button>
            </div>
            {cameraOpen && (
              <div className="mt-3">
                <BarcodeCameraScannerLazy
                  onClose={() => setCameraOpen(false)}
                  onDetected={handleCameraCode}
                />
              </div>
            )}
            {scanError && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="flex items-center gap-1.5 text-xs font-medium text-danger">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  {scanError}
                </p>
                <Link
                  href={`/products?barcode=${encodeURIComponent(scanError.replace("لا يوجد منتج بالباركود: ", ""))}`}
                  className="rounded-lg bg-primary-50 px-2 py-1 text-xs font-bold text-primary-700 hover:bg-primary-50/70"
                >
                  إضافة منتج بهذا الباركود
                </Link>
              </div>
            )}
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
            <button
              type="button"
              onClick={() => setCategory("")}
              className={`rounded-xl px-3 py-2 text-xs font-bold transition-colors ${
                category === "" ? theme.accentChipClass : "text-muted hover:bg-muted-foreground/10"
              }`}
            >
              الكل
            </button>
            {categories.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setCategory(item === category ? "" : item)}
                className={`rounded-xl px-3 py-2 text-xs font-bold transition-colors ${
                  category === item ? theme.accentChipClass : "text-muted hover:bg-muted-foreground/10"
                }`}
              >
                {item}
              </button>
            ))}
          </div>

          <div className="card max-h-[60vh] overflow-y-auto p-3">
            {products === undefined ? (
              <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted">
                <span
                  className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-primary/20 border-t-primary"
                  aria-hidden
                />
                جارٍ تحميل المنتجات...
              </div>
            ) : (products ?? []).length === 0 ? (
              emptyState
            ) : filteredProducts.length === 0 ? (
              <p className="p-4 text-sm text-muted">لا نتائج مطابقة</p>
            ) : (
              productGrid
            )}
          </div>
        </div>

        <aside className="flex h-fit flex-col gap-3 rounded-2xl border border-border bg-surface p-3 shadow-card lg:sticky lg:top-20">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-bold">
              <ShoppingCart className="h-4 w-4" aria-hidden />
              الفاتورة ({cart.length})
            </span>
            {cart.length > 0 && (
              <button
                type="button"
                onClick={resetCart}
                className="text-xs font-medium text-danger hover:underline"
              >
                إفراغ
              </button>
            )}
          </div>

          <div className="max-h-64 space-y-2 overflow-y-auto">
            {cart.length === 0 && (
              <p className="rounded-xl bg-muted-foreground/5 p-3 text-center text-xs text-muted">
                السلة فارغة — كل مسحة تُسجَّل سطراً مستقلاً؛ للحذف احذف السطر المطلوب فقط
              </p>
            )}
            {cart.map((line) => (
              <div key={line.key} className="rounded-xl border border-border p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold">{line.name}</p>
                    {line.lineNote && (
                      <p className="truncate text-[10px] text-muted">{line.lineNote}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(line.key)}
                    className="text-muted hover:text-danger"
                    aria-label={`حذف ${line.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        updateLine(line.key, {
                          quantityMilli: Math.max(0, line.quantityMilli - 1000)
                        })
                      }
                      className="rounded-lg border border-border p-1 hover:bg-muted-foreground/10"
                      aria-label="نقص الكمية"
                    >
                      <Minus className="h-3 w-3" aria-hidden />
                    </button>
                    <input
                      value={fromMilli(line.quantityMilli)}
                      onChange={(event) => {
                        const milli = parseQuantityToMilli(event.target.value || "0");
                        if (Number.isFinite(milli)) {
                          updateLine(line.key, { quantityMilli: milli });
                        }
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
                      aria-label="زيادة الكمية"
                    >
                      <Plus className="h-3 w-3" aria-hidden />
                    </button>
                    <span className="text-[10px] text-muted">{UNIT_MILLI_LABELS[line.unit]}</span>
                  </div>
                    <input
                      value={fromMilli(line.unitPriceMinor)}
                      onChange={(event) => {
                        const value = safeToMinor(event.target.value || "0");
                        if (value !== null) {
                          updateLine(line.key, { unitPriceMinor: value });
                        }
                      }}
                      className="input num !w-24 !px-2 !py-1 text-xs"
                      dir="ltr"
                      inputMode="decimal"
                      aria-label={`سعر ${line.name}`}
                    />
                  <span className="num ms-auto text-xs font-bold">
                    {formatCurrency(lineTotalMinor(line), business.currency)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-1.5 border-t border-border pt-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted">المجموع</span>
              <span className="num font-bold">{formatCurrency(totals.subtotalMinor, business.currency)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted">الخصم</span>
              <input
                value={discountInput}
                onChange={(event) => setDiscountInput(event.target.value)}
                placeholder="0.00"
                className="input num !w-24 !px-2 !py-1 text-xs"
                dir="ltr"
                inputMode="decimal"
                aria-label="الخصم"
              />
            </div>
            <div className="flex items-center justify-between text-base font-bold">
              <span>الصافي</span>
              <span className="num text-primary">{formatCurrency(netMinor, business.currency)}</span>
            </div>
          </div>

          <div className="space-y-2 border-t border-border pt-3">
            <div className="grid grid-cols-3 gap-1.5">
              {QUICK_METHODS.map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => {
                    setPaymentMethod(method);
                    if (method === "credit") {
                      setPaidInput("0");
                    }
                  }}
                  className={`rounded-xl border px-2 py-2 text-xs font-bold transition-colors ${
                    paymentMethod === method
                      ? "border-primary bg-primary-50 text-primary-700"
                      : "border-border text-muted hover:bg-muted-foreground/10"
                  }`}
                >
                  {PAYMENT_METHOD_LABELS[method]}
                </button>
              ))}
            </div>

            {paymentMethod !== "credit" && (
              <>
                <select
                  value={accountId}
                  onChange={(event) => setAccountId(event.target.value)}
                  className="input text-xs"
                  aria-label="الحساب المستلم"
                >
                  <option value="">الحساب المستلم — تلقائي</option>
                  {(accounts ?? []).map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
            <div className="flex items-center gap-2" data-tour="pos-scan">
                  <label className="shrink-0 text-xs text-muted" htmlFor="pos-paid">المدفوع</label>
                  <input
                    id="pos-paid"
                    value={paidInput}
                    onChange={(event) => setPaidInput(event.target.value)}
                    placeholder={fromMinor(netMinor)}
                    className="input num flex-1 text-xs"
                    dir="ltr"
                    inputMode="decimal"
                  />
                </div>
              </>
            )}

            {(remainingMinor > 0 || paymentMethod === "credit" || customerId) && (
              <select
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
                className="input text-xs"
                aria-label="العميل"
              >
                <option value="">بدون عميل</option>
                {(customers ?? []).map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            )}
            {theme.requireCustomer && !customerId && (
              <p className="text-[10px] font-medium text-warning">
                هذا المتجر يتطلب اختيار العميل لكل فاتورة
              </p>
            )}
            {remainingMinor > 0 && customerId && (
              <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
                <CreditCard className="h-3.5 w-3.5" aria-hidden />
                آجل: {formatCurrency(remainingMinor, business.currency)} على العميل
              </p>
            )}
            {remainingMinor === 0 && netMinor > 0 && paidMinor > 0 && (
              <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
                <Banknote className="h-3.5 w-3.5" aria-hidden />
                مدفوع بالكامل
              </p>
            )}
            {paymentMethod === "cash" && (safeToMinor(paidInput) ?? 0) > netMinor && (
              <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
                <Banknote className="h-3.5 w-3.5" aria-hidden />
                الباقي للعميل (كاش باك):{" "}
                <span className="num font-bold" dir="ltr">
                  {formatCurrency((safeToMinor(paidInput) ?? 0) - netMinor, business.currency)}
                </span>
              </p>
            )}

            <input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="ملاحظات (اختياري)"
              className="input text-xs"
              aria-label="ملاحظات الفاتورة"
            />

            {error && (
              <p className="flex items-start gap-1.5 rounded-xl bg-danger/10 p-2 text-xs font-medium text-danger">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={() => void handleCheckout()}
              disabled={busy || cart.length === 0}
              data-tour="pos-checkout"
              className="btn-primary w-full !py-3 text-base"
            >
              {busy ? "جارٍ الحفظ..." : `إتمام البيع — ${formatCurrency(netMinor, business.currency)}`}
            </button>
            <button
              type="button"
              onClick={() => setAmendOpen(true)}
              className="btn-outline w-full text-xs"
            >
              <FilePenLine className="h-4 w-4" aria-hidden />
              تعديل فاتورة سابقة (إضافة أصناف)
            </button>
          </div>
        </aside>
      </div>

      {amendOpen && (
        <PosAmendModal
          business={{
            id: business.id,
            name: business.name,
            currency: business.currency
          }}
          onClose={() => setAmendOpen(false)}
          onAmended={() => setAmendOpen(false)}
        />
      )}

      {weightTarget && (
        <Modal
          open
          onClose={() => setWeightTarget(null)}
          label="إدخال الوزن"
          size="sm"
          className="space-y-3"
        >
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold">وزن: {weightTarget.name}</p>
              <button type="button" onClick={() => setWeightTarget(null)} aria-label="إغلاق">
                <X className="h-4 w-4 text-muted" />
              </button>
            </div>
            <p className="text-xs text-muted">
              أدخل الوزن بوحدة {PRODUCT_UNIT_LABELS[weightTarget.unit]} — مثال: 1.250
            </p>
            <input
              value={weightInput}
              onChange={(event) => setWeightInput(event.target.value)}
              className="input num text-center text-2xl font-bold"
              dir="ltr"
              inputMode="decimal"
              aria-label="الوزن"
              autoFocus
            />
            <p className="num text-center text-sm font-bold text-primary">
              {formatCurrency(
                Math.round((weightTarget.salePriceMinor * parseQuantityToMilli(weightInput || "0")) / 1000),
                business.currency
              )}
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {["0.500", "1.000", "2.000", "3.000", "5.000", "10.000"].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setWeightInput(preset)}
                  className="rounded-xl border border-border px-2 py-2 text-xs font-bold hover:bg-muted-foreground/10"
                >
                  {preset}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                const milli = parseQuantityToMilli(weightInput || "0");
                if (!Number.isFinite(milli) || milli <= 0) {
                  setError("الوزن غير صالح");
                  return;
                }
                addLine(weightTarget, milli);
                setWeightTarget(null);
              }}
              className="btn-primary w-full"
            >
              إضافة إلى الفاتورة
            </button>
        </Modal>
      )}

      {noteTarget && (
        <Modal
          open
          onClose={() => setNoteTarget(null)}
          label="ملاحظة السطر"
          size="sm"
          className="space-y-3"
        >
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold">{noteTarget.name}</p>
              <button type="button" onClick={() => setNoteTarget(null)} aria-label="إغلاق">
                <X className="h-4 w-4 text-muted" />
              </button>
            </div>
            <p className="text-xs text-muted">{theme.lineNoteLabel} (اختياري — لكل قطعة سطر مستقل)</p>
            <input
              value={noteInput}
              onChange={(event) => setNoteInput(event.target.value)}
              placeholder={theme.lineNoteLabel ?? ""}
              className="input"
              autoFocus
              aria-label={theme.lineNoteLabel ?? "ملاحظة السطر"}
            />
            <button
              type="button"
              onClick={() => {
                addLine(noteTarget, 1000, noteInput.trim());
                setNoteTarget(null);
              }}
              className="btn-primary w-full"
            >
              إضافة إلى الفاتورة
            </button>
        </Modal>
      )}

      {receipt && (
        <Modal
          open
          onClose={() => setReceipt(null)}
          label="فاتورة البيع"
          size="md"
          className="space-y-3 print-area"
        >
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 text-sm font-bold text-primary">
                <CheckCircle2 className="h-5 w-5" aria-hidden />
                تم إتمام البيع
              </p>
              <button type="button" onClick={() => setReceipt(null)} className="print:hidden" aria-label="إغلاق">
                <X className="h-4 w-4 text-muted" />
              </button>
            </div>
            <PosReceipt
              sale={receipt.sale}
              items={receipt.items}
              businessName={business.name}
              currency={business.currency}
            />
            <div className="flex gap-2 print:hidden">
              <button type="button" onClick={() => window.print()} className="btn-outline flex-1">
                <Printer className="h-4 w-4" aria-hidden />
                طباعة الفاتورة
              </button>
              <button type="button" onClick={() => setReceipt(null)} className="btn-primary flex-1">
                فاتورة جديدة
              </button>
            </div>
        </Modal>
      )}
    </div>
  );
}
