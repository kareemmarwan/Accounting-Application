"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .catch(() => {});

    if (navigator.storage && typeof navigator.storage.persisted === "function") {
      void navigator.storage
        .persisted()
        .then((persisted) => (persisted ? false : navigator.storage.persist()))
        .catch(() => undefined);
    }

    const sendPrecache = () =>
      navigator.serviceWorker.ready.then((registration) => {
        if (registration.active) {
          registration.active.postMessage({ type: "PRECACHE_APP_SHELL" });
          return true;
        }
        return false;
      });

    const precacheOnce = () => {
      if (window.sessionStorage.getItem("musaed-precache-shell") === "done") return;
      void sendPrecache()
        .then((sent) => {
          if (sent) window.sessionStorage.setItem("musaed-precache-shell", "done");
        })
        .catch(() => undefined);
    };

    if (navigator.onLine) {
      precacheOnce();
    }

    const onOnline = () => precacheOnce();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  return null;
}
