import { toMinor } from "@/core/accounting/money";
import type {
  LocalDebt,
  LocalDebtPayment,
  LocalExpense,
  LocalExpenseCategory,
  LocalFinancialAccount,
  LocalJournalEntry,
  LocalJournalEntryLine,
  LocalParty,
  LocalPurchase,
  LocalSale,
  SyncStatus
} from "@/core/db/db";

type Row = Record<string, unknown>;

export interface ServerRowMeta {
  id: string;
  businessId: string;
  updatedAt: string;
  version: number;
  deletedAt: string | null;
}

function str(row: Row, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function nullableStr(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function money(row: Row, key: string): number {
  const value = row[key];
  if (typeof value === "number") return Math.round(value * 100);
  try {
    return toMinor(String(value ?? "0"));
  } catch {
    return 0;
  }
}

function iso(row: Row, key: string): string {
  const value = row[key];
  return typeof value === "string" ? new Date(value).toISOString() : new Date().toISOString();
}

function nullableIso(row: Row, key: string): string | null {
  const value = row[key];
  if (typeof value !== "string") return null;
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

function meta(row: Row): ServerRowMeta {
  return {
    id: str(row, "id"),
    businessId: str(row, "business_id"),
    updatedAt: iso(row, "updated_at"),
    version: typeof row.version === "number" ? row.version : 1,
    deletedAt: nullableIso(row, "deleted_at")
  };
}

function baseParty(row: Row, serverMeta: ServerRowMeta): LocalParty {
  return {
    id: serverMeta.id,
    businessId: serverMeta.businessId,
    name: str(row, "name"),
    phone: str(row, "phone"),
    address: str(row, "address"),
    notes: str(row, "notes"),
    currentBalanceMinor: money(row, "current_balance"),
    totalTransactionsMinor: money(row, "total_transactions"),
    lastTransactionAt: nullableIso(row, "last_transaction_at"),
    updatedAt: serverMeta.updatedAt,
    syncStatus: "synced" as SyncStatus,
    version: serverMeta.version,
    deletedAt: serverMeta.deletedAt
  };
}

export function mapCustomerRow(row: Row): LocalParty | null {
  const serverMeta = meta(row);
  if (!serverMeta.id) return null;
  return baseParty(row, serverMeta);
}

export function mapSupplierRow(row: Row): LocalParty | null {
  const serverMeta = meta(row);
  if (!serverMeta.id) return null;
  return baseParty(row, serverMeta);
}

export function mapFinancialAccountRow(row: Row): LocalFinancialAccount | null {
  const serverMeta = meta(row);
  if (!serverMeta.id) return null;
  return {
    id: serverMeta.id,
    businessId: serverMeta.businessId,
    name: str(row, "name"),
    type: (str(row, "type") as LocalFinancialAccount["type"]) ?? "cash",
    provider: nullableStr(row, "provider"),
    currency: str(row, "currency") || "ILS",
    openingBalanceMinor: money(row, "opening_balance"),
    currentBalanceMinor: money(row, "current_balance"),
    totalDepositsMinor: money(row, "total_deposits"),
    totalWithdrawalsMinor: money(row, "total_withdrawals"),
    isActive: row.is_active === undefined ? true : Boolean(row.is_active),
    updatedAt: serverMeta.updatedAt,
    syncStatus: "synced" as SyncStatus,
    version: serverMeta.version,
    deletedAt: serverMeta.deletedAt
  };
}

export function mapExpenseCategoryRow(row: Row): LocalExpenseCategory | null {
  const serverMeta = meta(row);
  if (!serverMeta.id) return null;
  return {
    id: serverMeta.id,
    businessId: serverMeta.businessId,
    name: str(row, "name"),
    glCode: str(row, "gl_code"),
    isSystem: row.is_system === undefined ? true : Boolean(row.is_system),
    sortOrder: typeof row.sort_order === "number" ? row.sort_order : 0
  };
}

export function mapSaleRow(row: Row): LocalSale | null {
  const serverMeta = meta(row);
  if (!serverMeta.id) return null;
  const paymentMethod = str(row, "payment_method");
  return {
    id: serverMeta.id,
    businessId: serverMeta.businessId,
    saleNumber: str(row, "sale_number"),
    customerId: nullableStr(row, "customer_id"),
    occurredAt: iso(row, "occurred_at"),
    description: str(row, "description"),
    totalAmountMinor: money(row, "total_amount"),
    discountMinor: money(row, "discount"),
    netAmountMinor: money(row, "net_amount"),
    paymentMethod: (paymentMethod || "cash") as LocalSale["paymentMethod"],
    accountId: nullableStr(row, "account_id"),
    paidAmountMinor: money(row, "paid_amount"),
    remainingAmountMinor: money(row, "remaining_amount"),
    debtId: nullableStr(row, "debt_id"),
    status: str(row, "status") === "void" ? "void" : "posted",
    notes: str(row, "notes"),
    createdBy: str(row, "created_by"),
    postedAt: nullableIso(row, "posted_at"),
    updatedAt: serverMeta.updatedAt,
    syncStatus: "synced" as SyncStatus,
    version: serverMeta.version,
    deletedAt: serverMeta.deletedAt
  };
}

export function mapPurchaseRow(row: Row): LocalPurchase | null {
  const serverMeta = meta(row);
  if (!serverMeta.id) return null;
  const paymentMethod = str(row, "payment_method");
  return {
    id: serverMeta.id,
    businessId: serverMeta.businessId,
    purchaseNumber: str(row, "purchase_number"),
    supplierId: nullableStr(row, "supplier_id"),
    occurredAt: iso(row, "occurred_at"),
    description: str(row, "description"),
    totalAmountMinor: money(row, "total_amount"),
    discountMinor: money(row, "discount"),
    netAmountMinor: money(row, "net_amount"),
    paymentMethod: (paymentMethod || "cash") as LocalPurchase["paymentMethod"],
    accountId: nullableStr(row, "account_id"),
    paidAmountMinor: money(row, "paid_amount"),
    remainingAmountMinor: money(row, "remaining_amount"),
    transferReference: str(row, "transfer_reference"),
    receiptAttachmentId: nullableStr(row, "receipt_attachment_id"),
    debtId: nullableStr(row, "debt_id"),
    status: str(row, "status") === "void" ? "void" : "posted",
    notes: str(row, "notes"),
    createdBy: str(row, "created_by"),
    postedAt: nullableIso(row, "posted_at"),
    updatedAt: serverMeta.updatedAt,
    syncStatus: "synced" as SyncStatus,
    version: serverMeta.version,
    deletedAt: serverMeta.deletedAt
  };
}

export function mapExpenseRow(row: Row, glCodeByCategory: Map<string, string>): LocalExpense | null {
  const serverMeta = meta(row);
  if (!serverMeta.id) return null;
  const categoryId = str(row, "category_id");
  const paymentMethod = str(row, "payment_method");
  return {
    id: serverMeta.id,
    businessId: serverMeta.businessId,
    title: str(row, "title"),
    categoryId,
    glCode: glCodeByCategory.get(categoryId) ?? "5190",
    amountMinor: money(row, "amount"),
    occurredAt: iso(row, "occurred_at"),
    paymentMethod: (paymentMethod || "cash") as LocalExpense["paymentMethod"],
    accountId: str(row, "account_id"),
    receiptPath: nullableStr(row, "receipt_attachment_id"),
    notes: str(row, "notes"),
    status: str(row, "status") === "void" ? "void" : "posted",
    createdBy: str(row, "created_by"),
    postedAt: nullableIso(row, "posted_at"),
    updatedAt: serverMeta.updatedAt,
    syncStatus: "synced" as SyncStatus,
    version: serverMeta.version,
    deletedAt: serverMeta.deletedAt
  };
}

export function mapDebtRow(row: Row): LocalDebt | null {
  const serverMeta = meta(row);
  if (!serverMeta.id) return null;
  const direction = str(row, "direction");
  return {
    id: serverMeta.id,
    businessId: serverMeta.businessId,
    direction: direction === "payable" ? "payable" : "receivable",
    partyId: direction === "payable" ? str(row, "supplier_id") : str(row, "customer_id"),
    sourceType: (str(row, "source_type") || "manual") as LocalDebt["sourceType"],
    sourceId: nullableStr(row, "source_id"),
    amountMinor: money(row, "amount"),
    paidAmountMinor: money(row, "paid_amount"),
    remainingAmountMinor: money(row, "remaining_amount"),
    dueDate: nullableStr(row, "due_date"),
    status: (str(row, "status") || "open") as LocalDebt["status"],
    notes: str(row, "notes"),
    createdAt: iso(row, "created_at"),
    updatedAt: serverMeta.updatedAt,
    syncStatus: "synced" as SyncStatus,
    version: serverMeta.version,
    deletedAt: serverMeta.deletedAt
  };
}

export function mapDebtPaymentRow(row: Row): LocalDebtPayment | null {
  const serverMeta = meta(row);
  if (!serverMeta.id) return null;
  const paymentMethod = str(row, "payment_method");
  return {
    id: serverMeta.id,
    businessId: serverMeta.businessId,
    debtId: str(row, "debt_id"),
    amountMinor: money(row, "amount"),
    occurredAt: iso(row, "occurred_at"),
    accountId: str(row, "account_id"),
    paymentMethod: (paymentMethod || "cash") as LocalDebtPayment["paymentMethod"],
    journalEntryId: nullableStr(row, "journal_entry_id"),
    notes: str(row, "notes"),
    createdBy: str(row, "created_by"),
    updatedAt: serverMeta.updatedAt,
    syncStatus: "synced" as SyncStatus,
    version: serverMeta.version,
    deletedAt: serverMeta.deletedAt
  };
}

export function mapJournalEntryRow(row: Row): LocalJournalEntry | null {
  const serverMeta = meta(row);
  if (!serverMeta.id) return null;
  return {
    id: serverMeta.id,
    businessId: serverMeta.businessId,
    entryNumber: str(row, "entry_number"),
    occurredAt: iso(row, "occurred_at"),
    description: str(row, "description"),
    sourceType: (str(row, "source_type") || "opening") as LocalJournalEntry["sourceType"],
    sourceId: nullableStr(row, "source_id"),
    status: "posted",
    reversalOfEntryId: nullableStr(row, "reversal_of_entry_id"),
    updatedAt: serverMeta.updatedAt,
    syncStatus: "synced" as SyncStatus,
    version: serverMeta.version,
    deletedAt: serverMeta.deletedAt
  };
}

export function mapJournalEntryLineRow(row: Row): LocalJournalEntryLine | null {
  const serverMeta = meta(row);
  if (!serverMeta.id) return null;
  const partyType = nullableStr(row, "party_type");
  return {
    id: serverMeta.id,
    businessId: serverMeta.businessId,
    entryId: str(row, "entry_id"),
    glCode: str(row, "gl_account_code"),
    debitMinor: money(row, "debit"),
    creditMinor: money(row, "credit"),
    financialAccountId: nullableStr(row, "financial_account_id"),
    partyType: partyType === "customer" || partyType === "supplier" ? partyType : null,
    partyId: nullableStr(row, "party_id")
  };
}
