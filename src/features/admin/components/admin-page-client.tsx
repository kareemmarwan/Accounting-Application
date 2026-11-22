"use client";

import { useState } from "react";
import { Ban, CalendarPlus, Check, ShieldCheck, X } from "lucide-react";
import {
  adminActivateSubscription,
  adminCancelSubscription,
  adminExtendTrial,
  adminRejectRequest
} from "@/features/admin/server/actions";
import type { AdminOverview } from "@/features/admin/services/admin-service";
import {
  computeEffectivePlan,
  isPaidPlanId,
  PLANS,
  type PaidPlanId
} from "@/features/subscription/plans";

const STATUS_LABELS: Record<string, string> = {
  trialing: "تجربة",
  active: "فعّال",
  past_due: "متأخر",
  canceled: "موقوف"
};

const STATUS_STYLES: Record<string, string> = {
  trialing: "border-warning/40 bg-warning/10 text-warning",
  active: "border-primary/40 bg-primary-50 text-primary-800",
  past_due: "border-danger/40 bg-danger/10 text-danger",
  canceled: "border-border bg-muted/10 text-muted"
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function planLabel(plan: string): string {
  return PLANS[plan as keyof typeof PLANS]?.label ?? plan;
}

function trialDaysLeft(trialEndsAt: string | null): number {
  if (!trialEndsAt) return 0;
  return Math.max(0, Math.ceil((Date.parse(trialEndsAt) - Date.now()) / 86_400_000));
}

type Feedback = { type: "ok" | "err"; text: string };
type ActionResult = { ok: boolean; error?: string };

const inputClass =
  "rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

export function AdminPageClient({ overview }: { overview: AdminOverview }) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [planChoices, setPlanChoices] = useState<Record<string, string>>({});
  const [monthChoices, setMonthChoices] = useState<Record<string, string>>({});

  const requestsByBusiness = new Map(
    overview.requests.map((request) => [request.businessId, request])
  );

  async function run(
    action: () => Promise<ActionResult>,
    okText: string
  ): Promise<void> {
    setBusy(true);
    setFeedback(null);
    const result = await action();
    setBusy(false);
    setFeedback(
      result.ok
        ? { type: "ok", text: okText }
        : { type: "err", text: result.error ?? "حدث خطأ غير متوقع" }
    );
  }

  function planFor(businessId: string, fallback: string): PaidPlanId {
    const chosen = planChoices[businessId];
    if (chosen && isPaidPlanId(chosen)) return chosen;
    return isPaidPlanId(fallback) ? fallback : "basic";
  }

  function monthsFor(businessId: string): number {
    const value = Number(monthChoices[businessId] ?? 1);
    if (!Number.isFinite(value)) return 1;
    return Math.min(36, Math.max(1, Math.round(value)));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-lg font-bold">لوحة إدارة المنصة</h1>
          <p className="text-xs text-muted">
            {overview.businesses.length} مشروع — {overview.requests.length} طلب
            معلق
          </p>
        </div>
      </div>

      {feedback && (
        <div
          role="status"
          className={`flex items-center gap-2 rounded-xl border p-3 text-xs font-medium ${
            feedback.type === "ok"
              ? "border-primary/40 bg-primary-50 text-primary-800"
              : "border-danger/40 bg-danger/10 text-danger"
          }`}
        >
          {feedback.type === "ok" ? (
            <Check className="h-4 w-4" aria-hidden />
          ) : (
            <X className="h-4 w-4" aria-hidden />
          )}
          {feedback.text}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-bold">طلبات الترقية المعلقة</h2>
        {overview.requests.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface p-3 text-xs text-muted">
            لا توجد طلبات معلقة حالياً
          </p>
        ) : (
          overview.requests.map((request) => (
            <div
              key={request.id}
              className="card flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div>
                <p className="text-sm font-bold">{request.businessName}</p>
                <p className="text-xs text-muted">
                  يطلب الخطة {planLabel(request.plan)} — بتاريخ{" "}
                  {formatDate(request.requestedAt)}
                  {request.requesterName ? ` — بواسطة ${request.requesterName}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className="btn-primary"
                  onClick={() =>
                    run(
                      () =>
                        adminActivateSubscription({
                          businessId: request.businessId,
                          plan: isPaidPlanId(request.plan) ? request.plan : "basic",
                          months: 1,
                          requestId: request.id
                        }),
                      "تم تفعيل الاشتراك لشهر واحد"
                    )
                  }
                >
                  <Check className="h-4 w-4" aria-hidden />
                  موافقة (شهر)
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="btn-outline text-danger"
                  onClick={() =>
                    run(
                      () => adminRejectRequest({ requestId: request.id }),
                      "تم رفض الطلب"
                    )
                  }
                >
                  <X className="h-4 w-4" aria-hidden />
                  رفض
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold">كل المشاريع</h2>
        {overview.businesses.map((business) => {
          const effectivePlan = computeEffectivePlan(
            business.plan,
            business.subscriptionStatus,
            business.trialEndsAt
          );
          const pendingRequest = requestsByBusiness.get(business.id);
          const planChoice = planFor(business.id, business.plan);
          const daysLeft = trialDaysLeft(business.trialEndsAt);

          return (
            <div key={business.id} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold">{business.name}</p>
                  <p className="text-xs text-muted">
                    {business.ownerEmail || business.ownerName || business.ownerId}
                  </p>
                </div>
                <span
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${
                    STATUS_STYLES[business.subscriptionStatus] ??
                    STATUS_STYLES.canceled
                  }`}
                >
                  {STATUS_LABELS[business.subscriptionStatus] ??
                    business.subscriptionStatus}
                  {business.subscriptionStatus === "trialing" && daysLeft > 0
                    ? ` — ${daysLeft} يوم`
                    : ""}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-1 text-xs text-muted sm:grid-cols-4">
                <span>
                  الخطة الفعّالة:{" "}
                  <b className="text-foreground">{planLabel(effectivePlan)}</b>
                </span>
                <span>
                  الأعضاء:{" "}
                  <b className="text-foreground">{business.activeMembers}</b>
                </span>
                <span>انتهاء التجربة: {formatDate(business.trialEndsAt)}</span>
                <span>أُنشئ: {formatDate(business.createdAt)}</span>
              </div>

              {pendingRequest && (
                <p className="mt-3 rounded-xl border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
                  طلب ترقية معلق إلى {planLabel(pendingRequest.plan)}
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <label className="sr-only" htmlFor={`plan-${business.id}`}>
                  الخطة
                </label>
                <select
                  id={`plan-${business.id}`}
                  className={`${inputClass} w-36`}
                  value={planChoice}
                  disabled={busy}
                  onChange={(event) =>
                    setPlanChoices((prev) => ({
                      ...prev,
                      [business.id]: event.target.value
                    }))
                  }
                >
                  {(["basic", "pro", "business"] as const).map((plan) => (
                    <option key={plan} value={plan}>
                      {PLANS[plan].label} — {PLANS[plan].priceShekel}₪
                    </option>
                  ))}
                </select>
                <label className="sr-only" htmlFor={`months-${business.id}`}>
                  المدة بالأشهر
                </label>
                <input
                  id={`months-${business.id}`}
                  type="number"
                  dir="ltr"
                  min={1}
                  max={36}
                  className={`${inputClass} num w-20`}
                  value={monthChoices[business.id] ?? 1}
                  disabled={busy}
                  onChange={(event) =>
                    setMonthChoices((prev) => ({
                      ...prev,
                      [business.id]: event.target.value
                    }))
                  }
                />
                <button
                  type="button"
                  disabled={busy}
                  className="btn-primary"
                  onClick={() =>
                    run(
                      () =>
                        adminActivateSubscription({
                          businessId: business.id,
                          plan: planChoice,
                          months: monthsFor(business.id),
                          requestId: pendingRequest?.id ?? null
                        }),
                      `تم تفعيل ${planLabel(planChoice)} لـ${monthsFor(business.id)} شهر`
                    )
                  }
                >
                  {pendingRequest ? "موافقة على الطلب" : "تفعيل الخطة"}
                </button>
                {business.subscriptionStatus !== "active" && (
                  <button
                    type="button"
                    disabled={busy}
                    className="btn-outline"
                    onClick={() =>
                      run(
                        () =>
                          adminExtendTrial({
                            businessId: business.id,
                            days: 30
                          }),
                        "تم تمديد التجربة 30 يوماً"
                      )
                    }
                  >
                    <CalendarPlus className="h-4 w-4" aria-hidden />
                    تمديد التجربة +30
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  className="btn-outline text-danger"
                  onClick={() =>
                    run(
                      () => adminCancelSubscription({ businessId: business.id }),
                      "تم إيقاف الاشتراك وعودة المشروع للخطة المجانية"
                    )
                  }
                >
                  <Ban className="h-4 w-4" aria-hidden />
                  إيقاف الاشتراك
                </button>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
