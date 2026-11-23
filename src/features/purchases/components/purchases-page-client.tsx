"use client";

import { useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Store } from "lucide-react";
import { LoadingScreen } from "@/components/loading-screen";
import { getDB } from "@/core/db/db";
import { PurchaseForm } from "@/features/purchases/components/purchase-form";
import { PurchasesList } from "@/features/purchases/components/purchases-list";

export function PurchasesPageClient() {
  const [formOpen, setFormOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const businesses = useLiveQuery(() => getDB().businesses.toArray(), []);
  const accounts = useLiveQuery(
    () =>
      getDB().financialAccounts
        .filter((account) => account.isActive && !account.deletedAt)
        .toArray(),
    []
  );
  const suppliers = useLiveQuery(
    () => getDB().suppliers.filter((supplier) => !supplier.deletedAt).toArray(),
    []
  );

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
          <Store className="h-6 w-6" aria-hidden />
        </div>
        <p className="text-sm leading-relaxed text-muted">
          لا يوجد مشروع نشط على هذا الجهاز — أكمل إعداد المشروع لتفعيل
          المشتريات والحسابات المالية.
        </p>
        <Link href="/onboarding" className="btn-primary">
          إعداد المشروع
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">المشتريات</h1>
          <p className="text-sm text-muted">
            فواتير الشراء لـ {business.name} — الآجل لا يخصم أي حساب حتى
            الدفع الفعلي، وتُحفظ على جهازك حتى دون إنترنت
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFormOpen((open) => !open)}
          className="btn-primary"
        >
          <Plus className="h-4 w-4" aria-hidden />
          {formOpen ? "إخفاء النموذج" : "شراء جديد"}
        </button>
      </div>

      {formOpen && (
        <PurchaseForm
          key={refreshKey}
          businessId={business.id}
          suppliers={(suppliers ?? []).map((supplier) => ({
            id: supplier.id,
            name: supplier.name
          }))}
          accounts={(accounts ?? []).map((account) => ({
            id: account.id,
            name: account.name,
            type: account.type
          }))}
          onCreated={() => setRefreshKey((key) => key + 1)}
        />
      )}

      <PurchasesList refreshKey={refreshKey} />
    </div>
  );
}
