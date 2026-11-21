import { describe, expect, it } from "vitest";
import { debtPaymentFormSchema, deriveDebtPayment } from "./debt-payment";

const DEBT_ID = "e0000000-0000-0000-0000-000000000001";
const ACCOUNT_ID = "a0000000-0000-0000-0000-000000000001";

function validInput(overrides: Partial<Record<string, string>> = {}) {
  return {
    debtId: DEBT_ID,
    amount: "50.00",
    occurredAt: "2026-01-20T12:00",
    paymentMethod: "cash",
    accountId: ACCOUNT_ID,
    notes: "",
    ...overrides
  };
}

describe("debtPaymentFormSchema", () => {
  it("يقبل دفعة جزئية صالحة", () => {
    expect(debtPaymentFormSchema.safeParse(validInput()).success).toBe(true);
  });

  it("يرفض طريقة دفع آجلة (credit)", () => {
    expect(
      debtPaymentFormSchema.safeParse(validInput({ paymentMethod: "credit" }))
        .success
    ).toBe(false);
  });

  it("يرفض صفراً ومبلغاً سالباً", () => {
    expect(
      debtPaymentFormSchema.safeParse(validInput({ amount: "0.00" })).success
    ).toBe(false);
    expect(
      debtPaymentFormSchema.safeParse(validInput({ amount: "-5.00" })).success
    ).toBe(false);
  });

  it("يرفض مبلغاً بصيغة غير صحيحة", () => {
    expect(
      debtPaymentFormSchema.safeParse(validInput({ amount: "خمسون" })).success
    ).toBe(false);
  });

  it("يرفض حساباً مفقوداً (الدفعة تحرك النقد دائماً)", () => {
    expect(
      debtPaymentFormSchema.safeParse(validInput({ accountId: "" })).success
    ).toBe(false);
  });

  it("يرفض تاريخاً فاسداً", () => {
    expect(
      debtPaymentFormSchema.safeParse(validInput({ occurredAt: "غير تاريخ" }))
        .success
    ).toBe(false);
  });

  it("يشتق المبلغ بوحدات صغرى", () => {
    const parsed = debtPaymentFormSchema.parse(validInput());
    expect(deriveDebtPayment(parsed).amountMinor).toBe(5000);
  });
});
