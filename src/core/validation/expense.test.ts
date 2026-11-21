import { describe, expect, it } from "vitest";
import { deriveExpense, expenseFormSchema } from "./expense";

const CATEGORY_ID = "c1000000-0000-0000-0000-000000000001";
const ACCOUNT_ID = "a0000000-0000-0000-0000-000000000001";

function validInput(overrides: Partial<Record<string, string>> = {}) {
  return {
    title: "فاتورة كهرباء",
    categoryId: CATEGORY_ID,
    amount: "85.50",
    occurredAt: "2026-01-05T14:00",
    paymentMethod: "cash",
    accountId: ACCOUNT_ID,
    notes: "",
    ...overrides
  };
}

describe("expenseFormSchema", () => {
  it("يقبل مصروفاً صالحاً", () => {
    expect(expenseFormSchema.safeParse(validInput()).success).toBe(true);
  });

  it("يرفض عنواناً قصيراً", () => {
    expect(expenseFormSchema.safeParse(validInput({ title: "ف" })).success).toBe(
      false
    );
  });

  it("يرفض صفراً وسالباً", () => {
    expect(
      expenseFormSchema.safeParse(validInput({ amount: "0.00" })).success
    ).toBe(false);
    expect(
      expenseFormSchema.safeParse(validInput({ amount: "-10.00" })).success
    ).toBe(false);
  });

  it("يرفض طريقة دفع آجلة (لا credit في المصروف v1)", () => {
    expect(
      expenseFormSchema.safeParse(validInput({ paymentMethod: "credit" }))
        .success
    ).toBe(false);
  });

  it("يرفض حساب دفع مفقوداً", () => {
    expect(
      expenseFormSchema.safeParse(validInput({ accountId: "" })).success
    ).toBe(false);
  });

  it("يرفض تصنيفاً مفقوداً", () => {
    expect(
      expenseFormSchema.safeParse(validInput({ categoryId: "" })).success
    ).toBe(false);
  });

  it("يرفض تصنيفاً بمعرّف فاسد", () => {
    expect(
      expenseFormSchema.safeParse(validInput({ categoryId: "abc" })).success
    ).toBe(false);
  });

  it("يرفض تاريخاً فاسداً", () => {
    expect(
      expenseFormSchema.safeParse(validInput({ occurredAt: "أمس" })).success
    ).toBe(false);
  });

  it("يشتق المبلغ بوحدات صغرى وطريقة دفع نقدية", () => {
    const parsed = expenseFormSchema.parse(validInput());
    const derived = deriveExpense(parsed);
    expect(derived.amountMinor).toBe(8550);
    expect(derived.paymentMethod).toBe("cash");
  });
});
