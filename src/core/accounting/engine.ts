import { getGLAccount, GL } from "./chart-of-accounts";
import {
  assertIntegerAmount,
  assertNonNegative,
  assertPositive,
  InvalidAmountError,
  sumMinor,
  type Minor
} from "./money";
import type {
  AdjustmentOperation,
  DebtPaymentOperation,
  DepositOperation,
  ExpenseOperation,
  FinancialAccountRef,
  JournalEntry,
  JournalLine,
  ManualDebtOperation,
  OpeningBalanceOperation,
  PurchaseOperation,
  SaleOperation,
  TransferOperation,
  WithdrawalOperation
} from "./types";

export class UnbalancedEntryError extends Error {
  constructor(message = "القيد غير متوازن") {
    super(message);
    this.name = "UnbalancedEntryError";
  }
}

export class BusinessRuleError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "BusinessRuleError";
    this.code = code;
  }
}

export function validateEntry(entry: JournalEntry): void {
  if (entry.lines.length === 0) {
    throw new UnbalancedEntryError("القيد بلا سطور");
  }

  let totalDebit = 0;
  let totalCredit = 0;

  for (const line of entry.lines) {
    assertIntegerAmount(line.debit);
    assertIntegerAmount(line.credit);
    if (line.debit < 0 || line.credit < 0) {
      throw new UnbalancedEntryError("قيم سالبة في سطر القيد");
    }
    if (line.debit > 0 && line.credit > 0) {
      throw new UnbalancedEntryError("سطر القيد لا يحمل مدين ودائن معاً");
    }
    if (line.debit === 0 && line.credit === 0) {
      throw new UnbalancedEntryError("سطر قيد بقيمة صفر");
    }

    const gl = getGLAccount(line.glCode);
    if (line.financialAccountId && !(gl.code === GL.CASH || gl.code === GL.BANKS)) {
      throw new UnbalancedEntryError("ربط حساب مالي مسموح فقط لحسابات النقد والبنوك");
    }
    if (line.partyType && !line.partyId) {
      throw new UnbalancedEntryError("نوع الجهة بدون معرّف الجهة");
    }
    if (line.partyId && !line.partyType) {
      throw new UnbalancedEntryError("معرّف الجهة بدون نوع الجهة");
    }
    if (line.partyType === "customer" && gl.code !== GL.AR) {
      throw new UnbalancedEntryError("جهة العميل مسموحة فقط على حساب العملاء");
    }
    if (line.partyType === "supplier" && gl.code !== GL.AP) {
      throw new UnbalancedEntryError("جهة المورد مسموحة فقط على حساب الموردين");
    }

    totalDebit += line.debit;
    totalCredit += line.credit;
  }

  if (totalDebit !== totalCredit) {
    throw new UnbalancedEntryError(
      `مجموع المدين ${totalDebit} لا يساوي مجموع الدائن ${totalCredit}`
    );
  }
  if (totalDebit === 0) {
    throw new UnbalancedEntryError("قيد بقيمة صفر");
  }
}

function cashGLFor(account: FinancialAccountRef): string {
  return account.type === "cash" ? GL.CASH : GL.BANKS;
}

function amountArg(value: number): Minor {
  const minor = Math.round(value);
  assertIntegerAmount(minor);
  return minor;
}

function baseEntry(
  occurredAt: string,
  description: string,
  sourceType: JournalEntry["sourceType"],
  sourceId?: string
): JournalEntry {
  if (!Number.isFinite(Date.parse(occurredAt))) {
    throw new InvalidAmountError(`تاريخ غير صالح: ${occurredAt}`);
  }
  return { occurredAt, description, sourceType, sourceId, lines: [] };
}

export interface SaleResult {
  entry: JournalEntry;
  net: Minor;
  remaining: Minor;
}

export function buildSaleEntry(op: SaleOperation): SaleResult {
  const total = amountArg(op.totalAmount);
  const discount = amountArg(op.discount);
  const paid = amountArg(op.paidAmount);

  assertPositive(total);
  assertNonNegative(discount);
  if (discount > total) {
    throw new BusinessRuleError(
      "DISCOUNT_EXCEEDS_TOTAL",
      "الخصم أكبر من إجمالي المبلغ"
    );
  }

  const net = total - discount;
  if (net <= 0) {
    throw new BusinessRuleError(
      "NET_NOT_POSITIVE",
      "صافي المبيعات يجب أن يكون أكبر من صفر"
    );
  }
  assertNonNegative(paid);
  if (paid > net) {
    throw new BusinessRuleError("PAID_EXCEEDS_NET", "المبلغ المدفوع أكبر من الصافي");
  }

  const isCredit = op.paymentMethod === "credit";
  if (isCredit && (op.account || paid !== 0)) {
    throw new BusinessRuleError(
      "CREDIT_SALE_NO_CASH",
      "البيع الآجل لا يقبل حساب استلام أو مبلغاً مدفوعاً"
    );
  }

  const remaining = net - paid;
  const receiveAccount = isCredit ? undefined : op.account;
  if (paid > 0 && !receiveAccount) {
    throw new BusinessRuleError(
      "ACCOUNT_REQUIRED",
      "تحديد الحساب المستلم مطلوب عند وجود مبلغ مدفوع"
    );
  }

  const entry = baseEntry(op.occurredAt, "عملية بيع", "sale", op.saleId);

  entry.lines.push({ glCode: GL.SALES, debit: 0, credit: net });

  if (paid > 0 && receiveAccount) {
    entry.lines.push({
      glCode: cashGLFor(receiveAccount),
      debit: paid,
      credit: 0,
      financialAccountId: receiveAccount.id
    });
  }

  if (remaining > 0) {
    if (!op.customerId) {
      throw new BusinessRuleError(
        "CUSTOMER_REQUIRED",
        "البيع الآجل يتطلب تحديد العميل"
      );
    }
    entry.lines.push({
      glCode: GL.AR,
      debit: remaining,
      credit: 0,
      partyType: "customer",
      partyId: op.customerId
    });
  }

  validateEntry(entry);
  return { entry, net, remaining };
}

export interface PurchaseResult {
  entry: JournalEntry;
  net: Minor;
  remaining: Minor;
}

export function buildPurchaseEntry(op: PurchaseOperation): PurchaseResult {
  const total = amountArg(op.totalAmount);
  const discount = amountArg(op.discount);
  const paid = amountArg(op.paidAmount);

  assertPositive(total);
  assertNonNegative(discount);
  if (discount > total) {
    throw new BusinessRuleError(
      "DISCOUNT_EXCEEDS_TOTAL",
      "الخصم أكبر من إجمالي المبلغ"
    );
  }

  const net = total - discount;
  if (net <= 0) {
    throw new BusinessRuleError(
      "NET_NOT_POSITIVE",
      "صافي المشتريات يجب أن يكون أكبر من صفر"
    );
  }
  assertNonNegative(paid);
  if (paid > net) {
    throw new BusinessRuleError("PAID_EXCEEDS_NET", "المبلغ المدفوع أكبر من الصافي");
  }
  if (op.paymentMethod === "credit" && paid !== 0) {
    throw new BusinessRuleError(
      "CREDIT_PURCHASE_NO_CASH",
      "الشراء الآجل لا يقبل مبلغاً مدفوعاً"
    );
  }

  const remaining = net - paid;
  const payAccount = op.paymentMethod === "credit" ? undefined : op.account;
  if (paid > 0 && !payAccount) {
    throw new BusinessRuleError(
      "ACCOUNT_REQUIRED",
      "تحديد حساب الدفع مطلوب عند وجود مبلغ مدفوع"
    );
  }

  const chargeGL = op.inventoryEnabled ? GL.INVENTORY : GL.COGS;
  const entry = baseEntry(
    op.occurredAt,
    "فاتورة مشتريات",
    "purchase",
    op.purchaseId
  );

  entry.lines.push({ glCode: chargeGL, debit: net, credit: 0 });

  if (paid > 0 && payAccount) {
    entry.lines.push({
      glCode: cashGLFor(payAccount),
      debit: 0,
      credit: paid,
      financialAccountId: payAccount.id
    });
  }

  if (remaining > 0) {
    if (!op.supplierId) {
      throw new BusinessRuleError(
        "SUPPLIER_REQUIRED",
        "الشراء الآجل يتطلب تحديد المورد"
      );
    }
    entry.lines.push({
      glCode: GL.AP,
      debit: 0,
      credit: remaining,
      partyType: "supplier",
      partyId: op.supplierId
    });
  }

  validateEntry(entry);
  return { entry, net, remaining };
}

export interface ExpenseResult {
  entry: JournalEntry;
}

export function buildExpenseEntry(op: ExpenseOperation): ExpenseResult {
  const amount = amountArg(op.amount);
  assertPositive(amount);

  const gl = getGLAccount(op.glCode);
  if (gl.type !== "expense") {
    throw new BusinessRuleError("NOT_EXPENSE_GL", "الحساب المختار ليس حساب مصروفات");
  }

  const entry = baseEntry(op.occurredAt, `مصروف: ${gl.name}`, "expense", op.expenseId);
  entry.lines.push({ glCode: op.glCode, debit: amount, credit: 0 });
  entry.lines.push({
    glCode: cashGLFor(op.account),
    debit: 0,
    credit: amount,
    financialAccountId: op.account.id
  });

  validateEntry(entry);
  return { entry };
}

export interface DebtPaymentResult {
  entry: JournalEntry;
}

export function validateDebtPaymentAmount(
  amount: Minor,
  debtRemaining: Minor
): void {
  if (amount > debtRemaining) {
    throw new BusinessRuleError(
      "OVERPAYMENT",
      "الدفعة تتجاوز المبلغ المتبقي من الدين"
    );
  }
}

export function buildDebtPaymentEntry(op: DebtPaymentOperation): DebtPaymentResult {
  const amount = amountArg(op.amount);
  assertPositive(amount);

  const entry = baseEntry(
    op.occurredAt,
    op.direction === "receivable" ? "دفعة من عميل" : "سداد لمورد",
    "debt_payment",
    op.paymentId
  );

  if (op.direction === "receivable") {
    entry.lines.push({
      glCode: cashGLFor(op.account),
      debit: amount,
      credit: 0,
      financialAccountId: op.account.id
    });
    entry.lines.push({
      glCode: GL.AR,
      debit: 0,
      credit: amount,
      partyType: "customer",
      partyId: op.partyId
    });
  } else {
    entry.lines.push({
      glCode: GL.AP,
      debit: amount,
      credit: 0,
      partyType: "supplier",
      partyId: op.partyId
    });
    entry.lines.push({
      glCode: cashGLFor(op.account),
      debit: 0,
      credit: amount,
      financialAccountId: op.account.id
    });
  }

  validateEntry(entry);
  return { entry };
}

export interface TransferResult {
  entry: JournalEntry;
}

export function buildTransferEntry(op: TransferOperation): TransferResult {
  const amount = amountArg(op.amount);
  assertPositive(amount);

  if (op.fromAccount.id === op.toAccount.id) {
    throw new BusinessRuleError(
      "SAME_ACCOUNT_TRANSFER",
      "لا يمكن التحويل إلى نفس الحساب"
    );
  }

  const entry = baseEntry(op.occurredAt, "تحويل بين الحسابات", "transfer", op.transferId);
  entry.lines.push({
    glCode: cashGLFor(op.toAccount),
    debit: amount,
    credit: 0,
    financialAccountId: op.toAccount.id
  });
  entry.lines.push({
    glCode: cashGLFor(op.fromAccount),
    debit: 0,
    credit: amount,
    financialAccountId: op.fromAccount.id
  });

  validateEntry(entry);
  return { entry };
}

export interface DepositResult {
  entry: JournalEntry;
}

export function buildDepositEntry(op: DepositOperation): DepositResult {
  const amount = amountArg(op.amount);
  assertPositive(amount);

  const entry = baseEntry(op.occurredAt, "إيداع من رأس المال", "deposit", op.depositId);
  entry.lines.push({
    glCode: cashGLFor(op.account),
    debit: amount,
    credit: 0,
    financialAccountId: op.account.id
  });
  entry.lines.push({ glCode: GL.CAPITAL, debit: 0, credit: amount });

  validateEntry(entry);
  return { entry };
}

export interface WithdrawalResult {
  entry: JournalEntry;
}

export function buildWithdrawalEntry(op: WithdrawalOperation): WithdrawalResult {
  const amount = amountArg(op.amount);
  const current = amountArg(op.currentBalance);
  assertPositive(amount);

  if (amount > current) {
    throw new BusinessRuleError(
      "INSUFFICIENT_BALANCE",
      "الرصيد الحالي لا يكفي لعملية السحب"
    );
  }

  const entry = baseEntry(op.occurredAt, "سحب من رأس المال", "withdrawal", op.withdrawalId);
  entry.lines.push({ glCode: GL.CAPITAL, debit: amount, credit: 0 });
  entry.lines.push({
    glCode: cashGLFor(op.account),
    debit: 0,
    credit: amount,
    financialAccountId: op.account.id
  });

  validateEntry(entry);
  return { entry };
}

export interface OpeningBalanceResult {
  entry: JournalEntry;
  total: Minor;
}

export function buildOpeningEntry(op: OpeningBalanceOperation): OpeningBalanceResult {
  if (op.items.length === 0) {
    throw new BusinessRuleError("EMPTY_OPENING", "لا توجد أرصدة افتتاحية");
  }

  const amounts = op.items.map((item) => amountArg(item.amount));
  amounts.forEach(assertPositive);

  const entry = baseEntry(op.occurredAt, "أرصدة افتتاحية", "opening");
  for (const item of op.items) {
    entry.lines.push({
      glCode: cashGLFor(item.account),
      debit: amountArg(item.amount),
      credit: 0,
      financialAccountId: item.account.id
    });
  }
  const total = sumMinor(amounts);
  entry.lines.push({ glCode: GL.CAPITAL, debit: 0, credit: total });

  validateEntry(entry);
  return { entry, total };
}

export interface AdjustmentResult {
  entry: JournalEntry | null;
  diff: Minor;
}

export function buildAdjustmentEntry(op: AdjustmentOperation): AdjustmentResult {
  const counted = amountArg(op.countedBalance);
  const current = amountArg(op.currentBalance);
  assertNonNegative(counted);
  assertNonNegative(current);

  const diff = counted - current;
  if (diff === 0) {
    return { entry: null, diff: 0 };
  }

  const abs = Math.abs(diff);
  const entry = baseEntry(
    op.occurredAt,
    diff > 0
      ? "تسوية: زيادة على الرصيد الدفتري"
      : "تسوية: نقص عن الرصيد الدفتري",
    "adjustment",
    op.adjustmentId
  );

  if (diff > 0) {
    entry.lines.push({
      glCode: cashGLFor(op.account),
      debit: abs,
      credit: 0,
      financialAccountId: op.account.id
    });
    entry.lines.push({ glCode: GL.RECONCILE_DIFF, debit: 0, credit: abs });
  } else {
    entry.lines.push({ glCode: GL.RECONCILE_DIFF, debit: abs, credit: 0 });
    entry.lines.push({
      glCode: cashGLFor(op.account),
      debit: 0,
      credit: abs,
      financialAccountId: op.account.id
    });
  }

  validateEntry(entry);
  return { entry, diff };
}

export interface ReversalResult {
  entry: JournalEntry;
}

export function buildManualDebtEntry(op: ManualDebtOperation): ReversalResult {
  const amount = amountArg(op.amount);
  assertPositive(amount);

  const isReceivable = op.direction === "receivable";
  const entry = baseEntry(
    op.occurredAt,
    isReceivable ? "دين يدوي — عميل" : "دين يدوي — مورد",
    "opening",
    op.debtId
  );

  if (isReceivable) {
    entry.lines.push({
      glCode: GL.AR,
      debit: amount,
      credit: 0,
      partyType: "customer",
      partyId: op.partyId
    });
    entry.lines.push({ glCode: GL.CAPITAL, debit: 0, credit: amount });
  } else {
    entry.lines.push({ glCode: GL.CAPITAL, debit: amount, credit: 0 });
    entry.lines.push({
      glCode: GL.AP,
      debit: 0,
      credit: amount,
      partyType: "supplier",
      partyId: op.partyId
    });
  }

  validateEntry(entry);
  return { entry };
}

export function buildReversalEntry(
  original: JournalEntry,
  meta: { occurredAt: string; sourceId?: string }
): ReversalResult {
  const flipped: JournalLine[] = original.lines.map((line) => ({
    glCode: line.glCode,
    debit: line.credit,
    credit: line.debit,
    financialAccountId: line.financialAccountId,
    partyType: line.partyType,
    partyId: line.partyId
  }));

  const entry: JournalEntry = {
    occurredAt: meta.occurredAt,
    description: `قيد عكسي: ${original.description}`,
    sourceType: "reversal",
    sourceId: meta.sourceId ?? original.sourceId,
    lines: flipped,
    reversalOfEntryId: original.id
  };

  validateEntry(entry);
  return { entry };
}
