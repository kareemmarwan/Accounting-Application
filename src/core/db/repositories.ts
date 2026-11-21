import type {
  LocalDebt,
  LocalDebtPayment,
  LocalExpense,
  LocalFinancialAccount,
  LocalJournalEntry,
  LocalJournalEntryLine,
  LocalParty,
  LocalPurchase,
  LocalSale,
  OutboxItem,
  OutboxOpType,
  SyncFields,
  SyncStatus
} from "./db";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  throw new Error("crypto.randomUUID غير متاح في هذه البيئة");
}

export function isValidId(id: string): boolean {
  return UUID_RE.test(id);
}

export function tempDocNumber(): string {
  const bytes = new Uint8Array(4);
  if (typeof crypto === "undefined") {
    throw new Error("crypto غير متاح");
  }
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `L-${hex}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export interface NewSyncFields {
  businessId: string;
}

export function makeSyncFields({ businessId }: NewSyncFields): SyncFields {
  return {
    businessId,
    updatedAt: nowIso(),
    syncStatus: "pending",
    version: 1,
    deletedAt: null
  };
}

export type OutboxEntity =
  | LocalSale
  | LocalPurchase
  | LocalExpense
  | LocalDebt
  | LocalDebtPayment
  | LocalFinancialAccount
  | LocalParty
  | LocalJournalEntry
  | LocalJournalEntryLine;

export interface EnqueueOpInput {
  db: {
    outbox: {
      put: (item: OutboxItem) => Promise<string>;
    };
  };
  businessId: string;
  opType: OutboxOpType;
  entityType: string;
  entityId: string;
  payload: unknown;
  dependsOn?: string[];
}

const enqueueListeners = new Set<(businessId: string) => void>();

export function onOutboxEnqueue(listener: (businessId: string) => void): () => void {
  enqueueListeners.add(listener);
  return () => enqueueListeners.delete(listener);
}

export async function enqueueOp({
  db,
  businessId,
  opType,
  entityType,
  entityId,
  payload,
  dependsOn = []
}: EnqueueOpInput): Promise<string> {
  const item: OutboxItem = {
    id: newId(),
    businessId,
    opType,
    entityType,
    entityId,
    payload,
    createdAt: nowIso(),
    attempts: 0,
    status: "pending",
    lastError: null,
    dependsOn
  };
  const outboxId = await db.outbox.put(item);
  for (const listener of Array.from(enqueueListeners)) {
    try {
      listener(businessId);
    } catch {
      void 0;
    }
  }
  return outboxId;
}

export function markSynced(record: SyncFields): SyncFields {
  return { ...record, syncStatus: "synced" as SyncStatus };
}
