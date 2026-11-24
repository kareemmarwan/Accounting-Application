"use client";

import { useEffect } from "react";

export default function GlobalError({
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
    <html lang="ar" dir="rtl">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#fafaf9",
          fontFamily: "system-ui, sans-serif",
          color: "#1c1917"
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <p style={{ fontSize: "1.1rem", fontWeight: 700 }}>حدث خطأ غير متوقع</p>
          <p style={{ fontSize: "0.9rem", color: "#78716c" }}>
            أعد المحاولة، وإن استمر الخطأ فأعد تشغيل التطبيق.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1rem",
              padding: "0.6rem 1.4rem",
              borderRadius: "0.75rem",
              border: "none",
              backgroundColor: "#0f766e",
              color: "#fff",
              fontSize: "0.9rem",
              cursor: "pointer"
            }}
          >
            إعادة المحاولة
          </button>
        </div>
      </body>
    </html>
  );
}
