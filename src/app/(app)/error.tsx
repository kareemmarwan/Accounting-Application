"use client";

import { useEffect } from "react";
import { RefreshCw, WifiOff } from "lucide-react";

export default function AppError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const offline = typeof navigator !== "undefined" && !navigator.onLine;

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 px-4 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-warning/10 text-warning">
        {offline ? (
          <WifiOff className="h-7 w-7" aria-hidden />
        ) : (
          <RefreshCw className="h-7 w-7" aria-hidden />
        )}
      </span>
      <div className="space-y-1.5">
        <p className="text-lg font-bold">
          {offline ? "تعمل حالياً دون اتصال بالإنترنت" : "حدث خطأ غير متوقع"}
        </p>
        <p className="max-w-sm text-sm leading-relaxed text-muted">
          {offline
            ? "بياناتك محفوظة على جهازك وتُزامَن تلقائياً عند عودة الاتصال. أعد تحميل الصفحة للمتابعة."
            : "أعد المحاولة، وإن استمر الخطأ فتحقق من اتصالك بالإنترنت ثم أعد المحاولة."}
        </p>
      </div>
      <button type="button" onClick={reset} className="btn-primary">
        إعادة المحاولة
      </button>
    </div>
  );
}
