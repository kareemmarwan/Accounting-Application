"use client";

import { useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Store } from "lucide-react";
import { getDB } from "@/core/db/db";
import { ExpenseForm } from "@/features/expenses/components/expense-form";
import { ExpensesList } from "@/features/expenses/components/expenses-list";

export function ExpensesPageClient() {
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
  const categories = useLiveQuery(() => getDB().expenseCategories.toArray(), []);

  const sortedBusinesses = [...(businesses ?? [])].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
  );
  const business = sortedBusinesses[0] ?? null;

  if (businesses === undefined) {
    return <div className="card p-8 text-sm text-muted">جارٍ التحميل...</div>;
  }

  if (!business) {
    return (
      <div className="card flex flex-col items-start gap-4">
        <div className="inline-flex rounded-xl bg-primary-50 p-3 text-primary">
          <Store className="h-6 w-6" aria-hidden />
        </div>
        <p className="text-sm leading-relaxed text-muted">
          لا يوجد مشروع نشط على هذا الجهاز — أكمل إعداد المشروع لتسجيل
          المصروفات بتصنيفاتها المحاسبية.
        </p>
        <Link href="/onboarding" className="btn-primary">
          إعداد المشروع
        </Link>
      </div>
    );
  }

  const sortedCategories = [...(categories ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">المصروفات</h1>
          <p className="text-sm text-muted">
            مصروفات تشغيلية بتصنيفات محاسبية — تُقيَّد فوراً وتُحفظ على جهازك
            حتى دون إنترنت
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFormOpen((open) => !open)}
          className="btn-primary"
        >
          <Plus className="h-4 w-4" aria-hidden />
          {formOpen ? "إخفاء النموذج" : "مصروف جديد"}
        </button>
      </div>

      {formOpen && (
        <ExpenseForm
          key={refreshKey}
          businessId={business.id}
          categories={sortedCategories}
          accounts={(accounts ?? []).map((account) => ({
            id: account.id,
            name: account.name,
            type: account.type
          }))}
          onCreated={() => setRefreshKey((key) => key + 1)}
        />
      )}

      <ExpensesList refreshKey={refreshKey} />
    </div>
  );
}
