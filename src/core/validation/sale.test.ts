import { describe, expect, it } from "vitest";
import { toMinor } from "@/core/accounting/money";
import {
  deriveSale,
  saleFormSchema,
  saleStatusOf
} from "./sale";

const ACCOUNT_ID = "a0000000-0000-0000-0000-000000000001";
const CUSTOMER_ID = "c0000000-0000-0000-0000-000000000001";

function validInput(overrides: Partial<Record<string, string>> = {}) {
  return {
    customerId: "",
    occurredAt: "2026-01-15T10:00",
    description: "بيع",
    totalAmount: "150.00",
    discount: "",
    paymentMethod: "cash",
    accountId: ACCOUNT_ID,
    paidAmount: "150.00",
    notes: "",
    ...overrides
  };
}

describe("saleFormSchema", () => {
  it("يقبل بيعاً نقدياً كاملاً", () => {
    const result = saleFormSchema.safeParse(validInput());
    expect(result.success).toBe(true);
  });

  it("يقبل بيعاً آجلاً بعميل وبلا حساب/مدفوع", () => {
    const result = saleFormSchema.safeParse(
      validInput({
        customerId: CUSTOMER_ID,
        paymentMethod: "credit",
        accountId: "",
        paidAmount: ""
      })
    );
    expect(result.success).toBe(true);
  });

  it("يرفض آجلاً بعميل لكن مع مبلغ مدفوع", () => {
    const result = saleFormSchema.safeParse(
      validInput({
        customerId: CUSTOMER_ID,
        paymentMethod: "credit",
        accountId: "",
        paidAmount: "10.00"
      })
    );
    expect(result.success).toBe(false);
  });

  it("يرفض آجلاً بلا عميل", () => {
    const result = saleFormSchema.safeParse(
      validInput({ paymentMethod: "credit", accountId: "", paidAmount: "" })
    );
    expect(result.success).toBe(false);
  });

  it("يرفض paid > net", () => {
    const result = saleFormSchema.safeParse(
      validInput({ paidAmount: "200.00" })
    );
    expect(result.success).toBe(false);
  });

  it("يرفض الخصم الأكبر من الإجمالي", () => {
    const result = saleFormSchema.safeParse(
      validInput({ discount: "160.00" })
    );
    expect(result.success).toBe(false);
  });

  it("يرفض صافياً غير موجب", () => {
    const result = saleFormSchema.safeParse(
      validInput({ totalAmount: "100.00", discount: "100.00" })
    );
    expect(result.success).toBe(false);
  });

  it("يرفض نقدياً بلا حساب مستلم", () => {
    const result = saleFormSchema.safeParse(
      validInput({ accountId: "" })
    );
    expect(result.success).toBe(false);
  });

  it("يرفض نقدياً صفر مدفوع بلا عميل", () => {
    const result = saleFormSchema.safeParse(
      validInput({ paidAmount: "0.00" })
    );
    expect(result.success).toBe(false);
  });

  it("يرفض جزءاً آجلاً بلا عميل", () => {
    const result = saleFormSchema.safeParse(
      validInput({ paidAmount: "50.00", customerId: "" })
    );
    expect(result.success).toBe(false);
  });

  it("يرفض مبلغاً بأكثر من خانتين عشريتين", () => {
    const result = saleFormSchema.safeParse(
      validInput({ totalAmount: "10.999" })
    );
    expect(result.success).toBe(false);
  });

  it("يرفض طريقة دفع غير معروفة", () => {
    const result = saleFormSchema.safeParse(
      validInput({ paymentMethod: "check" })
    );
    expect(result.success).toBe(false);
  });
});

describe("deriveSale", () => {
  it("يحسب الصافي والمتبقي بوحدات صغرى صحيحة", () => {
    const parsed = saleFormSchema.parse(
      validInput({ discount: "10.00", paidAmount: "100.00", customerId: CUSTOMER_ID })
    );
    const derived = deriveSale(
      parsed,
      "00000000-0000-0000-0000-000000000099",
      { id: ACCOUNT_ID, type: "cash" }
    );
    expect(derived.netMinor).toBe(14000);
    expect(derived.paidMinor).toBe(10000);
    expect(derived.remainingMinor).toBe(4000);
    expect(derived.status).toBe("mixed");
    expect(derived.op.customerId).toBe(CUSTOMER_ID);
    expect(derived.op.account?.id).toBe(ACCOUNT_ID);
  });

  it("آجل: بلا حساب وبلا مدفوع", () => {
    const parsed = saleFormSchema.parse(
      validInput({
        customerId: CUSTOMER_ID,
        paymentMethod: "credit",
        accountId: "",
        paidAmount: ""
      })
    );
    const derived = deriveSale(parsed, "00000000-0000-0000-0000-000000000099");
    expect(derived.status).toBe("credit");
    expect(derived.op.account).toBeUndefined();
    expect(derived.op.paidAmount).toBe(0);
    expect(derived.remainingMinor).toBe(toMinor("150.00"));
  });
});

describe("saleStatusOf", () => {
  it("نقدي عند سداد كامل", () => {
    expect(saleStatusOf("cash", 10000, 10000)).toBe("cash");
  });

  it("مختلط عند سداد جزئي", () => {
    expect(saleStatusOf("palpay", 10000, 4000)).toBe("mixed");
  });

  it("آجل بطريقة credit", () => {
    expect(saleStatusOf("credit", 10000, 0)).toBe("credit");
  });
});
