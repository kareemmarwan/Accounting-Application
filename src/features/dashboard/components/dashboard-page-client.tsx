"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { LoadingScreen } from "@/components/loading-screen";
import {
  ArrowDownCircle,
  Banknote,
  BookOpen,
  HandCoins,
  PiggyBank,
  Plus,
  Receipt,
  ShoppingBag,
  Store,
  TrendingUp,
  Wallet
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { getDB } from "@/core/db/db";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import {
  loadDashboardData,
  PERIOD_LABELS,
  type DashboardData,
  type DashboardPeriod
} from "@/features/dashboard/services/dashboard-service";

const PERIOD_COLORS = ["#16A34A", "#0F172A", "#F59E0B", "#64748B", "#DC2626", "#38BDF8"];

function toChartMinor(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

const CHART_TOOLTIPS = {
  contentStyle: {
    direction: "ltr" as const,
    borderRadius: 12,
    fontSize: 12,
    border: "1px solid #E2E8F0"
  },
  formatter: (value: number | string) => formatCurrency(Number(value))
};

export function DashboardPageClient() {
  const [period, setPeriod] = useState<DashboardPeriod>("month");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const businesses = useLiveQuery(() => getDB().businesses.toArray(), []);
  const business = useMemo(() => {
    const sorted = [...(businesses ?? [])].sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
    );
    return sorted[0] ?? null;
  }, [businesses]);

  const [refreshTick, setRefreshTick] = useState(0);
  const salesLive = useLiveQuery(() => getDB().sales.count(), []);
  const expensesLive = useLiveQuery(() => getDB().expenses.count(), []);
  useEffect(() => {
    setRefreshTick((tick) => tick + 1);
  }, [salesLive, expensesLive]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadDashboardData(period)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period, refreshTick]);

  if (businesses === undefined || (loading && !data)) {
    return <LoadingScreen />;
  }

  if (!business) {
    return (
      <div className="card flex flex-col items-start gap-4">
        <div className="inline-flex rounded-xl bg-primary-50 p-3 text-primary">
          <Store className="h-6 w-6" aria-hidden />
        </div>
        <p className="text-sm leading-relaxed text-muted">
          مرحباً بك في المساعد المالي — أكمل إعداد مشروعك (دقيقة واحدة) لتبدأ
          تسجيل العمليات محلياً حتى دون إنترنت.
        </p>
        <Link href="/onboarding" className="btn-primary">
          إعداد المشروع
        </Link>
      </div>
    );
  }

  const cards = data?.cards;
  const balances = data?.balances;

  const stats = [
    {
      label: "المبيعات",
      value: toChartMinor([cards?.sales ?? 0]),
      icon: BookOpen,
      tone: "text-primary"
    },
    {
      label: "المشتريات",
      value: toChartMinor([cards?.purchases ?? 0]),
      icon: ShoppingBag,
      tone: "text-warning"
    },
    {
      label: "المصروفات",
      value: toChartMinor([cards?.expenses ?? 0]),
      icon: Receipt,
      tone: "text-danger"
    },
    {
      label: "الربح التقديري*",
      value: toChartMinor([cards?.estimatedProfit ?? 0]),
      icon: PiggyBank,
      tone: (cards?.estimatedProfit ?? 0) >= 0 ? "text-primary" : "text-danger"
    },
    {
      label: "ديون العملاء",
      value: toChartMinor([balances?.customerDebts ?? 0]),
      icon: HandCoins,
      tone: "text-danger"
    },
    {
      label: "مستحقات الموردين",
      value: toChartMinor([balances?.supplierDues ?? 0]),
      icon: Banknote,
      tone: "text-warning"
    },
    {
      label: "الصندوق النقدي",
      value: toChartMinor([balances?.cash ?? 0]),
      icon: Wallet,
      tone: "text-primary"
    },
    {
      label: "البنوك والمحافظ",
      value: toChartMinor([balances?.banks ?? 0]),
      icon: Banknote,
      tone: "text-primary"
    },
    {
      label: "إجمالي الأرصدة",
      value: toChartMinor([balances?.total ?? 0]),
      icon: ArrowDownCircle,
      tone: "text-primary"
    },
    {
      label: "عدد عمليات البيع",
      value: null,
      count: cards?.salesCount ?? 0,
      icon: TrendingUp,
      tone: "text-primary"
    }
  ];

  const dailyChart = (data?.daily ?? []).map((point) => ({
    ...point,
    label: point.date.slice(5)
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">لوحة التحكم</h1>
          <p className="text-sm text-muted">
            نظرة شاملة على الوضع المالي لمشروعك — {business.name}
          </p>
        </div>
        <div className="flex gap-1.5">
          {(Object.keys(PERIOD_LABELS) as DashboardPeriod[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setPeriod(key)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                period === key
                  ? "border-primary bg-primary-50 text-primary-800"
                  : "border-border bg-surface hover:border-primary-200"
              }`}
            >
              {PERIOD_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      <div className="card flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-bold">إجراءات سريعة</p>
          <p className="text-xs text-muted">
            سجّل عملياتك بقيد محاسبي متوازن تلقائياً — تعمل دون إنترنت
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/sales" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            بيع جديد
          </Link>
          <Link href="/purchases" className="btn-outline">
            <ShoppingBag className="h-4 w-4" aria-hidden />
            شراء جديد
          </Link>
          <Link href="/debts" className="btn-outline">
            <HandCoins className="h-4 w-4" aria-hidden />
            تسجيل دفعة
          </Link>
          <Link href="/expenses" className="btn-outline">
            <Receipt className="h-4 w-4" aria-hidden />
            مصروف جديد
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((stat) => (
          <div key={stat.label} className="card flex flex-col gap-2 !p-4">
            <div className="flex items-center gap-2 text-xs font-medium text-muted">
              <stat.icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{stat.label}</span>
            </div>
            {stat.value === null ? (
              <span className="stat-value">{stat.count}</span>
            ) : (
              <span className={`stat-value ${stat.tone}`}>
                {formatCurrency(stat.value)}
              </span>
            )}
          </div>
        ))}
      </div>

      <p className="text-xs text-muted">
        * الربح التقديري = مبيعات − مشتريات − مصروفات (أساس نقدي/تقديري — ليس
        استحقاقياً)
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card !p-4">
          <p className="mb-3 text-sm font-bold">المبيعات والمشتريات والمصروفات — آخر 30 يوماً</p>
          <div className="h-64" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickFormatter={(value: number) => `${Math.round(value / 100)}`}
                />
                <Tooltip {...CHART_TOOLTIPS} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="sales" name="مبيعات" stroke="#16A34A" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="purchases" name="مشتريات" stroke="#0F172A" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="expenses" name="مصروفات" stroke="#DC2626" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card !p-4">
          <p className="mb-3 text-sm font-bold">مقارنة آخر 6 أشهر</p>
          <div className="h-64" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.monthly ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickFormatter={(value: number) => `${Math.round(value / 100)}`}
                />
                <Tooltip {...CHART_TOOLTIPS} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="sales" name="مبيعات" fill="#16A34A" radius={[4, 4, 0, 0]} />
                <Bar dataKey="purchases" name="مشتريات" fill="#0F172A" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" name="مصروفات" fill="#DC2626" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card !p-4">
          <p className="mb-3 text-sm font-bold">توزيع المصروفات حسب التصنيف</p>
          {(data?.expenseByCategory.length ?? 0) === 0 ? (
            <p className="py-16 text-center text-sm text-muted">لا مصروفات في الفترة المحددة</p>
          ) : (
            <div className="h-64" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data?.expenseByCategory}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={85}
                    paddingAngle={2}
                  >
                    {(data?.expenseByCategory ?? []).map((entry, index) => (
                      <Cell key={entry.name} fill={PERIOD_COLORS[index % PERIOD_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip {...CHART_TOOLTIPS} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card !p-4">
          <p className="mb-3 text-sm font-bold">وسائل الدفع (المبالغ المحصلة)</p>
          {(data?.paymentMethods.length ?? 0) === 0 ? (
            <p className="py-16 text-center text-sm text-muted">لا تحصيلات في الفترة المحددة</p>
          ) : (
            <div className="h-64" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.paymentMethods} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(value: number) => `${Math.round(value / 100)}`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
                  <Tooltip {...CHART_TOOLTIPS} />
                  <Bar dataKey="value" name="المحصّل" fill="#16A34A" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <p className="mb-3 text-sm font-bold">النشاط الأخير</p>
        {(data?.activity.length ?? 0) === 0 ? (
          <p className="py-8 text-center text-sm text-muted">لا نشاط في الفترة المحددة</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {(data?.activity ?? []).map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
              >
                <span className="flex items-center gap-2">
                  {item.kind === "sale" && <BookOpen className="h-4 w-4 text-primary" aria-hidden />}
                  {item.kind === "purchase" && <ShoppingBag className="h-4 w-4 text-warning" aria-hidden />}
                  {item.kind === "expense" && <Receipt className="h-4 w-4 text-danger" aria-hidden />}
                  {item.kind === "payment" && <HandCoins className="h-4 w-4 text-primary" aria-hidden />}
                  <span className="font-medium">{item.title}</span>
                  <span className="text-xs text-muted">{formatDateTime(item.occurredAt)}</span>
                </span>
                <span className="num font-bold">{formatCurrency(item.amountMinor)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-muted">
        تاريخ آخر تحديث: {data ? formatDate(data.daily[data.daily.length - 1]?.date ?? new Date().toISOString()) : "—"}
      </p>
    </div>
  );
}
