"use client";

import { useEffect, useState } from "react";
import {
  Download,
  Share,
  MoreVertical,
  PlusSquare,
  Smartphone,
  X,
  CheckCircle2
} from "lucide-react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Platform = "ios" | "android" | null;

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  const isIOS =
    /iphone|ipad|ipod/i.test(ua) ||
    (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  if (isIOS) return "ios";
  if (/android/i.test(ua)) return "android";
  return null;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone =
    "standalone" in window.navigator &&
    (window.navigator as { standalone?: boolean }).standalone === true;
  return (
    window.matchMedia("(display-mode: standalone)").matches || iosStandalone
  );
}

export function InstallAppButton({
  className = "btn-primary",
  showLabel = true
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const [platform, setPlatform] = useState<Platform>(null);
  const [installed, setInstalled] = useState(false);
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const detected = detectPlatform();
    setPlatform(detected);
    setInstalled(isStandalone());

    function onPrompt(event: Event) {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    }
    function onInstalled() {
      setInstalled(true);
      setPromptEvent(null);
      setModalOpen(false);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!platform || installed) return null;

  async function handleInstall() {
    if (promptEvent) {
      setBusy(true);
      try {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice.outcome === "accepted") setInstalled(true);
        setPromptEvent(null);
      } catch {
        void 0;
      } finally {
        setBusy(false);
      }
      return;
    }
    setModalOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void handleInstall()}
        className={className}
        aria-label="تثبيت التطبيق على الهاتف"
      >
        <Smartphone className="h-4 w-4" aria-hidden />
        {showLabel && <span>تثبيت التطبيق</span>}
      </button>

      {modalOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-foreground/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="طريقة تثبيت التطبيق"
        >
          <div className="w-full max-w-sm rounded-3xl border border-border bg-surface p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <p className="flex items-center gap-2 text-base font-bold">
                <Smartphone className="h-5 w-5 text-primary" aria-hidden />
                تثبيت التطبيق
              </p>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="إغلاق">
                <X className="h-4 w-4 text-muted" />
              </button>
            </div>

            {platform === "ios" ? (
              <ol className="space-y-3 text-sm">
                <li className="flex items-start gap-2.5">
                  <span className="num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-50 text-[10px] font-bold text-primary-700">1</span>
                  <span>افتح الموقع في متصفح <span className="font-bold">Safari</span> (إن كنت في متصفح آخر انسخ الرابط وافتحه هناك)</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-50 text-[10px] font-bold text-primary-700">2</span>
                  <span className="flex items-center gap-1.5 flex-wrap">
                    اضغط زر المشاركة
                    <span className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted-foreground/5 px-2 py-0.5 text-xs font-bold">
                      <Share className="h-3.5 w-3.5" aria-hidden />
                      مشاركة
                    </span>
                    في شريط المتصفح السفلي
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-50 text-[10px] font-bold text-primary-700">3</span>
                  <span className="flex items-center gap-1.5 flex-wrap">
                    اختر
                    <span className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted-foreground/5 px-2 py-0.5 text-xs font-bold">
                      <PlusSquare className="h-3.5 w-3.5" aria-hidden />
                      إضافة إلى الشاشة الرئيسية
                    </span>
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-50 text-[10px] font-bold text-primary-700">4</span>
                  <span>اضغط «إضافة» — سيظهر التطبيق بأيقونته كأي تطبيق مثبت</span>
                </li>
              </ol>
            ) : (
              <ol className="space-y-3 text-sm">
                <li className="flex items-start gap-2.5">
                  <span className="num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-50 text-[10px] font-bold text-primary-700">1</span>
                  <span className="flex items-center gap-1.5 flex-wrap">
                    اضغط قائمة المتصفح
                    <span className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted-foreground/5 px-2 py-0.5 text-xs font-bold">
                      <MoreVertical className="h-3.5 w-3.5" aria-hidden />
                      النقاط الثلاث
                    </span>
                    أعلى الشاشة
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-50 text-[10px] font-bold text-primary-700">2</span>
                  <span>اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية»</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-50 text-[10px] font-bold text-primary-700">3</span>
                  <span>أكّد التثبيت — يعمل بعدها دون إنترنت كأي تطبيق</span>
                </li>
              </ol>
            )}

            <div className="mt-4 flex items-center gap-1.5 rounded-xl bg-primary-50 p-3 text-xs text-primary-800">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
              بعد التثبيت: شاشة كاملة بلا شريط متصفح، ويعمل دون إنترنت
            </div>

            {!promptEvent && platform === "android" && (
              <button
                type="button"
                onClick={() => void handleInstall()}
                disabled={busy}
                className="btn-primary mt-4 w-full"
              >
                <Download className="h-4 w-4" aria-hidden />
                جرب التثبيت المباشر
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
