import { describe, expect, it } from "vitest";
import {
  buildAdjustmentEntry,
  buildDebtPaymentEntry,
  buildDepositEntry,
  buildExpenseEntry,
  buildOpeningEntry,
  buildPurchaseEntry,
  buildReversalEntry,
  buildSaleEntry,
  buildTransferEntry,
  buildWithdrawalEntry,
  validateDebtPaymentAmount,
  validateEntry,
  UnbalancedEntryError,
  BusinessRuleError
} from "./engine";
import { computeBalances, emptyBalanceState, applyEntry } from "./balance";
import { GL } from "./chart-of-accounts";
import { toMinor } from "./money";
import type { JournalEntry } from "./types";

const cashAccount = { id: "acc-cash", type: "cash" as const };
const bankAccount = { id: "acc-bank", type: "bank" as const };
const T = "2026-01-15T10:00:00.000Z";

describe("money", () => {
  it("يحوّل الأعداد العشرية إلى وحدات صغرى", () => {
    expect(toMinor("12.5")).toBe(1250);
    expect(toMinor("100")).toBe(10000);
    expect(toMinor("0.99")).toBe(99);
    expect(() => toMinor("12.345")).toThrow();
  });
});

describe("بيع نقدي", () => {
  it("ينشئ قيداً متوازناً يزيد الصندوق", () => {
    const result = buildSaleEntry({
      saleId: "s1",
      occurredAt: T,
      totalAmount: toMinor("100"),
      discount: 0,
      paymentMethod: "cash",
      account: cashAccount,
      paidAmount: toMinor("100")
    });
    expect(result.net).toBe(10000);
    expect(result.remaining).toBe(0);
    expect(result.entry.lines).toHaveLength(2);
    expect(() => validateEntry(result.entry)).not.toThrow();

    const balances = computeBalances([result.entry]);
    expect(balances.accountBalances["acc-cash"]).toBe(10000);
    expect(balances.glBalances[GL.SALES]).toBe(10000);
  });

  it("يعالج الخصم", () => {
    const result = buildSaleEntry({
      saleId: "s2",
      occurredAt: T,
      totalAmount: toMinor("100"),
      discount: toMinor("20"),
      paymentMethod: "cash",
      account: cashAccount,
      paidAmount: toMinor("80")
    });
    expect(result.net).toBe(8000);
    expect(result.remaining).toBe(0);
    expect(result.entry.lines).toHaveLength(2);
  });

  it("يرفض دفعاً أكبر من الصافي", () => {
    expect(() =>
      buildSaleEntry({
        saleId: "s3",
        occurredAt: T,
        totalAmount: toMinor("100"),
        discount: 0,
        paymentMethod: "cash",
        account: cashAccount,
        paidAmount: toMinor("150")
      })
    ).toThrow(BusinessRuleError);
  });
});

describe("بيع آجل ومختلط", () => {
  it("البيع الآجل ينشئ مديونية بلا حركة نقدية", () => {
    const result = buildSaleEntry({
      saleId: "s4",
      occurredAt: T,
      customerId: "c1",
      totalAmount: toMinor("500"),
      discount: 0,
      paymentMethod: "credit",
      paidAmount: 0
    });
    expect(result.remaining).toBe(50000);
    const balances = computeBalances([result.entry]);
    expect(balances.customerBalances["c1"]).toBe(50000);
    expect(Object.keys(balances.accountBalances)).toHaveLength(0);
  });

  it("يرفض بيعاً آجلاً مع حساب استلام", () => {
    expect(() =>
      buildSaleEntry({
        saleId: "s5",
        occurredAt: T,
        customerId: "c1",
        totalAmount: toMinor("100"),
        discount: 0,
        paymentMethod: "credit",
        account: cashAccount,
        paidAmount: 0
      })
    ).toThrow(BusinessRuleError);
  });

  it("يرفض بيعاً آجلاً بلا عميل", () => {
    expect(() =>
      buildSaleEntry({
        saleId: "s6",
        occurredAt: T,
        totalAmount: toMinor("100"),
        discount: 0,
        paymentMethod: "credit",
        paidAmount: 0
      })
    ).toThrow(BusinessRuleError);
  });

  it("البيع المختلط يقسم المبلغ بين الصندوق والعميل", () => {
    const result = buildSaleEntry({
      saleId: "s7",
      occurredAt: T,
      customerId: "c1",
      totalAmount: toMinor("500"),
      discount: 0,
      paymentMethod: "cash",
      account: cashAccount,
      paidAmount: toMinor("200")
    });
    expect(result.remaining).toBe(30000);
    const balances = computeBalances([result.entry]);
    expect(balances.accountBalances["acc-cash"]).toBe(20000);
    expect(balances.customerBalances["c1"]).toBe(30000);
  });
});

describe("المشتريات", () => {
  it("شراء نقدي مع مخزون يخصم الصندوق ويضاف للمخزون", () => {
    const result = buildPurchaseEntry({
      purchaseId: "p1",
      occurredAt: T,
      totalAmount: toMinor("50"),
      discount: 0,
      paymentMethod: "cash",
      account: cashAccount,
      paidAmount: toMinor("50"),
      inventoryEnabled: true
    });
    const balances = computeBalances([result.entry]);
    expect(balances.accountBalances["acc-cash"]).toBe(-5000);
    expect(balances.glBalances[GL.INVENTORY]).toBe(5000);
  });

  it("شراء آجل بلا مخزون يقيد على حساب الموردين", () => {
    const result = buildPurchaseEntry({
      purchaseId: "p2",
      occurredAt: T,
      supplierId: "sup1",
      totalAmount: toMinor("200"),
      discount: 0,
      paymentMethod: "credit",
      paidAmount: 0,
      inventoryEnabled: false
    });
    const balances = computeBalances([result.entry]);
    expect(balances.supplierBalances["sup1"]).toBe(20000);
    expect(balances.glBalances[GL.COGS]).toBe(20000);
    expect(Object.keys(balances.accountBalances)).toHaveLength(0);
  });

  it("شراء آجل يرفض مبلغاً مدفوعاً", () => {
    expect(() =>
      buildPurchaseEntry({
        purchaseId: "p3",
        occurredAt: T,
        supplierId: "sup1",
        totalAmount: toMinor("100"),
        discount: 0,
        paymentMethod: "credit",
        paidAmount: toMinor("10"),
        inventoryEnabled: false
      })
    ).toThrow(BusinessRuleError);
  });
});

describe("الديون والدفعات", () => {
  it("دفعات جزئية متتالية تصل إلى صفر", () => {
    const sale = buildSaleEntry({
      saleId: "s8",
      occurredAt: T,
      customerId: "c1",
      totalAmount: toMinor("500"),
      discount: 0,
      paymentMethod: "credit",
      paidAmount: 0
    });

    let state = computeBalances([sale.entry]);
    let remaining = sale.remaining;

    for (const amount of [100, 150, 250]) {
      validateDebtPaymentAmount(toMinor(String(amount)), remaining);
      const payment = buildDebtPaymentEntry({
        paymentId: "dp" + amount,
        debtId: "d1",
        direction: "receivable",
        partyId: "c1",
        occurredAt: T,
        amount: toMinor(String(amount)),
        account: cashAccount,
        paymentMethod: "cash"
      });
      state = applyEntry(state, payment.entry);
      remaining -= toMinor(String(amount));
    }

    expect(remaining).toBe(0);
    expect(state.customerBalances["c1"]).toBe(0);
    expect(state.accountBalances["acc-cash"]).toBe(50000);
  });

  it("يرفض دفعة تتجاوز المتبقي", () => {
    expect(() => validateDebtPaymentAmount(60000, 50000)).toThrow(
      BusinessRuleError
    );
  });

  it("سداد مورد يخصم البنك ويقلل الالتزام", () => {
    const payment = buildDebtPaymentEntry({
      paymentId: "dp-sup",
      debtId: "d2",
      direction: "payable",
      partyId: "sup1",
      occurredAt: T,
      amount: toMinor("100"),
      account: bankAccount,
      paymentMethod: "bank_transfer"
    });
    const balances = computeBalances([payment.entry]);
    expect(balances.accountBalances["acc-bank"]).toBe(-10000);
    expect(balances.supplierBalances["sup1"]).toBe(-10000);
  });
});

describe("التحويلات والأرصدة", () => {
  it("التحويل محايد: لا إيراد ولا مصروف", () => {
    const result = buildTransferEntry({
      transferId: "t1",
      occurredAt: T,
      fromAccount: cashAccount,
      toAccount: bankAccount,
      amount: toMinor("300")
    });
    const balances = computeBalances([result.entry]);
    expect(balances.accountBalances["acc-cash"]).toBe(-30000);
    expect(balances.accountBalances["acc-bank"]).toBe(30000);
    expect(
      result.entry.lines.every(
        (l) => l.glCode === GL.CASH || l.glCode === GL.BANKS
      )
    ).toBe(true);
  });

  it("يرفض التحويل إلى نفس الحساب", () => {
    expect(() =>
      buildTransferEntry({
        transferId: "t2",
        occurredAt: T,
        fromAccount: cashAccount,
        toAccount: cashAccount,
        amount: toMinor("10")
      })
    ).toThrow(BusinessRuleError);
  });

  it("الرصيد الافتتاحي يقيد على رأس المال", () => {
    const result = buildOpeningEntry({
      occurredAt: T,
      items: [
        { account: cashAccount, amount: toMinor("1000") },
        { account: bankAccount, amount: toMinor("500") }
      ]
    });
    expect(result.total).toBe(150000);
    const balances = computeBalances([result.entry]);
    expect(balances.accountBalances["acc-cash"]).toBe(100000);
    expect(balances.accountBalances["acc-bank"]).toBe(50000);
    expect(balances.glBalances[GL.CAPITAL]).toBe(150000);
  });

  it("يرفض سحباً أكبر من الرصيد", () => {
    expect(() =>
      buildWithdrawalEntry({
        withdrawalId: "w1",
        occurredAt: T,
        account: cashAccount,
        amount: toMinor("100"),
        currentBalance: toMinor("50")
      })
    ).toThrow(BusinessRuleError);
  });

  it("تسوية النقص تنشئ قيداً متوازناً", () => {
    const result = buildAdjustmentEntry({
      adjustmentId: "a1",
      occurredAt: T,
      account: cashAccount,
      countedBalance: toMinor("90"),
      currentBalance: toMinor("100")
    });
    expect(result.diff).toBe(-1000);
    expect(result.entry).not.toBeNull();
    expect(() => validateEntry(result.entry as JournalEntry)).not.toThrow();
  });

  it("تسوية بلا فرق لا تنشئ قيداً", () => {
    const result = buildAdjustmentEntry({
      adjustmentId: "a2",
      occurredAt: T,
      account: cashAccount,
      countedBalance: toMinor("100"),
      currentBalance: toMinor("100")
    });
    expect(result.entry).toBeNull();
    expect(result.diff).toBe(0);
  });
});

describe("حماية القيود", () => {
  it("يرفض قيداً غير متوازن", () => {
    const entry: JournalEntry = {
      occurredAt: T,
      description: "غير متوازن",
      sourceType: "sale",
      lines: [
        { glCode: GL.CASH, debit: 1000, credit: 0 },
        { glCode: GL.SALES, debit: 0, credit: 900 }
      ]
    };
    expect(() => validateEntry(entry)).toThrow(UnbalancedEntryError);
  });

  it("يرفض سطراً بقيم سالبة", () => {
    const entry: JournalEntry = {
      occurredAt: T,
      description: "سالب",
      sourceType: "sale",
      lines: [
        { glCode: GL.CASH, debit: -1000, credit: 0 },
        { glCode: GL.SALES, debit: 0, credit: -1000 }
      ]
    };
    expect(() => validateEntry(entry)).toThrow(UnbalancedEntryError);
  });

  it("يرفض سطراً مدين ودائن معاً", () => {
    const entry: JournalEntry = {
      occurredAt: T,
      description: "مختلط",
      sourceType: "sale",
      lines: [
        { glCode: GL.CASH, debit: 1000, credit: 1000 },
        { glCode: GL.SALES, debit: 0, credit: 0 }
      ]
    };
    expect(() => validateEntry(entry)).toThrow(UnbalancedEntryError);
  });

  it("القيد العكسي يلغي أثر القيد الأصلي", () => {
    const sale = buildSaleEntry({
      saleId: "s9",
      occurredAt: T,
      customerId: "c1",
      totalAmount: toMinor("300"),
      discount: 0,
      paymentMethod: "credit",
      paidAmount: 0
    });
    let state = computeBalances([sale.entry]);
    expect(state.customerBalances["c1"]).toBe(30000);

    sale.entry.id = "entry-1";
    const reversal = buildReversalEntry(sale.entry, {
      occurredAt: T,
      sourceId: "s9"
    });
    state = applyEntry(state, reversal.entry);
    expect(state.customerBalances["c1"]).toBe(0);
    expect(state.glBalances[GL.SALES]).toBe(0);
  });
});

describe("المصروفات والإيداع", () => {
  it("المصروف ببند معرف مسبقاً يعمل", () => {
    const result = buildExpenseEntry({
      expenseId: "e2",
      occurredAt: T,
      glCode: GL.COGS,
      amount: toMinor("75"),
      account: cashAccount,
      paymentMethod: "cash"
    });
    const balances = computeBalances([result.entry]);
    expect(balances.accountBalances["acc-cash"]).toBe(-7500);
    expect(balances.glBalances[GL.COGS]).toBe(7500);
  });

  it("يرفض مصروفاً على حساب غير مصروفات", () => {
    expect(() =>
      buildExpenseEntry({
        expenseId: "e3",
        occurredAt: T,
        glCode: GL.SALES,
        amount: toMinor("10"),
        account: cashAccount,
        paymentMethod: "cash"
      })
    ).toThrow(BusinessRuleError);
  });

  it("الإيداع يزيد الصندوق ويقيد على رأس المال", () => {
    const result = buildDepositEntry({
      depositId: "dep1",
      occurredAt: T,
      account: cashAccount,
      amount: toMinor("200")
    });
    const balances = computeBalances([result.entry]);
    expect(balances.accountBalances["acc-cash"]).toBe(20000);
    expect(balances.glBalances[GL.CAPITAL]).toBe(20000);
  });

  it("الحالة الفارغة تعطي أرصدة صفرية", () => {
    const state = emptyBalanceState();
    expect(state.glBalances).toEqual({});
  });
});
