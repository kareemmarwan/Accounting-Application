"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CameraOff, Flashlight, FlashlightOff, Loader2, ScanLine, X } from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { acquireCameraStream } from "@/lib/camera-stream";

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
  onDetected: (code: string) => boolean | Promise<boolean>;
}

type ScannerStatus = "starting" | "ready" | "error";

const SAME_CODE_REPEAT_DELAY_MS = 250;
const ABSENT_CLEAR_MS = 550;

let sharedAudioCtx: AudioContext | null = null;

function playBeep(): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
      sharedAudioCtx = new Ctx();
    }
    if (sharedAudioCtx.state === "suspended") {
      void sharedAudioCtx.resume();
    }
    const oscillator = sharedAudioCtx.createOscillator();
    const gain = sharedAudioCtx.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = 1046;
    gain.gain.value = 0.08;
    oscillator.connect(gain);
    gain.connect(sharedAudioCtx.destination);
    oscillator.start();
    oscillator.stop(sharedAudioCtx.currentTime + 0.09);
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

  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const lastCodeRef = useRef("");
  const lastEmitAtRef = useRef(0);
  const absentSinceRef = useRef<number | null>(null);

  const [status, setStatus] = useState<ScannerStatus>("starting");
  const [errorText, setErrorText] = useState("");
  const [engine, setEngine] = useState("");
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const noteFrame = useCallback((code: string | null): void => {
    const now = Date.now();

    if (code) {
      absentSinceRef.current = null;
      if (
        code !== lastCodeRef.current &&
        now - lastEmitAtRef.current > SAME_CODE_REPEAT_DELAY_MS
      ) {
        lastCodeRef.current = code;
        lastEmitAtRef.current = now;
        playBeep();
        navigator.vibrate?.(60);
        void Promise.resolve(onDetectedRef.current(code)).then((keep) => {
          if (keep === false) onCloseRef.current();
        });
      }
      return;
    }

    if (absentSinceRef.current === null) {
      absentSinceRef.current = now;
    } else if (now - absentSinceRef.current > ABSENT_CLEAR_MS) {
      lastCodeRef.current = "";
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function start(): Promise<void> {
      try {
        if (!window.isSecureContext) {
          throw new DOMException("insecure", "NotSupportedError");
        }
        const stream = await acquireCameraStream();
        if (cancelled) return;
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
                  noteFrame(codes[0]?.rawValue ?? null);
                })
                .catch(() => noteFrame(null))
                .finally(() => {
                  busy = false;
                });
            }
            timerRef.current = window.setTimeout(tick, 110);
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
          hints as Map<DecodeHintType, never>,
          {
            delayBetweenScanAttempts: 50,
            delayBetweenScanSuccess: 100,
            tryPlayVideoTimeout: 5000
          }
        );
        const controls = await reader.decodeFromStream(
          stream.clone(),
          video,
          (result) => {
            noteFrame(result?.getText() ?? null);
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
      streamRef.current = null;
    };
  }, [noteFrame]);

  useEffect(() => {
    function onVisible(): void {
      const video = videoRef.current;
      if (document.visibilityState === "visible" && video) {
        void video.play().catch(() => undefined);
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

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
      className="relative w-full overflow-hidden rounded-xl bg-black"
      aria-label="مسح الباركود بالكاميرا"
    >
      <div className="relative h-44 w-full">
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-8 top-1/2 h-20 -translate-y-1/2 rounded-xl border-2 border-primary/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.3)]"
        >
          <span className="absolute inset-x-3 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-primary/80" />
        </div>

        <div className="absolute top-2 end-2 flex items-center gap-1.5">
          {torchSupported && (
            <button
              type="button"
              onClick={() => void toggleTorch()}
              className="rounded-lg bg-black/50 p-1.5 text-white hover:bg-black/70"
              aria-label={torchOn ? "إطفاء الإضاءة" : "إضاءة الكاميرا"}
            >
              {torchOn ? (
                <FlashlightOff className="h-4 w-4" aria-hidden />
              ) : (
                <Flashlight className="h-4 w-4" aria-hidden />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-black/50 p-1.5 text-white hover:bg-black/70"
            aria-label="إغلاق الماسح"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {status === "starting" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <p className="flex items-center gap-2 text-xs font-bold text-white">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              جارٍ تشغيل الكاميرا...
            </p>
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 p-4 text-center">
            <CameraOff className="h-6 w-6 text-white/80" aria-hidden />
            <p className="text-xs font-medium text-white">{errorText}</p>
            <button type="button" onClick={onClose} className="btn-primary !px-3 !py-1.5 text-xs">
              إغلاق
            </button>
          </div>
        )}
      </div>

      <p className="flex items-center justify-center gap-1.5 bg-black px-2 py-1 text-center text-[10px] text-white/70">
        <ScanLine className="h-3 w-3" aria-hidden />
        وجّه الكاميرا نحو الباركود — يُقبل مرة واحدة حتى تُبعده{engine ? ` — ${engine}` : ""}
      </p>
    </div>
  );
}
