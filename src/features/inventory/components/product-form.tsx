"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Barcode, Loader2 } from "lucide-react";
import {
  productFormSchema,
  generateBarcode,
  PRODUCT_UNITS,
  PRODUCT_UNIT_LABELS,
  fromMilli,
  type ProductFormInput
} from "@/core/validation/product";
import { fromMinor } from "@/core/accounting/money";
import {
  createProduct,
  updateProduct
} from "@/features/inventory/services/inventory-service";
import type { LocalProduct } from "@/core/db/db";

const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

function defaultsOf(product: LocalProduct | null): ProductFormInput {
  if (!product) {
    return {
      name: "",
      category: "",
      unit: "piece",
      barcode: "",
      purchasePrice: "0.00",
      salePrice: "0.00",
      quantity: "0.000",
      minQuantity: "0.000",
      isActive: true
    };
  }
  return {
    name: product.name,
    category: product.category,
    unit: product.unit,
    barcode: product.barcode,
    purchasePrice: fromMinor(product.purchasePriceMinor),
    salePrice: fromMinor(product.salePriceMinor),
    quantity: fromMilli(product.quantityMilli),
    minQuantity: fromMilli(product.minQuantityMilli),
    isActive: product.isActive
  };
}

export function ProductForm({
  businessId,
  initial,
  initialBarcode,
  onDone,
  onCancel
}: {
  businessId: string;
  initial: LocalProduct | null;
  initialBarcode?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting }
  } = useForm<ProductFormInput>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      ...defaultsOf(initial),
      barcode: !initial && initialBarcode ? initialBarcode : defaultsOf(initial).barcode
    }
  });

  const unit = watch("unit");

  async function onSubmit(input: ProductFormInput) {
    setServerError(null);
    try {
      if (initial) {
        await updateProduct(initial.id, input, { businessId });
      } else {
        await createProduct(input, { businessId });
      }
      onDone();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "تعذر حفظ المنتج");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold" htmlFor="product-name">
            اسم المنتج *
          </label>
          <input
            id="product-name"
            className={inputClass}
            {...register("name")}
          />
          {errors.name && <p className="mt-1 text-xs text-danger">{errors.name.message}</p>}
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold" htmlFor="product-category">
            التصنيف
          </label>
          <input
            id="product-category"
            className={inputClass}
            placeholder="مثال: ألبان، مسكنات، هواتف"
            {...register("category")}
          />
          {errors.category && (
            <p className="mt-1 text-xs text-danger">{errors.category.message}</p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold" htmlFor="product-unit">
            وحدة القياس *
          </label>
          <select id="product-unit" className={inputClass} {...register("unit")}>
            {PRODUCT_UNITS.map((item) => (
              <option key={item} value={item}>
                {PRODUCT_UNIT_LABELS[item]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold" htmlFor="product-barcode">
            الباركود (رقم تعريفي)
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Barcode className="absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted start-3" aria-hidden />
              <input
                id="product-barcode"
                className={`${inputClass} ps-9`}
                dir="ltr"
                autoComplete="off"
                autoFocus={!initial}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    document.getElementById("product-name")?.focus();
                  }
                }}
                {...register("barcode")}
              />
            </div>
            <button
              type="button"
              onClick={() => setValue("barcode", generateBarcode())}
              className="btn-outline shrink-0 text-xs"
            >
              توليد
            </button>
          </div>
          <p className="mt-1 text-[10px] text-muted">
            ضع المؤشر هنا وامسح الباركود بالماسح — Enter ينقلك لاسم المنتج
          </p>
          {errors.barcode && (
            <p className="mt-1 text-xs text-danger">{errors.barcode.message}</p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold" htmlFor="product-purchase">
            سعر الشراء (₪)
          </label>
          <input
            id="product-purchase"
            className={`${inputClass} num`}
            dir="ltr"
            inputMode="decimal"
            {...register("purchasePrice")}
          />
          {errors.purchasePrice && (
            <p className="mt-1 text-xs text-danger">{errors.purchasePrice.message}</p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold" htmlFor="product-sale">
            سعر البيع (₪)
          </label>
          <input
            id="product-sale"
            className={`${inputClass} num`}
            dir="ltr"
            inputMode="decimal"
            {...register("salePrice")}
          />
          {errors.salePrice && (
            <p className="mt-1 text-xs text-danger">{errors.salePrice.message}</p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold" htmlFor="product-quantity">
            الكمية {initial ? "(الحالية)" : "(الافتتاحية)"}
          </label>
          <input
            id="product-quantity"
            className={`${inputClass} num`}
            dir="ltr"
            inputMode="decimal"
            {...register("quantity")}
          />
          {errors.quantity && (
            <p className="mt-1 text-xs text-danger">{errors.quantity.message}</p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold" htmlFor="product-min">
            الكمية الدنيا (تنبيه)
          </label>
          <input
            id="product-min"
            className={`${inputClass} num`}
            dir="ltr"
            inputMode="decimal"
            {...register("minQuantity")}
          />
          {errors.minQuantity && (
            <p className="mt-1 text-xs text-danger">{errors.minQuantity.message}</p>
          )}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4" {...register("isActive")} />
        منتج نشط (يظهر في الكاشير)
      </label>

      {serverError && (
        <p className="flex items-start gap-1.5 rounded-xl bg-danger/10 p-2 text-xs font-medium text-danger">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {serverError}
        </p>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={isSubmitting} className="btn-primary flex-1">
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {initial ? "حفظ التعديلات" : "إضافة المنتج"}
        </button>
        <button type="button" onClick={onCancel} className="btn-outline">
          إلغاء
        </button>
      </div>
      {unit && (
        <p className="text-[10px] text-muted">
          الكميات تُدخل بوحدة {PRODUCT_UNIT_LABELS[unit]} — حتى 3 خانات عشرية للوزن (مثال: 1.250)
        </p>
      )}
    </form>
  );
}
