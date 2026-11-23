"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { Boxes, Store } from "lucide-react";
import { getDB } from "@/core/db/db";
import { LoadingScreen } from "@/components/loading-screen";
import { ProductsPageClient } from "@/features/inventory/components/products-page-client";

export function ProductsGate({ canManage = true }: { canManage?: boolean }) {
  const searchParams = useSearchParams();
  const barcodeParam = searchParams.get("barcode") ?? "";
  const [autoOpen, setAutoOpen] = useState<string | null>(barcodeParam || null);

  useEffect(() => {
    if (barcodeParam) setAutoOpen(barcodeParam);
  }, [barcodeParam]);

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
          <Boxes className="h-6 w-6" aria-hidden />
        </div>
        <p className="text-sm leading-relaxed text-muted">
          لا يوجد مشروع نشط على هذا الجهاز — أكمل إعداد المشروع لتفعيل المنتجات.
        </p>
        <Link href="/onboarding" className="btn-primary">
          إعداد المشروع
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center gap-2 text-xs text-muted">
        <Store className="h-3.5 w-3.5" aria-hidden />
        نطاق المنتجات: {business.name}
      </div>
      <ProductsPageClient
        business={{
          id: business.id,
          name: business.name,
          currency: business.currency
        }}
        canManage={canManage}
        autoOpenBarcode={autoOpen ?? undefined}
      />
    </div>
  );
}
