"use client";

import { formatCurrency, formatDate } from "@/lib/format";
import { fromMilli } from "@/core/validation/product";
import { PAYMENT_METHOD_LABELS, type SalePaymentMethod } from "@/core/validation/sale";
import type { LocalSale } from "@/core/db/db";
import type { SaleItemDraft } from "@/features/sales/services/sales-service";

export function PosReceipt({
  sale,
  items,
  businessName,
  currency
}: {
  sale: LocalSale;
  items: SaleItemDraft[];
  businessName: string;
  currency: string;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-border bg-white p-4 text-xs">
      <div className="border-b border-dashed border-border pb-2 text-center">
        <p className="text-sm font-bold">{businessName}</p>
        <p className="mt-1 font-semibold">فاتورة بيع</p>
      </div>
      <div className="flex justify-between">
        <span className="text-muted">رقم الفاتورة</span>
        <span className="num font-bold" dir="ltr">{sale.saleNumber}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted">التاريخ</span>
        <span>{formatDate(sale.occurredAt)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted">طريقة الدفع</span>
        <span className="font-semibold">{PAYMENT_METHOD_LABELS[sale.paymentMethod as SalePaymentMethod]}</span>
      </div>

      <div className="border-y border-dashed border-border py-2">
        <table className="w-full">
          <thead>
            <tr className="text-muted">
              <th className="text-start font-medium">الصنف</th>
              <th className="text-center font-medium">الكمية</th>
              <th className="text-end font-medium">الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="py-0.5">
                  {item.name}
                  {item.lineNote && (
                    <span className="block text-[10px] text-muted">{item.lineNote}</span>
                  )}
                </td>
                <td className="num py-0.5 text-center" dir="ltr">
                  {fromMilli(item.quantityMilli)}
                </td>
                <td className="num py-0.5 text-end" dir="ltr">
                  {formatCurrency(item.totalMinor, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between">
          <span className="text-muted">المجموع</span>
          <span className="num" dir="ltr">{formatCurrency(sale.totalAmountMinor, currency)}</span>
        </div>
        {sale.discountMinor > 0 && (
          <div className="flex justify-between">
            <span className="text-muted">الخصم</span>
            <span className="num" dir="ltr">-{formatCurrency(sale.discountMinor, currency)}</span>
          </div>
        )}
        <div className="flex justify-between text-sm font-bold">
          <span>الصافي</span>
          <span className="num" dir="ltr">{formatCurrency(sale.netAmountMinor, currency)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">المدفوع</span>
          <span className="num" dir="ltr">{formatCurrency(sale.paidAmountMinor, currency)}</span>
        </div>
        {sale.remainingAmountMinor > 0 && (
          <div className="flex justify-between font-semibold text-warning">
            <span>المتبقي (آجل)</span>
            <span className="num" dir="ltr">{formatCurrency(sale.remainingAmountMinor, currency)}</span>
          </div>
        )}
      </div>

      {sale.notes && (
        <p className="border-t border-dashed border-border pt-2 text-[10px] text-muted">
          ملاحظات: {sale.notes}
        </p>
      )}
      <p className="border-t border-dashed border-border pt-2 text-center text-[10px] text-muted">
        فاتورة محفوظة على الجهاز — يُستبدل الرقم المؤقت برقم الترقيم النهائي عند المزامنة
      </p>
    </div>
  );
}
