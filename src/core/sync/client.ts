import { getDB, type OutboxItem, type OutboxOpType, type SyncFields } from "@/core/db/db";
import { onOutboxEnqueue } from "@/core/db/repositories";
import { getSupabaseConfig } from "@/core/supabase/env";
import type { SyncOpType, SyncPushOpResult, SyncPullResponse, SyncPushResponse } from "@/core/validation/sync-payload";
import {
  getOrCreateDeviceId,
  loadSyncMeta,
  saveSyncMeta
} from "@/core/sync/device";
import {
  mapBusinessRow,
  mapCustomerRow,
  mapDebtPaymentRow,
  mapDebtRow,
  mapExpenseCategoryRow,
  mapExpenseRow,
  mapFinancialAccountRow,
  mapJournalEntryLineRow,
  mapJournalEntryRow,
  mapProductRow,
  mapPurchaseRow,
  mapSaleItemRow,
  mapSaleRow,
  mapSupplierRow
} from "@/core/sync/row-mapping";

export type SyncEngineStatus = "idle" | "syncing" | "error";

export interface SyncEngineState {
  status: SyncEngineStatus;
  pendingOps: number;
  conflicts: number;
  lastError: string | null;
  lastRunAt: string | null;
  configured: boolean;
}

const listeners = new Set<() => void>();
const BOOTSTRAP_BUSINESS_KEY = "__bootstrap__";
let state: SyncEngineState = {
  status: "idle",
  pendingOps: 0,
  conflicts: 0,
  lastError: null,
  lastRunAt: null,
  configured: false
};
let syncing = false;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function setState(patch: Partial<SyncEngineState>) {
  state = { ...state, ...patch };
  for (const listener of Array.from(listeners)) listener();
}

export function getSyncEngineState(): SyncEngineState {
  return state;
}

export function subscribeSyncEngine(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function refreshCounts(): Promise<void> {
  const db = getDB();
  const pendingOps = await db.outbox
    .filter((item) => item.status !== "failed" || item.attempts < 12)
    .count();
  let conflicts = 0;
  for (const table of [
    db.customers,
    db.suppliers,
    db.financialAccounts,
    db.sales,
    db.purchases,
    db.expenses,
    db.debts,
    db.products
  ]) {
    conflicts += await table
      .filter((row: SyncFields) => row.syncStatus === "conflict")
      .count();
  }
  setState({ pendingOps, conflicts });
}

const ENTITY_OPS: OutboxOpType[] = [
  "entity.upsert",
  "entity.soft_delete",
  "product.upsert",
  "product.soft_delete"
];

function sourceTypeOf(opType: OutboxOpType): string {
  switch (opType) {
    case "sale.create":
      return "sale";
    case "purchase.create":
      return "purchase";
    case "expense.create":
      return "expense";
    case "debt_payment.create":
      return "debt_payment";
    case "transfer.create":
      return "transfer";
    case "deposit.create":
      return "deposit";
    case "withdrawal.create":
      return "withdrawal";
    case "adjustment.create":
      return "adjustment";
    case "manual_debt.create":
      return "opening";
    default:
      return "";
  }
}

async function applyPushResult(
  op: OutboxItem,
  result: SyncPushOpResult
): Promise<void> {
  const db = getDB();

  if (!result.ok) {
    await db.outbox.update(op.id, {
      status: "failed",
      attempts: op.attempts + 1,
      lastError: result.error ?? "خطأ غير معروف"
    });
    if (/CONFLICT/i.test(result.error ?? "")) {
      await markRecordStatus(op.entityType, op.entityId, "conflict");
    }
    return;
  }

  await replaceLocalJournalEntry(op, db);

  switch (op.opType) {
    case "sale.create": {
      const sale = await db.sales.get(op.entityId);
      if (sale && result.opType === "sale.create") {
        await db.sales.update(sale.id, { syncStatus: "synced" });
      }
      const payload = op.payload as
        | { debt?: { id: string } | null }
        | undefined;
      if (payload?.debt) {
        await db.debts.update(payload.debt.id, { syncStatus: "synced" });
      }
      break;
    }
    case "purchase.create": {
      await db.purchases.update(op.entityId, { syncStatus: "synced" });
      const payload = op.payload as
        | { debt?: { id: string } | null }
        | undefined;
      if (payload?.debt) {
        await db.debts.update(payload.debt.id, { syncStatus: "synced" });
      }
      break;
    }
    case "expense.create":
      await db.expenses.update(op.entityId, { syncStatus: "synced" });
      break;
    case "debt_payment.create": {
      await db.debtPayments.update(op.entityId, { syncStatus: "synced" });
      const payload = op.payload as
        | { payment?: { debtId: string } }
        | undefined;
      if (payload?.payment?.debtId) {
        await db.debts.update(payload.payment.debtId, { syncStatus: "synced" });
      }
      break;
    }
    case "manual_debt.create": {
      const payload = op.payload as { debt?: { id: string } } | undefined;
      if (payload?.debt?.id) {
        await db.debts.update(payload.debt.id, { syncStatus: "synced" });
      }
      break;
    }
    case "sale.add_items":
      break;
    case "transfer.create":
    case "deposit.create":
    case "withdrawal.create":
    case "adjustment.create":
      await db.financialAccounts.update(op.entityId, { syncStatus: "synced" });
      break;
    case "entity.upsert": {
      await markRecordStatus(op.entityType, op.entityId, "synced");
      break;
    }
    case "entity.soft_delete": {
      const row = await readRecord(op.entityType, op.entityId);
      if (row) {
        await putRecord(op.entityType, {
          ...row,
          syncStatus: "synced",
          updatedAt: new Date().toISOString(),
          version: row.version + 1
        });
      }
      break;
    }
    case "product.upsert": {
      await db.products.update(op.entityId, { syncStatus: "synced" });
      break;
    }
    case "product.soft_delete": {
      const product = await db.products.get(op.entityId);
      if (product) {
        await db.products.put({
          ...product,
          syncStatus: "synced",
          updatedAt: new Date().toISOString(),
          version: product.version + 1
        });
      }
      break;
    }
    case "inventory.adjust":
      break;
    default:
      break;
  }

  await db.outbox.delete(op.id);
}

async function readRecord(
  entityType: string,
  id: string
): Promise<(SyncFields & { id: string }) | null> {
  const db = getDB();
  switch (entityType) {
    case "customers": {
      const row = await db.customers.get(id);
      return row ?? null;
    }
    case "suppliers": {
      const row = await db.suppliers.get(id);
      return row ?? null;
    }
    case "financial_accounts": {
      const row = await db.financialAccounts.get(id);
      return row ?? null;
    }
    case "products": {
      const row = await db.products.get(id);
      return row ?? null;
    }
    case "sales": {
      const row = await db.sales.get(id);
      return row ?? null;
    }
    default:
      return null;
  }
}

async function putRecord(entityType: string, row: Record<string, unknown>): Promise<void> {
  const db = getDB();
  switch (entityType) {
    case "customers":
      await db.customers.put(row as never);
      break;
    case "suppliers":
      await db.suppliers.put(row as never);
      break;
    case "financial_accounts":
      await db.financialAccounts.put(row as never);
      break;
    case "products":
      await db.products.put(row as never);
      break;
    case "sales":
      await db.sales.put(row as never);
      break;
    default:
      break;
  }
}

async function markRecordStatus(
  entityType: string,
  id: string,
  status: SyncFields["syncStatus"]
): Promise<void> {
  const existing = await readRecord(entityType, id);
  if (!existing) return;
  await putRecord(entityType, { ...existing, syncStatus: status });
}

async function replaceLocalJournalEntry(op: OutboxItem, db: ReturnType<typeof getDB>): Promise<void> {
  const sourceType = sourceTypeOf(op.opType);
  if (!sourceType) return;
  const entries = await db.journalEntries
    .where("sourceType")
    .equals(sourceType)
    .filter((candidate) => candidate.sourceId === op.entityId)
    .toArray();
  for (const entry of entries) {
    const lines = await db.journalEntryLines
      .where("entryId")
      .equals(entry.id)
      .toArray();
    await db.journalEntryLines.bulkDelete(lines.map((line) => line.id));
    await db.journalEntries.delete(entry.id);
  }
}

function backoffDelayMs(attempts: number): number {
  return Math.min(5000 * Math.pow(2, attempts), 10 * 60 * 1000);
}

function outboxIsDue(item: OutboxItem): boolean {
  if (item.attempts === 0) return true;
  return Date.now() - Date.parse(item.createdAt) >= backoffDelayMs(item.attempts);
}

async function pushOutbox(
  businessId: string | null,
  deviceId: string
): Promise<void> {
  if (!businessId) return;
  const db = getDB();
  const all = await db.outbox
    .where("businessId")
    .equals(businessId)
    .toArray();

  const due = all
    .filter((item) => item.status !== "syncing" && outboxIsDue(item))
    .sort((a, b) => {
      const aEntity = ENTITY_OPS.includes(a.opType) ? 0 : 1;
      const bEntity = ENTITY_OPS.includes(b.opType) ? 0 : 1;
      if (aEntity !== bEntity) return aEntity - bEntity;
      return Date.parse(a.createdAt) - Date.parse(b.createdAt);
    });

  if (due.length === 0) return;

  const batchSize = 50;
  for (let offset = 0; offset < due.length; offset += batchSize) {
    const batch = due.slice(offset, offset + batchSize);
    for (const item of batch) {
      await db.outbox.update(item.id, { status: "syncing" });
    }

    const config = getSupabaseConfig();
    if (!config) {
      for (const item of batch) {
        await db.outbox.update(item.id, {
          status: "failed",
          lastError: "لم يتم إعداد Supabase"
        });
      }
      return;
    }

    let response: Response;
    try {
      response = await fetch("/api/sync/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId,
          operations: batch.map((item) => ({
            businessId: item.businessId,
            opType: item.opType,
            entityType: item.entityType,
            entityId: item.entityId,
            payload: item.payload
          }))
        })
      });
    } catch (networkError) {
      for (const item of batch) {
        await db.outbox.update(item.id, {
          status: "failed",
          attempts: item.attempts + 1,
          lastError:
            networkError instanceof Error ? networkError.message : "تعذر الاتصال"
        });
      }
      return;
    }

    if (!response.ok) {
      let message = `فشل الخادم (${response.status})`;
      try {
        const body = (await response.json()) as { error?: string };
        if (body?.error) message = body.error;
      } catch {
        void 0;
      }
      for (const item of batch) {
        await db.outbox.update(item.id, {
          status: "failed",
          attempts: item.attempts + 1,
          lastError: message
        });
      }
      return;
    }

    const body = (await response.json()) as SyncPushResponse;
    const resultByClientOpId = new Map<string, SyncPushOpResult>();
    for (const result of body.results) {
      if (result.clientOpId) {
        resultByClientOpId.set(result.clientOpId, result);
      }
    }

    for (const item of batch) {
      const payloadClientOpId =
        typeof item.payload === "object" && item.payload !== null && "clientOpId" in item.payload
          ? String((item.payload as { clientOpId: unknown }).clientOpId)
          : item.entityId;
      const result =
        resultByClientOpId.get(payloadClientOpId) ??
        ({
          clientOpId: payloadClientOpId,
          opType: item.opType as SyncOpType,
          ok: false,
          error: "استجابة ناقصة من الخادم"
        } satisfies SyncPushOpResult);
      await applyPushResult(item, result);
    }
  }
}

async function pullDeltas(
  businessId: string | null,
  deviceId: string
): Promise<void> {
  const config = getSupabaseConfig();
  if (!config) return;

  const syncMeta = businessId ? await loadSyncMeta(businessId) : null;
  const since = syncMeta?.lastPulledAt ?? null;

  let response: Response;
  try {
    response = await fetch("/api/sync/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId, deviceId, since })
    });
  } catch {
    return;
  }

  if (!response.ok) return;

  const body = (await response.json()) as SyncPullResponse;

  for (const delta of body.deltas) {
    await applyDelta(delta.table, delta.rows);
  }

  if (syncMeta) {
    await saveSyncMeta({
      ...syncMeta,
      lastPulledAt: body.watermark,
      watermarks: { ...syncMeta.watermarks, ...{ last: body.watermark } }
    });
  }
}

function keepLocalOverServer(local: SyncFields & { id: string }, serverVersion: number): boolean {
  return local.syncStatus === "pending" && local.version > serverVersion;
}

async function applyDelta(table: string, rows: Array<Record<string, unknown>>): Promise<void> {
  const db = getDB();

  switch (table) {
    case "businesses": {
      for (const row of rows) {
        const mapped = mapBusinessRow(row);
        if (!mapped) continue;
        const local = await db.businesses.get(mapped.id);
        if (local && local.version >= mapped.version) continue;
        await db.businesses.put(mapped);
      }
      break;
    }
    case "customers": {
      for (const row of rows) {
        const mapped = mapCustomerRow(row);
        if (!mapped) continue;
        const local = await db.customers.get(mapped.id);
        if (local && keepLocalOverServer(local, mapped.version)) continue;
        await db.customers.put(mapped);
      }
      break;
    }
    case "suppliers": {
      for (const row of rows) {
        const mapped = mapSupplierRow(row);
        if (!mapped) continue;
        const local = await db.suppliers.get(mapped.id);
        if (local && keepLocalOverServer(local, mapped.version)) continue;
        await db.suppliers.put(mapped);
      }
      break;
    }
    case "financial_accounts": {
      for (const row of rows) {
        const mapped = mapFinancialAccountRow(row);
        if (!mapped) continue;
        const local = await db.financialAccounts.get(mapped.id);
        if (local && keepLocalOverServer(local, mapped.version)) continue;
        await db.financialAccounts.put(mapped);
      }
      break;
    }
    case "expense_categories": {
      for (const row of rows) {
        const mapped = mapExpenseCategoryRow(row);
        if (!mapped) continue;
        await db.expenseCategories.put(mapped);
      }
      break;
    }
    case "products": {
      for (const row of rows) {
        const mapped = mapProductRow(row);
        if (!mapped) continue;
        const local = await db.products.get(mapped.id);
        if (local && keepLocalOverServer(local, mapped.version)) continue;
        await db.products.put(mapped);
      }
      break;
    }
    case "sale_items": {
      for (const row of rows) {
        const mapped = mapSaleItemRow(row);
        if (!mapped) continue;
        await db.saleItems.put(mapped);
      }
      break;
    }
    case "sales": {
      for (const row of rows) {
        const mapped = mapSaleRow(row);
        if (!mapped) continue;
        const local = await db.sales.get(mapped.id);
        if (local && keepLocalOverServer(local, mapped.version)) continue;
        await db.sales.put(mapped);
      }
      break;
    }
    case "purchases": {
      for (const row of rows) {
        const mapped = mapPurchaseRow(row);
        if (!mapped) continue;
        const local = await db.purchases.get(mapped.id);
        if (local && keepLocalOverServer(local, mapped.version)) continue;
        await db.purchases.put(mapped);
      }
      break;
    }
    case "expenses": {
      const categories = await db.expenseCategories.toArray();
      const glByCategory = new Map(categories.map((category) => [category.id, category.glCode]));
      for (const row of rows) {
        const mapped = mapExpenseRow(row, glByCategory);
        if (!mapped) continue;
        const local = await db.expenses.get(mapped.id);
        if (local && keepLocalOverServer(local, mapped.version)) continue;
        await db.expenses.put(mapped);
      }
      break;
    }
    case "debts": {
      for (const row of rows) {
        const mapped = mapDebtRow(row);
        if (!mapped) continue;
        const local = await db.debts.get(mapped.id);
        if (local && keepLocalOverServer(local, mapped.version)) continue;
        await db.debts.put(mapped);
      }
      break;
    }
    case "debt_payments": {
      for (const row of rows) {
        const mapped = mapDebtPaymentRow(row);
        if (!mapped) continue;
        const local = await db.debtPayments.get(mapped.id);
        if (local && keepLocalOverServer(local, mapped.version)) continue;
        await db.debtPayments.put(mapped);
      }
      break;
    }
    case "journal_entries": {
      for (const row of rows) {
        const mapped = mapJournalEntryRow(row);
        if (!mapped) continue;
        const local = await db.journalEntries.get(mapped.id);
        if (local && local.syncStatus === "pending" && local.version > mapped.version) continue;
        await db.journalEntries.put(mapped);
      }
      break;
    }
    case "journal_entry_lines": {
      for (const row of rows) {
        const mapped = mapJournalEntryLineRow(row);
        if (!mapped) continue;
        await db.journalEntryLines.put(mapped);
      }
      break;
    }
    default:
      break;
  }
}

export async function syncBusiness(businessId: string | null): Promise<void> {
  if (syncing) return;
  const configured = Boolean(getSupabaseConfig());
  if (!configured) {
    setState({ configured: false, status: "idle" });
    return;
  }

  syncing = true;
  setState({ status: "syncing", configured: true, lastError: null });
  try {
    const deviceId = await getOrCreateDeviceId(
      businessId ?? BOOTSTRAP_BUSINESS_KEY
    );
    await pushOutbox(businessId, deviceId);
    await pullDeltas(businessId, deviceId);
    await refreshCounts();
    setState({ status: "idle", lastRunAt: new Date().toISOString() });
  } catch (error) {
    await refreshCounts();
    setState({
      status: "error",
      lastError: error instanceof Error ? error.message : "خطأ في المزامنة"
    });
  } finally {
    syncing = false;
  }
}

export async function syncAfterOperation(businessId: string): Promise<void> {
  await refreshCounts();
  void syncBusiness(businessId);
}

let enqueueHooked = false;
let enqueueDebounce: ReturnType<typeof setTimeout> | null = null;

export function initSyncEngine(getBusinessId: () => string | null): void {
  if (enqueueHooked) return;
  enqueueHooked = true;
  onOutboxEnqueue((businessId) => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (!getSupabaseConfig()) return;
    if (enqueueDebounce) clearTimeout(enqueueDebounce);
    enqueueDebounce = setTimeout(() => {
      enqueueDebounce = null;
      const target = getBusinessId() ?? businessId;
      void syncBusiness(target);
    }, 2000);
  });
}

export function startSyncHeartbeat(
  getBusinessId: () => string | null
): () => void {
  if (heartbeatTimer) return () => void 0;
  const tick = () => {
    const businessId = getBusinessId();
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    void syncBusiness(businessId);
  };
  tick();
  heartbeatTimer = setInterval(tick, 60_000);
  if (typeof window !== "undefined") {
    window.addEventListener("online", tick);
  }
  return () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };
}
