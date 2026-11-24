"use client";

import { useEffect, useState } from "react";
import { HardDrive, Loader2 } from "lucide-react";
import { getDB } from "@/core/db/db";

interface StorageInfoState {
  persisted: boolean | null;
  usageMB: string | null;
  quotaMB: string | null;
}

interface Counts {
  businesses: number;
  sales: number;
  products: number;
  debts: number;
  pendingOps: number;
}

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;
}

export function DeviceStorageCard() {
  const [storage, setStorage] = useState<StorageInfoState>({
    persisted: null,
    usageMB: null,
    quotaMB: null
  });
  const [counts, setCounts] = useState<Counts | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);

    const loadCounts = async () => {
      const db = getDB();
      const [businesses, sales, products, debts, pendingOps] = await Promise.all([
        db.businesses.count(),
        db.sales.count(),
        db.products.count(),
        db.debts.count(),
        db.outbox.filter((item) => item.status !== "failed" || item.attempts < 12).count()
      ]);
      setCounts({ businesses, sales, products, debts, pendingOps });
    };
    void loadCounts().catch(() => undefined);

    if (!navigator.storage) {
      setStorage({ persisted: false, usageMB: null, quotaMB: null });
      return;
    }
    void navigator.storage
      .persisted()
      .then((persisted) =>
        setStorage((prev) => ({ ...prev, persisted }))
      )
      .catch(() => undefined);
    void navigator.storage
      .estimate()
      .then((estimate) =>
        setStorage((prev) => ({
          ...prev,
          usageMB:
            typeof estimate.usage === "number" ? formatMB(estimate.usage) : null,
          quotaMB:
            typeof estimate.quota === "number" ? formatMB(estimate.quota) : null
        }))
      )
      .catch(() => undefined);
  }, []);

  async function requestPersistence() {
    setRequesting(true);
    try {
      const granted = await navigator.storage?.persist();
      setStorage((prev) => ({ ...prev, persisted: Boolean(granted) }));
    } catch {
      void 0;
    } finally {
      setRequesting(false);
    }
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary">
          <HardDrive className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-bold">بيانات هذا الجهاز</p>
          <p className="text-xs text-muted">
            كل العمليات محفوظة على جهازك وتُزامَن مع السحابة عند توفر الإنترنت
          </p>
        </div>
      </div>

      {counts === null ? (
        <p className="flex items-center gap-2 text-xs text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          جارٍ قراءة التخزين المحلي…
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted">المشاريع</dt>
              <dd className="font-medium">{counts.businesses}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">الفواتير</dt>
              <dd className="font-medium">{counts.sales}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">المنتجات</dt>
              <dd className="font-medium">{counts.products}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">بانتظار المزامنة</dt>
              <dd className="font-medium">{counts.pendingOps}</dd>
            </div>
          </dl>

          <ul className="space-y-1 text-xs text-muted">
            {origin && (
              <li dir="ltr" className="truncate text-start">
                العنوان: {origin}
              </li>
            )}
            {storage.usageMB && storage.quotaMB && (
              <li>
                المساحة المستخدمة: {storage.usageMB} من {storage.quotaMB}
              </li>
            )}
            <li>
              {storage.persisted === null
                ? "حالة التخزين الدائم: جارٍ الفحص…"
                : storage.persisted
                  ? "التخزين الدائم مفعّل — المتصفح لن يحذف البيانات تلقائياً"
                  : "التخزين الدائم غير مفعّل — فعّله لضمان عدم حذف البيانات تلقائياً عند امتلاء المساحة"}
            </li>
            {counts.businesses === 0 && (
              <li className="font-medium text-warning">
                لا يوجد مشروع مخزّن على هذا الجهاز — افتح التطبيق والاتصال متوفر
                مرة واحدة ليُسحب مشروعك تلقائياً
              </li>
            )}
          </ul>

          {storage.persisted === false && (
            <button
              type="button"
              onClick={() => void requestPersistence()}
              disabled={requesting}
              className="btn-outline"
            >
              {requesting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              تفعيل التخزين الدائم
            </button>
          )}
        </>
      )}
    </div>
  );
}
