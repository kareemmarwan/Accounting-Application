import type { Minor } from "@/core/accounting/money";
import { formatCurrency } from "@/lib/format";
import type { LocalSale } from "@/core/db/db";

export interface InvoiceLineDraft {
  name: string;
  quantityLabel: string;
  totalMinor: Minor;
}

export interface SaleInvoiceMessageInput {
  sale: Pick<
    LocalSale,
    "saleNumber" | "occurredAt" | "paymentMethod" | "totalAmountMinor" | "discountMinor" | "netAmountMinor" | "paidAmountMinor" | "remainingAmountMinor"
  >;
  items: InvoiceLineDraft[];
  businessName: string;
  currency: string;
  occurredAtLabel: string;
  paymentMethodLabel: string;
}

export interface DebtReminderInput {
  partyName: string;
  balanceMinor: Minor;
  businessName: string;
  currency: string;
}

export function waDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  if (digits.startsWith("0")) return null;
  return digits;
}

export function buildWhatsappUrl(digits: string, text: string): string {
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function openWhatsapp(digits: string, text: string): void {
  window.open(buildWhatsappUrl(digits, text), "_blank", "noopener,noreferrer");
}

function formatAmount(minor: Minor, currency: string): string {
  return formatCurrency(minor, currency);
}

export function buildSaleInvoiceMessage(input: SaleInvoiceMessageInput): string {
  const { sale, items, businessName, currency, occurredAtLabel, paymentMethodLabel } = input;
  const lines: string[] = [
    `فاتورة بيع — ${businessName}`,
    `رقم الفاتورة: ${sale.saleNumber}`,
    `التاريخ: ${occurredAtLabel}`,
    `طريقة الدفع: ${paymentMethodLabel}`,
    "------------------"
  ];
  for (const item of items) {
    lines.push(`• ${item.name} ×${item.quantityLabel} = ${formatAmount(item.totalMinor, currency)}`);
  }
  lines.push("------------------");
  lines.push(`المجموع: ${formatAmount(sale.totalAmountMinor, currency)}`);
  if (sale.discountMinor > 0) {
    lines.push(`الخصم: -${formatAmount(sale.discountMinor, currency)}`);
  }
  lines.push(`الصافي: ${formatAmount(sale.netAmountMinor, currency)}`);
  lines.push(`المدفوع: ${formatAmount(sale.paidAmountMinor, currency)}`);
  if (sale.remainingAmountMinor > 0) {
    lines.push(`المتبقي (آجل): ${formatAmount(sale.remainingAmountMinor, currency)}`);
  }
  lines.push("شكراً لتعاملكم معنا 🌿");
  return lines.join("\n");
}

export function buildDebtReminderMessage(input: DebtReminderInput): string {
  const { partyName, balanceMinor, businessName, currency } = input;
  return [
    `تذكير ودّي — ${businessName}`,
    "",
    `مرحباً ${partyName}`,
    `رصيدكم المستحق لدينا: ${formatAmount(balanceMinor, currency)}`,
    "",
    "نأمل تسديد المبلغ عند السعة. شكراً لتعاملكم معنا 🌿"
  ].join("\n");
}
