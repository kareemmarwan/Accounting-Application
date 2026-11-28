"use client";

import { useCallback, useEffect, useState } from "react";
import { Smartphone, X } from "lucide-react";
import {
  InstallAppButton,
  detectPlatform,
  isStandalone,
  type Platform
} from "@/components/install-app-button";

const DISMISS_KEY = "musaed-install-banner-dismissed-at";
const RESHOW_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const SHOW_DELAY_MS = 3000;

function recentlyDismissed(): boolean {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < RESHOW_AFTER_MS;
  } catch {
    void 0;
    return false;
  }
}

export function InstallBanner() {
  const [platform, setPlatform] = useState<Platform>(null);
  const [eligible, setEligible] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const detected = detectPlatform();
    setPlatform(detected);
    setEligible(detected !== null && !isStandalone());

    function onInstalled() {
      setEligible(false);
      setVisible(false);
    }
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, []);

  useEffect(() => {
    if (!eligible) return;
    if (recentlyDismissed()) return;
    const timer = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [eligible]);

  const dismiss = useCallback(() => {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      void 0;
    }
  }, []);

  if (!eligible || !platform) return null;

  return (
    <div
      role="region"
      aria-label="دعوة لتثبيت التطبيق"
      className={`fixed inset-x-3 z-30 transition-all duration-300 ${
        visible
          ? "bottom-[calc(4.5rem+env(safe-area-inset-bottom))] translate-y-0 opacity-100 md:bottom-4"
          : "bottom-0 invisible translate-y-6 opacity-0"
      }`}
    >
      <div className="mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-primary-200 bg-surface p-3 shadow-xl shadow-foreground/10">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50">
          <Smartphone className="h-5 w-5 text-primary" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">ثبّت التطبيق على جهازك</p>
          <p className="truncate text-xs text-muted">يعمل دون إنترنت كأي تطبيق</p>
        </div>
        <InstallAppButton className="btn-primary shrink-0 !px-3 !py-2 text-xs" />
        <button
          type="button"
          onClick={dismiss}
          aria-label="إخفاء رسالة التثبيت"
          className="shrink-0 rounded-lg p-1.5 transition-colors hover:bg-muted-foreground/10"
        >
          <X className="h-4 w-4 text-muted" aria-hidden />
        </button>
      </div>
    </div>
  );
}
