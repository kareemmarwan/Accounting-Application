import { describe, expect, it } from "vitest";
import {
  derivePurchase,
  purchaseFormSchema
} from "./purchase";

const ACCOUNT_ID = "a0000000-0000-0000-0000-000000000001";
const SUPPLIER_ID = "d0000000-0000-0000-0000-000000000001";

function validInput(overrides: Partial<Record<string, string>> = {}) {
  return {
    supplierId: "",
    occurredAt: "2026-01-15T10:00",
    description: "شراء",
    totalAmount: "300.00",
    discount: "",
    paymentMethod: "cash",
    accountId: ACCOUNT_ID,
    paidAmount: "300.00",
    transferReference: "",
    notes: "",
    ...overrides
  };
}

describe("purchaseFormSchema", () => {
  it("يقبل شراء نقدياً كاملاً", () => {
    expect(purchaseFormSchema.safeParse(validInput()).success).toBe(true);
  });

  it("يقبل شراء آجلاً بمورد وبلا حساب/مدفوع", () => {
    const result = purchaseFormSchema.safeParse(
      validInput({
        supplierId: SUPPLIER_ID,
        paymentMethod: "credit",
        accountId: "",
        paidAmount: ""
      })
    );
    expect(result.success).toBe(true);
  });

  it("يرفض آجلاً مع حساب دفع (الآجل لا يخصم حساباً)", () => {
    const result = purchaseFormSchema.safeParse(
      validInput({
        supplierId: SUPPLIER_ID,
        paymentMethod: "credit",
        paidAmount: ""
      })
    );
    expect(result.success).toBe(false);
  });

  it("يرفض آجلاً مع مبلغ مدفوع", () => {
    const result = purchaseFormSchema.safeParse(
      validInput({
        supplierId: SUPPLIER_ID,
        paymentMethod: "credit",
        accountId: "",
        paidAmount: "10.00"
      })
    );
    expect(result.success).toBe(false);
  });

  it("يرفض آجلاً بلا مورد", () => {
    const result = purchaseFormSchema.safeParse(
      validInput({ paymentMethod: "credit", accountId: "", paidAmount: "" })
    );
    expect(result.success).toBe(false);
  });

  it("يرفض paid > net", () => {
    expect(
      purchaseFormSchema.safeParse(validInput({ paidAmount: "400.00" })).success
    ).toBe(false);
  });

  it("يرفض الخصم الأكبر من الإجمالي", () => {
    expect(
      purchaseFormSchema.safeParse(validInput({ discount: "350.00" })).success
    ).toBe(false);
  });

  it("يرفض نقدياً بلا حساب دفع", () => {
    expect(
      purchaseFormSchema.safeParse(validInput({ accountId: "" })).success
    ).toBe(false);
  });

  it("يرفض نقدياً صفر مدفوع بلا مورد", () => {
    expect(
      purchaseFormSchema.safeParse(validInput({ paidAmount: "0.00" })).success
    ).toBe(false);
  });

  it("يرفض جزءاً آجلاً بلا مورد", () => {
    expect(
      purchaseFormSchema.safeParse(
        validInput({ paidAmount: "100.00", supplierId: "" })
      ).success
    ).toBe(false);
  });

  it("يرفض مبلغاً بصيغة غير صحيحة", () => {
    expect(
      purchaseFormSchema.safeParse(validInput({ totalAmount: "abc" })).success
    ).toBe(false);
  });

  it("يرفض طريقة دفع غير معروفة", () => {
    expect(
      purchaseFormSchema.safeParse(validInput({ paymentMethod: "gift" }))
        .success
    ).toBe(false);
  });
});

describe("derivePurchase", () => {
  it("يحسب المبالغ بوضوح المخزون المعطل (COGS 5900)", () => {
    const parsed = purchaseFormSchema.parse(
      validInput({ discount: "20.00", paidAmount: "140.00", supplierId: SUPPLIER_ID })
    );
    const derived = derivePurchase(
      parsed,
      "00000000-0000-0000-0000-000000000099",
      { id: ACCOUNT_ID, type: "cash" }
    );
    expect(derived.netMinor).toBe(28000);
    expect(derived.paidMinor).toBe(14000);
    expect(derived.remainingMinor).toBe(14000);
    expect(derived.status).toBe("mixed");
    expect(derived.op.inventoryEnabled).toBe(false);
    expect(derived.op.supplierId).toBe(SUPPLIER_ID);
  });

  it("آجل: بلا حساب مالي إطلاقاً", () => {
    const parsed = purchaseFormSchema.parse(
      validInput({
        supplierId: SUPPLIER_ID,
        paymentMethod: "credit",
        accountId: "",
        paidAmount: ""
      })
    );
    const derived = derivePurchase(parsed, "00000000-0000-0000-0000-000000000099");
    expect(derived.status).toBe("credit");
    expect(derived.op.account).toBeUndefined();
    expect(derived.op.paidAmount).toBe(0);
  });
});
