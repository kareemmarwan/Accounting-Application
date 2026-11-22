"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CameraOff, Flashlight, FlashlightOff, Loader2, ScanLine, X } from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

const NATIVE_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "itf"
];

const ZXING_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF
];

interface DetectedBarcodeLike {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcodeLike[]>;
}

type BarcodeDetectorConstructor = new (options?: {
  formats?: string[];
}) => BarcodeDetectorLike;

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
}

interface BarcodeCameraScannerProps {
  onClose: () => void;
  onDetected: (code: string) => void;
}

type ScannerStatus = "starting" | "ready" | "error";

function playBeep(): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = 1046;
    gain.gain.value = 0.08;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.09);
    oscillator.onended = () => void ctx.close();
  } catch {
    return;
  }
}

function cameraErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "تم رفض إذن الكاميرا — اسمح بالوصول من إعدادات المتصفح ثم أعد المحاولة";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "لا توجد كاميرا خلفية على هذا الجهاز";
  }
  if (name === "NotReadableError") {
    return "الكاميرا مستخدمة من تطبيق آخر — أغلقها ثم أعد المحاولة";
  }
  return "تعذر تشغيل الكاميرا — تأكد من الإذن والاتصال الآمن ثم أعد المحاولة";
}

export function BarcodeCameraScanner({
  onClose,
  onDetected
}: BarcodeCameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const timerRef = useRef<number>(0);
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  const [status, setStatus] = useState<ScannerStatus>("starting");
  const [errorText, setErrorText] = useState("");
  const [engine, setEngine] = useState("");
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const emit = useCallback(
    (code: string) => {
      const now = Date.now();
      if (
        lastRef.current.code === code &&
        now - lastRef.current.at < 1200
      ) {
        return;
      }
      lastRef.current = { code, at: now };
      playBeep();
      navigator.vibrate?.(60);
      onDetected(code);
    },
    [onDetected]
  );

  useEffect(() => {
    let cancelled = false;

    async function start(): Promise<void> {
      try {
        if (!window.isSecureContext) {
          throw new DOMException("insecure", "NotSupportedError");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => undefined);

        const track = stream.getVideoTracks()[0] ?? null;
        const capabilities = track?.getCapabilities?.() as
          | { torch?: boolean }
          | undefined;
        setTorchSupported(Boolean(capabilities?.torch));

        const NativeDetector = window.BarcodeDetector;
        if (NativeDetector) {
          if (cancelled) return;
          setEngine("الماسح الأصلي للجهاز");
          setStatus("ready");
          const detector = new NativeDetector({ formats: NATIVE_FORMATS });
          let busy = false;
          const tick = (): void => {
            if (cancelled) return;
            if (!busy && video.readyState >= 2) {
              busy = true;
              detector
                .detect(video)
                .then((codes) => {
                  const value = codes[0]?.rawValue;
                  if (value) emit(value);
                })
                .catch(() => undefined)
                .finally(() => {
                  busy = false;
                });
            }
            timerRef.current = window.setTimeout(tick, 120);
          };
          tick();
          return;
        }

        if (cancelled) return;
        setEngine("ZXing");
        setStatus("ready");
        const hints = new Map<DecodeHintType, unknown>();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, ZXING_FORMATS);
        hints.set(DecodeHintType.TRY_HARDER, true);
        const reader = new BrowserMultiFormatReader(
          hints as Map<DecodeHintType, never>
        );
        const controls = await reader.decodeFromStream(
          stream,
          video,
          (result) => {
            const text = result?.getText() ?? "";
            if (text) emit(text);
          }
        );
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
      } catch (error) {
        if (cancelled) return;
        setStatus("error");
        setErrorText(cameraErrorMessage(error));
      }
    }

    void start();

    return () => {
      cancelled = true;
      window.clearTimeout(timerRef.current);
      controlsRef.current?.stop();
      controlsRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [emit]);

  async function toggleTorch(): Promise<void> {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next }]
      } as unknown as MediaTrackConstraints);
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black"
      role="dialog"
      aria-modal="true"
      aria-label="مسح الباركود بالكاميرا"
    >
      <div className="flex items-center justify-between gap-2 p-3 text-white">
        <p className="flex items-center gap-2 text-sm font-bold">
          <ScanLine className="h-5 w-5" aria-hidden />
          مسح بالكاميرا
        </p>
        <div className="flex items-center gap-2">
          {torchSupported && (
            <button
              type="button"
              onClick={() => void toggleTorch()}
              className="rounded-xl bg-white/10 p-2 hover:bg-white/20"
              aria-label={torchOn ? "إطفاء الإضاءة" : "إضاءة الكاميرا"}
            >
              {torchOn ? (
                <FlashlightOff className="h-5 w-5" aria-hidden />
              ) : (
                <Flashlight className="h-5 w-5" aria-hidden />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-white/10 p-2 hover:bg-white/20"
            aria-label="إغلاق الماسح"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className="h-full w-full object-cover"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-10 top-1/2 h-40 -translate-y-1/2 rounded-2xl border-2 border-primary/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
        >
          <span className="absolute inset-x-4 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-primary/70" />
        </div>

        {status === "starting" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <p className="flex items-center gap-2 text-sm font-bold text-white">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              جارٍ تشغيل الكاميرا...
            </p>
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center">
            <CameraOff className="h-8 w-8 text-white/80" aria-hidden />
            <p className="text-sm font-medium text-white">{errorText}</p>
            <button type="button" onClick={onClose} className="btn-primary">
              إغلاق
            </button>
          </div>
        )}
      </div>

      <div className="p-3 text-center">
        <p className="text-xs text-white/80">
          وجّه الكاميرا نحو الباركود — يُضاف المنتج تلقائياً عند القراءة
          {engine ? ` — محرك: ${engine}` : ""}
        </p>
        <p className="mt-1 text-[10px] text-white/50">
          EAN-13 / EAN-8 / UPC-A / UPC-E / Code-128 / Code-39 / ITF
        </p>
      </div>
    </div>
  );
}
