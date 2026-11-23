"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { LoadingScreen } from "@/components/loading-screen";
import {
  Pencil,
  Plus,
  Search,
  Store,
  Trash2,
  Users,
  BookText,
  ChevronLeft
} from "lucide-react";
import { getDB, type LocalParty } from "@/core/db/db";
import { formatCurrency, formatDateTime } from "@/lib/format";
import {
  CONTACT_TYPE_LABELS,
  type ContactType
} from "@/core/validation/contact";
import { ContactForm } from "@/features/contacts/components/contact-form";
import { ContactLedger } from "@/features/contacts/components/contact-ledger";
import {
  softDeleteContact
} from "@/features/contacts/services/contacts-service";

type Tab = ContactType | "debt_book";

const TAB_LABELS: Record<Tab, string> = {
  customer: "العملاء",
  supplier: "الموردون",
  debt_book: "دفتر دين"
};

const DEBT_BOOK_ICON = BookText;

export function ContactsPageClient() {
  const [tab, setTab] = useState<Tab>("customer");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<LocalParty | null>(null);
  const [ledgerParty, setLedgerParty] = useState<LocalParty | null>(null);
  const [ledgerType, setLedgerType] = useState<ContactType>("customer");
  const [rowError, setRowError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  function openLedger(party: LocalParty, type: ContactType) {
    setLedgerType(type);
    setLedgerParty(party);
  }

  const businesses = useLiveQuery(() => getDB().businesses.toArray(), []);
  const business = useMemo(() => {
    const sorted = [...(businesses ?? [])].sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
    );
    return sorted[0] ?? null;
  }, [businesses]);

  const customers = useLiveQuery(
    () => getDB().customers.toArray(),
    [refreshKey]
  );
  const suppliers = useLiveQuery(
    () => getDB().suppliers.toArray(),
    [refreshKey]
  );

  const activeParties: LocalParty[] = useMemo(() => {
    const type: ContactType | null =
      tab === "customer" ? "customer" : tab === "supplier" ? "supplier" : null;
    const source = type === "customer" ? customers : suppliers;
    const list = (source ?? []).filter((party) => !party.deletedAt);
    return list.sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [tab, customers, suppliers]);

  const filtered = useMemo(() => {
    const query = search.trim();
    if (!query) return activeParties;
    return activeParties.filter(
      (party) =>
        party.name.includes(query) ||
        (party.phone ?? "").includes(query)
    );
  }, [activeParties, search]);

  const debtBookRows = useMemo(() => {
    const rows: Array<LocalParty & { partyType: ContactType }> = [
      ...(customers ?? [])
        .filter((party) => !party.deletedAt && party.currentBalanceMinor !== 0)
        .map((party) => ({ ...party, partyType: "customer" as ContactType })),
      ...(suppliers ?? [])
        .filter((party) => !party.deletedAt && party.currentBalanceMinor !== 0)
        .map((party) => ({ ...party, partyType: "supplier" as ContactType }))
    ];
    return rows.sort(
      (a, b) => Math.abs(b.currentBalanceMinor) - Math.abs(a.currentBalanceMinor)
    );
  }, [customers, suppliers]);

  const debtBookTotals = useMemo(() => {
    let receivable = 0;
    let payable = 0;
    for (const row of debtBookRows) {
      if (row.partyType === "customer" && row.currentBalanceMinor > 0) {
        receivable += row.currentBalanceMinor;
      }
      if (row.partyType === "supplier" && row.currentBalanceMinor > 0) {
        payable += row.currentBalanceMinor;
      }
    }
    return { receivable, payable };
  }, [debtBookRows]);

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
          لا يوجد مشروع نشط على هذا الجهاز — أكمل إعداد المشروع أولاً
        </p>
        <Link href="/onboarding" className="btn-primary">
          إعداد المشروع
        </Link>
      </div>
    );
  }

  async function handleDelete(party: LocalParty) {
    setRowError(null);
    const type: ContactType = tab === "supplier" ? "supplier" : "customer";
    if (!window.confirm(`حذف «${party.name}»؟ لا يمكن الحذف برصيد غير صفري.`)) {
      return;
    }
    try {
      await softDeleteContact(party.id, type);
      setRefreshKey((key) => key + 1);
    } catch (deleteError) {
      setRowError(
        deleteError instanceof Error ? deleteError.message : "تعذر الحذف"
      );
    }
  }

  const tabCount = (table: LocalParty[] | undefined) =>
    (table ?? []).filter((party) => !party.deletedAt && party.currentBalanceMinor !== 0)
      .length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">العملاء والموردون</h1>
          <p className="text-sm text-muted">
            ملف كامل لكل جهة مع دفتر دين يعرض كل حركة ورصيدها
          </p>
        </div>
        {tab !== "debt_book" && (
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
            className="btn-primary"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {tab === "customer" ? "عميل جديد" : "مورد جديد"}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(TAB_LABELS) as Tab[]).map((key) => {
          const Icon = key === "debt_book" ? DEBT_BOOK_ICON : Users;
          const count =
            key === "debt_book"
              ? debtBookRows.length
              : tabCount(key === "customer" ? customers : suppliers);
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                setTab(key);
                setLedgerParty(null);
                setRowError(null);
              }}
              className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                tab === key
                  ? "border-primary bg-primary-50 text-primary-800"
                  : "border-border bg-surface hover:border-primary-200"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {TAB_LABELS[key]}
              {count > 0 && (
                <span className="rounded-full bg-muted-foreground/10 px-2 py-0.5 text-[11px] font-bold">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab !== "debt_book" && (
        <div className="relative max-w-sm">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="بحث بالاسم أو الهاتف..."
            className="input ps-9"
          />
        </div>
      )}

      {rowError && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
          {rowError}
        </div>
      )}

      {showForm && (
        <ContactForm
          type={tab === "supplier" ? "supplier" : "customer"}
          businessId={business.id}
          existing={editing}
          onDone={() => {
            setShowForm(false);
            setEditing(null);
            setRefreshKey((key) => key + 1);
          }}
        />
      )}

              {tab === "debt_book" ? (
        <DebtBook
          rows={debtBookRows}
          totals={debtBookTotals}
          onOpenLedgerDirect={(party, type) => openLedger(party, type)}
        />
      ) : filtered.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 py-10 text-center">
          <div className="inline-flex rounded-xl bg-primary-50 p-3 text-primary">
            <Users className="h-6 w-6" aria-hidden />
          </div>
          <p className="text-sm text-muted">
            {search
              ? "لا نتائج مطابقة للبحث"
              : tab === "customer"
                ? "لا عملاء بعد — أضف أول عميل"
                : "لا موردين بعد — أضف أول مورد"}
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted">
                <th className="py-2 text-start font-medium">الاسم</th>
                <th className="py-2 text-start font-medium">الهاتف</th>
                <th className="py-2 text-start font-medium">الرصيد الحالي</th>
                <th className="py-2 text-start font-medium">إجمالي التعاملات</th>
                <th className="py-2 text-start font-medium">آخر تعامل</th>
                <th className="py-2 text-start font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((party) => (
                <tr key={party.id} className="border-b border-border/60">
                  <td className="py-2.5 font-medium">{party.name}</td>
                  <td className="py-2.5 text-muted">
                    {party.phone ? (
                      <span className="num" dir="ltr">
                        {party.phone}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2.5">
                    <span
                      className={`num font-bold ${
                        party.currentBalanceMinor > 0
                          ? tab === "customer"
                            ? "text-danger"
                            : "text-warning"
                          : "text-primary"
                      }`}
                    >
                      {formatCurrency(party.currentBalanceMinor)}
                    </span>
                  </td>
                  <td className="num py-2.5">
                    {formatCurrency(party.totalTransactionsMinor)}
                  </td>
                  <td className="py-2.5 text-xs text-muted">
                    {party.lastTransactionAt
                      ? formatDateTime(party.lastTransactionAt)
                      : "—"}
                  </td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          openLedger(
                            party,
                            tab === "supplier" ? "supplier" : "customer"
                          )
                        }
                        className="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary-700"
                      >
                        دفتر دين
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(party);
                          setShowForm(true);
                        }}
                        className="rounded-lg border border-border px-2 py-1.5 text-xs font-medium hover:bg-muted-foreground/10"
                        aria-label="تعديل"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(party)}
                        className="rounded-lg border border-danger/40 px-2 py-1.5 text-xs font-medium text-danger hover:bg-danger/10"
                        aria-label="حذف"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ledgerParty && business && (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-background/70 p-4 backdrop-blur-sm">
          <div className="mx-auto max-w-3xl py-6">
            <ContactLedger
              party={ledgerParty}
              type={ledgerType}
              businessId={business.id}
              onClose={() => setLedgerParty(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function DebtBook({
  rows,
  totals,
  onOpenLedgerDirect
}: {
  rows: Array<LocalParty & { partyType: ContactType }>;
  totals: { receivable: number; payable: number };
  onOpenLedgerDirect: (party: LocalParty & { partyType: ContactType }, type: ContactType) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap gap-6 text-sm">
        <div>
          <p className="text-xs text-muted">ديون العملاء (لنا)</p>
          <p className="num text-lg font-bold text-danger">
            {formatCurrency(totals.receivable)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">مستحقات الموردين (علينا)</p>
          <p className="num text-lg font-bold text-warning">
            {formatCurrency(totals.payable)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">الصافي</p>
          <p
            className={`num text-lg font-bold ${
              totals.receivable - totals.payable >= 0 ? "text-primary" : "text-danger"
            }`}
          >
            {formatCurrency(totals.receivable - totals.payable)}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 py-10 text-center">
          <div className="inline-flex rounded-xl bg-primary-50 p-3 text-primary">
            <DEBT_BOOK_ICON className="h-6 w-6" aria-hidden />
          </div>
          <p className="text-sm text-muted">
            لا أرصدة دين حالياً — الديون تظهر هنا فور تسجيل مبيعات أو مشتريات
            آجلة
          </p>
          <Link href="/debts" className="btn-outline text-xs">
            الانتقال إلى الديون والدفعات
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted">
                <th className="py-2 text-start font-medium">الجهة</th>
                <th className="py-2 text-start font-medium">النوع</th>
                <th className="py-2 text-start font-medium">الرصيد</th>
                <th className="py-2 text-start font-medium">آخر تعامل</th>
                <th className="py-2 text-start font-medium">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60">
                  <td className="py-2.5 font-medium">{row.name}</td>
                  <td className="py-2.5 text-muted">
                    {CONTACT_TYPE_LABELS[row.partyType]}
                  </td>
                  <td className="py-2.5">
                    <span
                      className={`num font-bold ${
                        row.partyType === "customer" ? "text-danger" : "text-warning"
                      }`}
                    >
                      {formatCurrency(row.currentBalanceMinor)}
                    </span>
                  </td>
                  <td className="py-2.5 text-xs text-muted">
                    {row.lastTransactionAt
                      ? formatDateTime(row.lastTransactionAt)
                      : "—"}
                  </td>
                  <td className="py-2.5">
                    <button
                      type="button"
                      onClick={() =>
                        onOpenLedgerDirect(row, row.partyType)
                      }
                      className="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary-700"
                    >
                      كشف الحساب
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
