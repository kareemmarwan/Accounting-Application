import { getDB, type SyncMetaRecord } from "@/core/db/db";
import { newId } from "@/core/db/repositories";

async function findMeta(businessId: string): Promise<SyncMetaRecord | null> {
  const db = getDB();
  const all = await db.syncMeta.toArray();
  return all.find((record) => record.businessId === businessId) ?? null;
}

export async function getOrCreateDeviceId(businessId: string): Promise<string> {
  const existing = await findMeta(businessId);
  if (existing) return existing.deviceId;

  const deviceId = newId();
  const record: SyncMetaRecord = {
    deviceId,
    businessId,
    lastPulledAt: null,
    watermarks: {}
  };
  await getDB().syncMeta.put(record);
  return deviceId;
}

export async function loadSyncMeta(businessId: string): Promise<SyncMetaRecord | null> {
  return findMeta(businessId);
}

export async function saveSyncMeta(record: SyncMetaRecord): Promise<void> {
  await getDB().syncMeta.put(record);
}
