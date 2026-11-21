"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { getDB } from "@/core/db/db";
import { newId } from "@/core/db/repositories";

export function BackupExport() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setBusy(true);
    setError(null);
    try {
      const db = getDB();
      const data: Record<string, unknown> = {
        __format: "musaed-mali-backup",
        __version: 1,
        __exportedAt: new Date().toISOString()
      };
      for (const table of db.tables) {
        data[table.name] = await table.toArray();
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json"
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `musaed-mali-backup-${new Date()
        .toISOString()
        .slice(0, 10)}-${newId().slice(0, 6)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(
        exportError instanceof Error ? exportError.message : "تعذر إنشاء النسخة الاحتياطية"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <p className="text-sm font-bold">نسخة احتياطية</p>
      <p className="text-xs leading-relaxed text-muted">
        تصدير كل بياناتك المحلية (مبيعات، مشتريات، مصروفات، ديون، قيود، عملاء)
        كملف JSON — احتفظ به في مكان آمن. الاستعادة قرب قرب في نسخة قادمة.
      </p>
      {error && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
          {error}
        </div>
      )}
      <button type="button" onClick={() => void handleExport()} disabled={busy} className="btn-outline text-xs">
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Download className="h-4 w-4" aria-hidden />
        )}
        تنزيل نسخة احتياطية (JSON)
      </button>
    </div>
  );
}
