"use client";

import { useEffect, useState } from "react";
import { CloudOff, RefreshCw, TriangleAlert, Wifi, WifiOff } from "lucide-react";
import { useSyncEngine } from "@/core/sync/use-sync-engine";
import { getDB } from "@/core/db/db";
import { initSyncEngine, startSyncHeartbeat, syncBusiness } from "@/core/sync/client";

type ConnectionState = "unknown" | "online" | "offline";

export function ConnectionStatus() {
  const [state, setState] = useState<ConnectionState>("unknown");
  const [businessId, setBusinessId] = useState<string | null>(null);
  const sync = useSyncEngine(businessId);

  useEffect(() => {
    setState(navigator.onLine ? "online" : "offline");
    const goOnline = () => setState("online");
    const goOffline = () => setState("offline");
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    let active = true;
    const load = async () => {
      const businesses = await getDB().businesses.toArray();
      if (!active) return;
      const sorted = [...businesses].sort(
        (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
      );
      setBusinessId(sorted[0]?.id ?? null);
    };
    void load();
    initSyncEngine(() => businessId);
    const stopHeartbeat = startSyncHeartbeat(() => businessId);

    return () => {
      active = false;
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      stopHeartbeat();
    };
  }, [businessId]);

  if (state === "unknown") {
    return (
      <span
        className="inline-flex h-8 w-20 items-center justify-center rounded-full border border-border bg-muted-foreground/5 text-xs text-muted"
        data-tour="connection-status"
        aria-hidden
      >
        ...
      </span>
    );
  }

  const online = state === "online";
  const showPending = sync.pendingOps > 0;
  const syncingNow = sync.status === "syncing" && online;

  return (
    <div className="flex items-center gap-1.5" data-tour="connection-status">
      {showPending && (
        <button
          type="button"
          onClick={() => businessId && void syncBusiness(businessId)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${
            sync.conflicts > 0
              ? "border-danger/40 bg-danger/10 text-danger"
              : "border-primary-200 bg-primary-50 text-primary-700"
          }`}
          title={sync.lastError ?? "انقر للمزامنة الآن"}
        >
          {sync.conflicts > 0 ? (
            <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <RefreshCw
              className={`h-3.5 w-3.5 ${syncingNow ? "animate-spin" : ""}`}
              aria-hidden
            />
          )}
          {sync.conflicts > 0 ? "تعارضات" : `${sync.pendingOps} بانتظار المزامنة`}
        </button>
      )}
      {online && !sync.configured && !showPending && (
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted-foreground/5 px-3 py-1.5 text-xs text-muted"
          title="أضف مفاتيح Supabase إلى .env.local لتفعيل المزامنة السحابية"
        >
          <CloudOff className="h-3.5 w-3.5" aria-hidden />
          محلي فقط
        </span>
      )}
      <span
        role="status"
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${
          online
            ? "border-primary-200 bg-primary-50 text-primary-700"
            : "border-warning/30 bg-warning/10 text-warning"
        }`}
      >
        {online ? (
          <Wifi className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <WifiOff className="h-3.5 w-3.5" aria-hidden />
        )}
        {online ? "متصل" : "غير متصل"}
      </span>
    </div>
  );
}
