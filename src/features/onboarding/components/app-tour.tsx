"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BarChart3,
  BookOpen,
  HandCoins,
  Package,
  PartyPopper,
  Rocket,
  ScanBarcode,
  Wallet,
  WifiOff
} from "lucide-react";

export const APP_TOUR_KEY = "musaed-app-tour-v1";

interface TourStep {
  icon: typeof ScanBarcode;
  title: string;
  description: string;
  accent: string;
}

const STEPS: TourStep[] = [
  {
    icon: PartyPopper,
    title: "أهلاً بك في المساعد المالي",
    description:
      "دعك من الدفاتر والأرقام المتناثرة — حسابات مشروعك كلها من شاشة واحدة: مبيعاتك، ديونك، صندوقك، وأرباحك. جولة سريعة تعرّفك على كل شيء.",
    accent: "bg-primary-50 text-primary"
  },
  {
    icon: ScanBarcode,
    title: "الكاشير والماسح — البيع الأسرع",
    description:
      "امسح باركود المنتج فيُضاف للفاتورة فوراً. كل مسحة سطر مستقل يحذف منفرداً. اختر طريقة الدفع (نقد/آجل/تحويل) وطبّع الفاتورة مباشرة. ولكل نوع متجر شاشة كاشير خاصة: صيدلية، خضار وفواكه بميزان، إلكترونيات بعميل إلزامي وسيريال.",
    accent: "bg-primary-50 text-primary"
  },
  {
    icon: Package,
    title: "المنتجات بالباركود",
    description:
      "أضف منتجاتك عبر مسح الباركود مباشرة في النموذج، مع سعر البيع والشراء والكمية ووحدة القياس (قطعة/كجم/لتر). عند نزول المخزون لحد التنبيه يظهر لك تحذير، وتُخصم الكميات تلقائياً مع كل بيعة وترتفع مع كل شراء.",
    accent: "bg-emerald-50 text-emerald-700"
  },
  {
    icon: BookOpen,
    title: "المبيعات والمشتريات",
    description:
      "سجّل بيعة نقدياً أو آجلاً أو مختلطة، وفاتورة شراء بمرفقات وصورة إثبات. القيد المحاسبي المزدوج يُبنى تلقائياً خلف كل عملية — أرقامك دائماً متوازنة بلا محاسب.",
    accent: "bg-sky-50 text-sky-700"
  },
  {
    icon: HandCoins,
    title: "الديون والدفعات",
    description:
      "ديون عملائك ومستحقات مورديك في مكان واحد. دفعة جزئية متعددة حتى الصفر، وكشف حساب كامل لكل جهة قابل للطباعة والمشاركة. لا دفعة زائدة تُقبل صامتة.",
    accent: "bg-amber-50 text-amber-700"
  },
  {
    icon: Wallet,
    title: "الصندوق والحسابات",
    description:
      "الصندوق، البنك، PalPay وJawwal Pay — رصيد كل حساب لحظي ودقيق. إيداع وسحب وتحويل بين الحسابات، وأي رصيد سالب يُرفض فوراً لحماية أرقامك.",
    accent: "bg-indigo-50 text-indigo-700"
  },
  {
    icon: BarChart3,
    title: "التقارير والأرباح",
    description:
      "لوحة التحكم تلخص يومك: مبيعات اليوم والشهر، المصروفات، الأرباح التقديرية، وديونك. وتقارير مفصلة بأي فترة مع تصدير Excel/CSV وطباعة PDF.",
    accent: "bg-rose-50 text-rose-700"
  },
  {
    icon: WifiOff,
    title: "يعمل دون إنترنت — دائماً",
    description:
      "كل عملية تُحفظ على جهازك أولاً وتُزامَن تلقائياً مع السحابة عند عودة الاتصال. انقطع النت وأنت تبيع — لن تتوقف لحظة واحدة، ولن تفقد أي فاتورة.",
    accent: "bg-primary-50 text-primary"
  }
];

export function AppTour() {
  const [visible, setVisible] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    let seen = false;
    try {
      seen = window.localStorage.getItem(APP_TOUR_KEY) === "done";
    } catch {
      seen = false;
    }
    if (!seen) setVisible(true);
  }, []);

  useEffect(() => {
    function onReplay() {
      setStepIndex(0);
      setVisible(true);
    }
    window.addEventListener("musaed:replay-tour", onReplay);
    return () => window.removeEventListener("musaed:replay-tour", onReplay);
  }, []);

  useEffect(() => {
    if (!visible) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") finish();
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        next();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const finish = useCallback(() => {
    try {
      window.localStorage.setItem(APP_TOUR_KEY, "done");
    } catch {
      void 0;
    }
    setVisible(false);
  }, []);

  const next = useCallback(() => {
    setStepIndex((current) => {
      if (current >= STEPS.length - 1) {
        finish();
        return current;
      }
      return current + 1;
    });
  }, [finish]);

  if (!visible) return null;

  const step = STEPS[stepIndex]!;
  const isLast = stepIndex === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="الجولة التعليمية"
    >
      <div className="w-full max-w-md rounded-3xl border border-border bg-surface p-8 shadow-2xl">
        <div className="flex flex-col items-center text-center">
          <span
            className={`mb-5 inline-flex h-16 w-16 items-center justify-center rounded-2xl ${step.accent}`}
          >
            <step.icon className="h-8 w-8" aria-hidden />
          </span>
          <h2 className="text-lg font-bold">{step.title}</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            {step.description}
          </p>
        </div>

        <div className="mt-6 flex items-center justify-center gap-1.5">
          {STEPS.map((_, index) => (
            <span
              key={index}
              className={`h-2 rounded-full transition-all ${
                index === stepIndex
                  ? "w-6 bg-primary"
                  : "w-2 bg-muted-foreground/25"
              }`}
              aria-hidden
            />
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={finish}
            className="text-xs font-medium text-muted hover:text-foreground"
          >
            تخطي الجولة
          </button>
          <button
            type="button"
            onClick={next}
            className="btn-primary min-w-32"
            autoFocus
          >
            {isLast ? (
              <>
                <Rocket className="h-4 w-4" aria-hidden />
                ابدأ الآن
              </>
            ) : (
              "التالي"
            )}
          </button>
        </div>

        <p className="mt-4 text-center text-[10px] text-muted">
          خطوة {stepIndex + 1} من {STEPS.length} — Enter للتالي، Escape للتخطي
        </p>
      </div>
    </div>
  );
}
