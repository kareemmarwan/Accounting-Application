"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});

    if (navigator.storage && typeof navigator.storage.persisted === "function") {
      void navigator.storage
        .persisted()
        .then((persisted) => (persisted ? false : navigator.storage.persist()))
        .catch(() => undefined);
    }
  }, []);

  return null;
}
