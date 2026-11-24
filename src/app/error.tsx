"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";

export default function RootError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-4 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-warning/10 text-warning">
        <RefreshCw className="h-7 w-7" aria-hidden />
      </span>
      <div className="space-y-1.5">
        <p className="text-lg font-bold">حدث خطأ غير متوقع</p>
        <p className="max-w-sm text-sm leading-relaxed text-muted">
          أعد المحاولة، وإن استمر الخطأ فأعد تشغيل التطبيق.
        </p>
      </div>
      <button type="button" onClick={reset} className="btn-primary">
        إعادة المحاولة
      </button>
    </div>
  );
}
