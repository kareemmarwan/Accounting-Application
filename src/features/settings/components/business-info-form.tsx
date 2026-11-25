"use client";

import { useState } from "react";
import { Building2, Loader2, Pencil, Save } from "lucide-react";
import { updateBusiness } from "@/features/settings/server/actions";

const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

export function BusinessInfoForm({
  businessId,
  initial
}: {
  businessId: string;
  initial: { name: string; phone: string; address: string };
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone);
  const [address, setAddress] = useState(initial.address);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      const result = await updateBusiness({ businessId, name, phone, address });
      if (!result.ok) {
        setError(result.error ?? "تعذر الحفظ");
        return;
      }
      setSaved(true);
      setEditing(false);
    } catch {
      setError("أنت دون اتصال — الحفظ السحابي يتطلب الإنترنت، بيانات البيع تعمل عادي");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary">
            <Building2 className="h-5 w-5" aria-hidden />
          </span>
          <p className="text-sm font-bold">معلومات المشروع</p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="btn-outline !px-3 !py-2 text-xs"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            تعديل
          </button>
        )}
      </div>

      {!editing ? (
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs text-muted">الاسم</dt>
            <dd className="font-medium">{name || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">الهاتف</dt>
            <dd className="font-medium" dir="ltr">{phone || "—"}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-muted">العنوان</dt>
            <dd className="font-medium">{address || "—"}</dd>
          </div>
        </dl>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold" htmlFor="biz-name">اسم المشروع</label>
            <input
              id="biz-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold" htmlFor="biz-phone">الهاتف</label>
            <input
              id="biz-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className={`${inputClass} num`}
              dir="ltr"
              inputMode="tel"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold" htmlFor="biz-address">العنوان</label>
            <input
              id="biz-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              className={inputClass}
            />
          </div>
          {error && <p className="text-xs font-medium text-danger">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={busy}
              className="btn-primary"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
              حفظ
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
                setName(initial.name);
                setPhone(initial.phone);
                setAddress(initial.address);
              }}
              className="btn-outline"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {saved && !editing && (
        <p className="text-xs font-medium text-primary">حُفظت معلومات المشروع</p>
      )}
    </div>
  );
}
