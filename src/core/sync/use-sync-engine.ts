"use client";

import { useEffect, useState } from "react";
import {
  getSyncEngineState,
  subscribeSyncEngine,
  type SyncEngineState
} from "@/core/sync/client";
import { getDB } from "@/core/db/db";

export function useSyncEngine(businessId: string | null): SyncEngineState {
  const [state, setState] = useState<SyncEngineState>(getSyncEngineState());

  useEffect(() => {
    const unsubscribe = subscribeSyncEngine(() => setState({ ...getSyncEngineState() }));
    setState({ ...getSyncEngineState() });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!businessId) return;
    const db = getDB();
    let cancelled = false;
    const counts = async () => {
      if (cancelled) return;
      const pendingOps = await db.outbox
        .where("businessId")
        .equals(businessId)
        .count();
      setState((current) => ({ ...current, pendingOps }));
    };
    void counts();
    const interval = setInterval(counts, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [businessId]);

  return state;
}
