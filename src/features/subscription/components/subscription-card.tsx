"use client";

import { useState } from "react";
import { Check, Crown, Loader2, ShieldQuestion } from "lucide-react";
import {
  PLANS,
  PAID_PLAN_IDS,
  type PaidPlanId
} from "@/features/subscription/plans";
import type { SubscriptionOverview } from "@/features/subscription/server/actions";
import {
  cancelSubscriptionRequest,
  requestSubscription
} from "@/features/subscription/server/actions";

const PLAN_LABELS: Record<string, string> = {
  free: "مجانية",
  trial: "تجربة مجانية",
  basic: "أساسية",
  pro: "احترافية",
  business: "متعددة المشاريع"
};

export function SubscriptionCard({
  businessId,
  overview
}: {
  businessId: string;
  overview: SubscriptionOverview;
}) {
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);

  async function handleRequest(plan: PaidPlanId) {
    setSubmitting(plan);
    setMessage(null);
    try {
      const result = await requestSubscription({ businessId, plan });
      if (result.ok) {
        setMessage({
          tone: "ok",
          text: `تم تسجيل طلب الاشتراك في الخطة ${PLANS[plan].label} — سيتم التفعيل بعد تأكيد الدفع مع فريق الاشتراكات، ويمكنك متابعة الحالة من هنا.`
        });
        window.setTimeout(() => window.location.reload(), 1800);
      } else {
        setMessage({ tone: "error", text: result.error ?? "تعذر إرسال الطلب" });
      }
    } catch {
      setMessage({ tone: "error", text: "أنت دون اتصال — طلبات الاشتراك تتطلب الإنترنت" });
    } finally {
      setSubmitting(null);
    }
  }

  async function handleCancel() {
    if (!overview.pendingRequest) return;
    setSubmitting("cancel");
    setMessage(null);
    try {
      const result = await cancelSubscriptionRequest({
        businessId,
        subscriptionId: overview.pendingRequest.id
      });
      if (result.ok) {
        setMessage({ tone: "ok", text: "أُلغي طلب الترقية" });
        window.setTimeout(() => window.location.reload(), 1200);
      } else {
        setMessage({ tone: "error", text: result.error ?? "تعذر الإلغاء" });
      }
    } catch {
      setMessage({ tone: "error", text: "أنت دون اتصال — الإلغاء يتطلب الإنترنت" });
    } finally {
      setSubmitting(null);
    }
  }

  const usagePercent = Math.min(
    100,
    Math.round((overview.activeMembers / Math.max(overview.maxMembers, 1)) * 100)
  );

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-warning/10 text-warning">
            <Crown className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-bold">الاشتراك</p>
            <p className="text-xs text-muted">
              {overview.inTrial
                ? `تجربة مجانية — متبقٍ ${overview.trialDaysLeft} يوم`
                : `الخطة الحالية: ${PLAN_LABELS[overview.effectivePlan] ?? overview.effectivePlan}`}
            </p>
          </div>
        </div>
        <div className="text-xs text-muted">
          {overview.activeMembers} / {overview.maxMembers} أعضاء
        </div>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-muted-foreground/10">
        <div
          className={`h-full rounded-full ${
            usagePercent >= 100 ? "bg-danger" : "bg-primary"
          }`}
          style={{ width: `${usagePercent}%` }}
          role="progressbar"
          aria-valuenow={usagePercent}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>

      {overview.pendingRequest && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs">
          <p className="flex items-center gap-2 text-warning">
            <ShieldQuestion className="h-4 w-4" aria-hidden />
            طلب ترقية إلى خطة{" "}
            {PLAN_LABELS[overview.pendingRequest.plan] ?? overview.pendingRequest.plan} قيد
            المعالجة
          </p>
          <button
            type="button"
            onClick={handleCancel}
            disabled={submitting === "cancel"}
            className="btn-outline !px-3 !py-1.5 text-xs"
          >
            إلغاء الطلب
          </button>
        </div>
      )}

      {message && (
        <div
          className={`rounded-xl border p-3 text-xs leading-relaxed ${
            message.tone === "ok"
              ? "border-primary-200 bg-primary-50 text-primary-800"
              : "border-danger/40 bg-danger/10 text-danger"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {PAID_PLAN_IDS.map((planId) => {
          const plan = PLANS[planId];
          const isCurrent = overview.effectivePlan === planId && !overview.inTrial;
          return (
            <div
              key={planId}
              className={`flex flex-col gap-2 rounded-xl border p-4 ${
                isCurrent ? "border-primary bg-primary-50/40" : "border-border"
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold">{plan.label}</p>
                {isCurrent && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
                    <Check className="h-3 w-3" aria-hidden />
                    حالية
                  </span>
                )}
              </div>
              <p className="num text-lg font-bold">
                {plan.priceShekel}{" "}
                <span className="text-xs font-normal text-muted">₪ / شهرياً</span>
              </p>
              <p className="text-xs text-muted">{plan.tagline}</p>
              <button
                type="button"
                onClick={() => handleRequest(planId)}
                disabled={
                  submitting !== null ||
                  isCurrent ||
                  Boolean(overview.pendingRequest)
                }
                className={`mt-auto text-xs ${
                  isCurrent ? "btn-outline" : "btn-primary"
                } !px-3 !py-2`}
              >
                {submitting === planId ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : isCurrent ? (
                  "خطتك الحالية"
                ) : overview.pendingRequest ? (
                  "طلب قائم"
                ) : (
                  `اشترك — ${plan.priceShekel}₪`
                )}
              </button>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] leading-relaxed text-muted">
        التجربة المجانية (14 يوماً) تمنح كل ميزات الخطة الاحترافية حتى 4 أعضاء. بعد
        انتهائها تعود الخطة للمجانية (مالك فقط) مع الحفاظ الكامل على بياناتك — التفعيل
        يدوي حالياً بلا بوابة دفع إلكترونية.
      </p>
    </div>
  );
}
