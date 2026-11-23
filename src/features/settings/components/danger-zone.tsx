"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Archive, Loader2 } from "lucide-react";
import { archiveBusiness } from "@/features/settings/server/actions";
import { isSupabaseConfigured } from "@/core/supabase/client";
import { signOut } from "@/features/auth/services/auth-service";

const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none transition-colors focus:border-danger focus:ring-2 focus:ring-danger/20";

export function DangerZone({
  businessId,
  businessName
}: {
  businessId: string;
  businessName: string;
}) {
  const router = useRouter();
  const [confirmName, setConfirmName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const matches = useMemo(
    () => confirmName.trim() === businessName.trim(),
    [confirmName, businessName]
  );

  async function handleArchive() {
    setError(null);
    setBusy(true);
    try {
      const result = await archiveBusiness({ businessId, confirmName: confirmName.trim() });
      if (!result.ok) {
        setError(result.error ?? "تعذر إغلاق المشروع");
        setBusy(false);
        return;
      }
      if (isSupabaseConfigured()) {
        try {
          await signOut();
        } catch {
          void 0;
        }
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("تعذر إغلاق المشروع — أعد المحاولة");
      setBusy(false);
    }
  }

  return (
    <div className="card border-danger/40 space-y-3">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-danger/10 text-danger">
          <Archive className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-bold text-danger">منطقة الخطر — إغلاق المشروع</p>
          <p className="text-xs text-muted">
            يُخفي المشروع نهائياً من قائمة مشاريعك مع الاحتفاظ بالسجلات في السحابة
          </p>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        بعد الإغلاق: تُخفى بيانات المشروع من كل الأعضاء، ويُسجَّل خروجك تلقائياً.
        استعادة المشروع متاحة لاحقاً بطلب من الدعم فقط.
      </p>
      <div>
        <label className="mb-1 block text-xs font-semibold" htmlFor="archive-confirm">
          اكتب اسم المشروع للتأكيد: <span className="font-bold">{businessName}</span>
        </label>
        <input
          id="archive-confirm"
          value={confirmName}
          onChange={(event) => {
            setConfirmName(event.target.value);
            setError(null);
          }}
          className={inputClass}
          autoComplete="off"
        />
      </div>
      {error && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-danger">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => void handleArchive()}
        disabled={!matches || busy}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-danger px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Archive className="h-4 w-4" aria-hidden />}
        إغلاق المشروع نهائياً
      </button>
    </div>
  );
}
