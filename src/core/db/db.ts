import Dexie, { type EntityTable } from "dexie";
import type {
  AccountType,
  EntrySourceType,
  PaymentMethod,
  PartyType
} from "@/core/accounting/types";

export type SyncStatus = "pending" | "syncing" | "synced" | "failed" | "conflict";

export interface SyncFields {
  businessId: string;
  updatedAt: string;
  syncStatus: SyncStatus;
  version: number;
  deletedAt: string | null;
}

export interface LocalFinancialAccount extends SyncFields {
  id: string;
  name: string;
  type: AccountType;
  provider: string | null;
  currency: string;
  openingBalanceMinor: number;
  currentBalanceMinor: number;
  totalDepositsMinor: number;
  totalWithdrawalsMinor: number;
  isActive: boolean;
}

export interface LocalParty extends SyncFields {
  id: string;
  name: string;
  phone: string;
  address: string;
  notes: string;
  currentBalanceMinor: number;
  totalTransactionsMinor: number;
  lastTransactionAt: string | null;
}

export interface LocalSale extends SyncFields {
  id: string;
  saleNumber: string;
  customerId: string | null;
  occurredAt: string;
  description: string;
  totalAmountMinor: number;
  discountMinor: number;
  netAmountMinor: number;
  paymentMethod: PaymentMethod;
  accountId: string | null;
  paidAmountMinor: number;
  remainingAmountMinor: number;
  debtId: string | null;
  status: "posted" | "void";
  notes: string;
  createdBy: string;
  postedAt: string | null;
}

export interface LocalPurchase extends SyncFields {
  id: string;
  purchaseNumber: string;
  supplierId: string | null;
  occurredAt: string;
  description: string;
  totalAmountMinor: number;
  discountMinor: number;
  netAmountMinor: number;
  paymentMethod: PaymentMethod;
  accountId: string | null;
  paidAmountMinor: number;
  remainingAmountMinor: number;
  transferReference: string;
  receiptAttachmentId: string | null;
  debtId: string | null;
  status: "posted" | "void";
  notes: string;
  createdBy: string;
  postedAt: string | null;
}

export interface LocalPurchaseItem {
  id: string;
  businessId: string;
  purchaseId: string;
  productId: string | null;
  name: string;
  quantityMilli: number;
  unitPriceMinor: number;
  totalMinor: number;
}

export interface LocalExpense extends SyncFields {
  id: string;
  title: string;
  categoryId: string;
  glCode: string;
  amountMinor: number;
  occurredAt: string;
  paymentMethod: PaymentMethod;
  accountId: string;
  receiptPath: string | null;
  notes: string;
  status: "posted" | "void";
  createdBy: string;
  postedAt: string | null;
}

export interface LocalExpenseCategory {
  id: string;
  businessId: string;
  name: string;
  glCode: string;
  isSystem: boolean;
  sortOrder: number;
}

export interface LocalDebt extends SyncFields {
  id: string;
  direction: "receivable" | "payable";
  partyId: string;
  sourceType: "sale" | "purchase" | "manual";
  sourceId: string | null;
  amountMinor: number;
  paidAmountMinor: number;
  remainingAmountMinor: number;
  dueDate: string | null;
  status: "open" | "partial" | "settled";
  notes: string;
  createdAt: string;
}

export interface LocalDebtPayment extends SyncFields {
  id: string;
  debtId: string;
  amountMinor: number;
  occurredAt: string;
  accountId: string;
  paymentMethod: PaymentMethod;
  journalEntryId: string | null;
  notes: string;
  createdBy: string;
}

export interface LocalJournalEntry extends SyncFields {
  id: string;
  entryNumber: string;
  occurredAt: string;
  description: string;
  sourceType: EntrySourceType;
  sourceId: string | null;
  status: "posted";
  reversalOfEntryId: string | null;
}

export interface LocalJournalEntryLine {
  id: string;
  businessId: string;
  entryId: string;
  glCode: string;
  debitMinor: number;
  creditMinor: number;
  financialAccountId: string | null;
  partyType: PartyType | null;
  partyId: string | null;
}

export interface LocalAttachmentMeta extends SyncFields {
  id: string;
  bucket: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  entityType: string;
  entityId: string;
}

export type OutboxOpType =
  | "sale.create"
  | "purchase.create"
  | "expense.create"
  | "debt_payment.create"
  | "manual_debt.create"
  | "transfer.create"
  | "deposit.create"
  | "withdrawal.create"
  | "opening.create"
  | "adjustment.create"
  | "entity.upsert"
  | "entity.soft_delete";

export interface OutboxItem {
  id: string;
  businessId: string;
  opType: OutboxOpType;
  entityType: string;
  entityId: string;
  payload: unknown;
  createdAt: string;
  attempts: number;
  status: "pending" | "syncing" | "failed";
  lastError: string | null;
  dependsOn: string[];
}

export interface SyncMetaRecord {
  deviceId: string;
  businessId: string;
  lastPulledAt: string | null;
  watermarks: Record<string, string>;
}

export interface LocalAttachmentBlob {
  id: string;
  blob: Blob;
}

export interface LocalNotification {
  id: string;
  businessId: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}

export interface LocalBusiness {
  id: string;
  name: string;
  businessType: string;
  ownerId: string;
  currency: string;
  phone: string | null;
  plan: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export class MusaedDB extends Dexie {
  businesses!: EntityTable<LocalBusiness, "id">;
  financialAccounts!: EntityTable<LocalFinancialAccount, "id">;
  customers!: EntityTable<LocalParty, "id">;
  suppliers!: EntityTable<LocalParty, "id">;
  sales!: EntityTable<LocalSale, "id">;
  purchases!: EntityTable<LocalPurchase, "id">;
  purchaseItems!: EntityTable<LocalPurchaseItem, "id">;
  expenses!: EntityTable<LocalExpense, "id">;
  expenseCategories!: EntityTable<LocalExpenseCategory, "id">;
  debts!: EntityTable<LocalDebt, "id">;
  debtPayments!: EntityTable<LocalDebtPayment, "id">;
  journalEntries!: EntityTable<LocalJournalEntry, "id">;
  journalEntryLines!: EntityTable<LocalJournalEntryLine, "id">;
  attachmentsMeta!: EntityTable<LocalAttachmentMeta, "id">;
  attachmentBlobs!: EntityTable<LocalAttachmentBlob, "id">;
  outbox!: EntityTable<OutboxItem, "id">;
  syncMeta!: EntityTable<SyncMetaRecord, "deviceId">;
  notifications!: EntityTable<LocalNotification, "id">;

  constructor() {
    super("musaed-mali");
    this.version(1).stores({
      financialAccounts: "id, businessId, syncStatus, updatedAt, type",
      customers: "id, businessId, syncStatus, updatedAt, name",
      suppliers: "id, businessId, syncStatus, updatedAt, name",
      sales: "id, businessId, syncStatus, updatedAt, occurredAt, customerId, debtId",
      purchases: "id, businessId, syncStatus, updatedAt, occurredAt, supplierId, debtId",
      purchaseItems: "id, businessId, purchaseId",
      expenses: "id, businessId, syncStatus, updatedAt, occurredAt, categoryId",
      expenseCategories: "id, businessId, name",
      debts: "id, businessId, syncStatus, updatedAt, direction, status, partyId, dueDate",
      debtPayments: "id, businessId, syncStatus, updatedAt, debtId, occurredAt",
      journalEntries: "id, businessId, syncStatus, updatedAt, occurredAt, sourceType, sourceId",
      journalEntryLines: "id, businessId, entryId, financialAccountId, glCode",
      attachmentsMeta: "id, businessId, syncStatus, entityType, entityId",
      outbox: "id, businessId, status, createdAt",
      syncMeta: "deviceId",
      notifications: "id, businessId, createdAt, readAt"
    });
    this.version(2).stores({
      businesses: "id, ownerId"
    });
    this.version(3).stores({
      attachmentBlobs: "id"
    });
  }
}

let instance: MusaedDB | null = null;

export function getDB(): MusaedDB {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB غير متاح — Dexie يعمل في المتصفح فقط");
  }
  if (!instance) {
    instance = new MusaedDB();
  }
  return instance;
}

export type { EntityTable };
