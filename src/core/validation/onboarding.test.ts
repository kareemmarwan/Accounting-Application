import { describe, expect, it } from "vitest";
import {
  bankAccountStepSchema,
  businessStepSchema,
  cashAccountStepSchema,
  customerStepSchema,
  onboardingSchema,
  ownerStepSchema
} from "./onboarding";

describe("ownerStepSchema", () => {
  it("يقبل اسماً صالحاً", () => {
    const result = ownerStepSchema.safeParse({ ownerName: "  أحمد محمد  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ownerName).toBe("أحمد محمد");
    }
  });

  it("يرفض اسماً قصيراً جداً", () => {
    expect(ownerStepSchema.safeParse({ ownerName: "أ" }).success).toBe(false);
  });

  it("يرفض اسماً فارغاً", () => {
    expect(ownerStepSchema.safeParse({ ownerName: "   " }).success).toBe(false);
  });
});

describe("businessStepSchema", () => {
  it("يقبل نوع نشاط معروفاً", () => {
    const result = businessStepSchema.safeParse({
      businessName: "بقالة النور",
      businessType: "grocery"
    });
    expect(result.success).toBe(true);
  });

  it("يرفض نوع نشاط غير معروف", () => {
    const result = businessStepSchema.safeParse({
      businessName: "بقالة النور",
      businessType: "factory"
    });
    expect(result.success).toBe(false);
  });
});

describe("cashAccountStepSchema", () => {
  it("يقبل مبلغاً صالحاً بكسور خانتين", () => {
    expect(
      cashAccountStepSchema.safeParse({
        cashName: "الصندوق الرئيسي",
        cashOpeningBalance: "1250.50"
      }).success
    ).toBe(true);
  });

  it("يرفض كسوراً أكثر من خانتين", () => {
    expect(
      cashAccountStepSchema.safeParse({
        cashName: "الصندوق الرئيسي",
        cashOpeningBalance: "10.999"
      }).success
    ).toBe(false);
  });

  it("يرفض مبلغاً سالباً", () => {
    expect(
      cashAccountStepSchema.safeParse({
        cashName: "الصندوق الرئيسي",
        cashOpeningBalance: "-5.00"
      }).success
    ).toBe(false);
  });

  it("يرفض نصاً غير رقمي", () => {
    expect(
      cashAccountStepSchema.safeParse({
        cashName: "الصندوق الرئيسي",
        cashOpeningBalance: "ألف"
      }).success
    ).toBe(false);
  });
});

describe("bankAccountStepSchema", () => {
  it("يقبل اسمًا فارغاً عند عدم الإضافة", () => {
    expect(bankAccountStepSchema.safeParse({ bankName: "" }).success).toBe(
      true
    );
  });

  it("يقبل بيانات بنكية كاملة", () => {
    expect(
      bankAccountStepSchema.safeParse({
        bankName: "بنك فلسطين — جاري",
        bankType: "bank",
        bankProvider: "bank_palestine",
        bankOpeningBalance: "5000.00"
      }).success
    ).toBe(true);
  });
});

describe("customerStepSchema", () => {
  it("يقبل اسمًا فارغاً (اختياري)", () => {
    expect(
      customerStepSchema.safeParse({ customerName: "", customerPhone: "" })
        .success
    ).toBe(true);
  });

  it("يرفض رقم هاتف فاسد مع اسم صالح", () => {
    expect(
      customerStepSchema.safeParse({
        customerName: "سامر",
        customerPhone: "abc"
      }).success
    ).toBe(false);
  });

  it("يقبل رقم هاتف صالح", () => {
    expect(
      customerStepSchema.safeParse({
        customerName: "سامر",
        customerPhone: "0599123456"
      }).success
    ).toBe(true);
  });
});

describe("onboardingSchema", () => {
  const validInput = {
    ownerName: "أحمد محمد",
    businessName: "بقالة النور",
    businessType: "grocery",
    currency: "ILS",
    cashAccount: { name: "الصندوق الرئيسي", openingBalanceMinor: 125050 },
    bankAccount: {
      name: "بنك فلسطين",
      type: "bank",
      provider: "bank_palestine",
      openingBalanceMinor: 500000
    },
    firstCustomer: { name: "سامر", phone: "0599123456" },
    firstSupplier: null
  } as const;

  it("يقبل حمولة مكتملة صالحة", () => {
    const result = onboardingSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("يرفض رصيداً افتتاحياً كسرياً", () => {
    const result = onboardingSchema.safeParse({
      ...validInput,
      cashAccount: { name: "الصندوق الرئيسي", openingBalanceMinor: 1.5 }
    });
    expect(result.success).toBe(false);
  });

  it("يرفض عملة غير مدعومة", () => {
    const result = onboardingSchema.safeParse({
      ...validInput,
      currency: "EUR"
    });
    expect(result.success).toBe(false);
  });

  it("يقبل بلا حساب بنكي وبلا أطراف", () => {
    const result = onboardingSchema.safeParse({
      ...validInput,
      bankAccount: null,
      firstCustomer: null,
      firstSupplier: null
    });
    expect(result.success).toBe(true);
  });
});
