import { fromMinor, type Minor } from "@/core/accounting/money";

const CURRENCY = "ILS";

export function formatCurrency(value: Minor, currency: string = CURRENCY): string {
  const decimal = Number(fromMinor(value));
  try {
    return new Intl.NumberFormat("ar-PS", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(decimal);
  } catch {
    const symbol = currency === "ILS" ? "₪" : currency;
    return `${fromMinor(value)} ${symbol}`;
  }
}

export function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ar-PS", { dateStyle: "medium" }).format(
      new Date(iso)
    );
  } catch {
    return iso;
  }
}

export function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ar-PS", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatNumber(value: number): string {
  try {
    return new Intl.NumberFormat("ar-PS").format(value);
  } catch {
    return String(value);
  }
}
