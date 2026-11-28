import { describe, expect, it } from "vitest";
import {
  buildDebtReminderMessage,
  buildSaleInvoiceMessage,
  buildWhatsappUrl,
  waDigits
} from "./whatsapp";

describe("waDigits", () => {
  it("يُطبع رقم واتساب صالح إلى أرقام فقط", () => {
    expect(waDigits("966599123456")).toBe("966599123456");
    expect(waDigits("+966 59-9123456")).toBe("966599123456");
    expect(waDigits("(970) 599-123-456")).toBe("970599123456");
  });

  it("يرفض الأرقام غير الصالحة", () => {
    expect(waDigits("")).toBeNull();
    expect(waDigits("0599123456")).toBeNull();
    expect(waDigits("1234567")).toBeNull();
    expect(waDigits("1234567890123456")).toBeNull();
  });
});

describe("buildWhatsappUrl", () => {
  it("يبني رابط wa.me مع نص مرمّز", () => {
    const url = buildWhatsappUrl("966599123456", "مرحباً");
    expect(url.startsWith("https://wa.me/966599123456?text=")).toBe(true);
    expect(url).toContain(encodeURIComponent("مرحباً"));
  });
});

describe("buildSaleInvoiceMessage", () => {
  it("يبني نص فاتورة كامل بالمبالغ والسطور", () => {
    const text = buildSaleInvoiceMessage({
      sale: {
        saleNumber: "INV-100",
        occurredAt: new Date().toISOString(),
        paymentMethod: "cash",
        totalAmountMinor: 1500,
        discountMinor: 100,
        netAmountMinor: 1400,
        paidAmountMinor: 1400,
        remainingAmountMinor: 0
      },
      items: [
        { name: "حليب", quantityLabel: "2", totalMinor: 900 },
        { name: "خبز", quantityLabel: "1", totalMinor: 600 }
      ],
      businessName: "بقالة النور",
      currency: "ILS",
      occurredAtLabel: "٢٨ نوفمبر ٢٠٢٦",
      paymentMethodLabel: "نقدي"
    });

    expect(text).toContain("فاتورة بيع — بقالة النور");
    expect(text).toContain("رقم الفاتورة: INV-100");
    expect(text).toContain("• حليب ×2 =");
    expect(text).toContain("• خبز ×1 =");
    expect(text).toContain("الخصم: -");
    expect(text).toContain("الصافي:");
    expect(text).not.toContain("المتبقي (آجل)");
  });

  it("يضمّن المتبقي الآجل عند وجوده", () => {
    const text = buildSaleInvoiceMessage({
      sale: {
        saleNumber: "INV-101",
        occurredAt: new Date().toISOString(),
        paymentMethod: "credit",
        totalAmountMinor: 2000,
        discountMinor: 0,
        netAmountMinor: 2000,
        paidAmountMinor: 500,
        remainingAmountMinor: 1500
      },
      items: [{ name: "سكر", quantityLabel: "1", totalMinor: 2000 }],
      businessName: "بقالة النور",
      currency: "ILS",
      occurredAtLabel: "٢٨ نوفمبر ٢٠٢٦",
      paymentMethodLabel: "آجل"
    });

    expect(text).toContain("المتبقي (آجل):");
  });
});

describe("buildDebtReminderMessage", () => {
  it("يبني رسالة تذكير باسم العميل والمبلغ المستحق", () => {
    const text = buildDebtReminderMessage({
      partyName: "أبو محمد",
      balanceMinor: 25000,
      businessName: "بقالة النور",
      currency: "ILS"
    });

    expect(text).toContain("تذكير ودّي — بقالة النور");
    expect(text).toContain("مرحباً أبو محمد");
    expect(text).toContain("رصيدكم المستحق لدينا:");
  });
});
