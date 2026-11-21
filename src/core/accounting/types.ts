export type PaymentMethod =
  | "cash"
  | "bank_transfer"
  | "palpay"
  | "jawwal_pay"
  | "electronic"
  | "credit";

export type AccountType = "cash" | "bank" | "wallet" | "other";

export type GLAccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export type EntrySourceType =
  | "sale"
  | "purchase"
  | "expense"
  | "debt_payment"
  | "transfer"
  | "deposit"
  | "withdrawal"
  | "opening"
  | "adjustment"
  | "reversal";

export type PartyType = "customer" | "supplier";

export interface ChartAccount {
  code: string;
  name: string;
  type: GLAccountType;
  parentCode: string | null;
  isCash: boolean;
}

export interface FinancialAccountRef {
  id: string;
  type: AccountType;
}

export interface JournalLine {
  glCode: string;
  debit: number;
  credit: number;
  financialAccountId?: string;
  partyType?: PartyType;
  partyId?: string;
}

export interface JournalEntry {
  id?: string;
  occurredAt: string;
  description: string;
  sourceType: EntrySourceType;
  sourceId?: string;
  lines: JournalLine[];
  reversalOfEntryId?: string;
}

export interface SaleOperation {
  saleId: string;
  occurredAt: string;
  customerId?: string;
  totalAmount: number;
  discount: number;
  paymentMethod: PaymentMethod;
  account?: FinancialAccountRef;
  paidAmount: number;
}

export interface PurchaseOperation {
  purchaseId: string;
  occurredAt: string;
  supplierId?: string;
  totalAmount: number;
  discount: number;
  paymentMethod: PaymentMethod;
  account?: FinancialAccountRef;
  paidAmount: number;
  inventoryEnabled: boolean;
}

export type CashPaymentMethod = Exclude<PaymentMethod, "credit">;

export interface ExpenseOperation {
  expenseId: string;
  occurredAt: string;
  glCode: string;
  amount: number;
  account: FinancialAccountRef;
  paymentMethod: CashPaymentMethod;
}

export type DebtDirection = "receivable" | "payable";

export interface DebtPaymentOperation {
  paymentId: string;
  debtId: string;
  direction: DebtDirection;
  partyId: string;
  occurredAt: string;
  amount: number;
  account: FinancialAccountRef;
  paymentMethod: CashPaymentMethod;
}

export interface TransferOperation {
  transferId: string;
  occurredAt: string;
  fromAccount: FinancialAccountRef;
  toAccount: FinancialAccountRef;
  amount: number;
}

export interface DepositOperation {
  depositId: string;
  occurredAt: string;
  account: FinancialAccountRef;
  amount: number;
}

export interface WithdrawalOperation {
  withdrawalId: string;
  occurredAt: string;
  account: FinancialAccountRef;
  amount: number;
  currentBalance: number;
}

export interface OpeningBalanceItem {
  account: FinancialAccountRef;
  amount: number;
}

export interface OpeningBalanceOperation {
  occurredAt: string;
  items: OpeningBalanceItem[];
}

export interface AdjustmentOperation {
  adjustmentId: string;
  occurredAt: string;
  account: FinancialAccountRef;
  countedBalance: number;
  currentBalance: number;
}

export interface ManualDebtOperation {
  debtId: string;
  direction: DebtDirection;
  partyId: string;
  occurredAt: string;
  amount: number;
}
