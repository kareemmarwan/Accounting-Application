"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { ScanBarcode, Store } from "lucide-react";
import { getDB } from "@/core/db/db";
import { LoadingScreen } from "@/components/loading-screen";
import { PosTerminal } from "@/features/pos/components/pos-terminal";

export function PosPageClient() {
  const businesses = useLiveQuery(() => getDB().businesses.toArray(), []);

  const sortedBusinesses = [...(businesses ?? [])].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
  );
  const business = sortedBusinesses[0] ?? null;

  if (businesses === undefined) {
    return <LoadingScreen />;
  }

  if (!business) {
    return (
      <div className="card flex flex-col items-start gap-4">
        <div className="inline-flex rounded-xl bg-primary-50 p-3 text-primary">
          <ScanBarcode className="h-6 w-6" aria-hidden />
        </div>
        <p className="text-sm leading-relaxed text-muted">
          لا يوجد مشروع نشط على هذا الجهاز — أكمل إعداد المشروع لتفعيل الكاشير.
        </p>
        <Link href="/onboarding" className="btn-primary">
          إعداد المشروع
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex items-center gap-2 text-xs text-muted">
        <Store className="h-3.5 w-3.5" aria-hidden />
        نطاق الكاشير: {business.name}
      </div>
      <PosTerminal
        business={{
          id: business.id,
          name: business.name,
          businessType: business.businessType,
          currency: business.currency
        }}
      />
    </div>
  );
}
