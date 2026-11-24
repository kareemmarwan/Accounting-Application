"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { driver, type DriveStep, type Driver } from "driver.js";
import "driver.js/dist/driver.css";

export const APP_TOUR_KEY = "musaed-app-tour-v2";

type NavRole = "owner" | "manager" | "accountant" | "employee" | null;

const FINANCIAL: NavRole[] = ["owner", "manager", "accountant", null];
const EVERYONE: NavRole[] = ["owner", "manager", "accountant", "employee", null];

interface TourStepDef {
  id: string;
  route?: string;
  pick?: string[];
  title: string;
  description: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  roles?: NavRole[];
}

function buildPlan(role: NavRole | undefined): TourStepDef[] {
  const allowed = (roles: NavRole[] | undefined): boolean =>
    role === undefined || roles === undefined || roles.some((item) => item === role);

  const fullPlan: TourStepDef[] = [
    {
      id: "welcome",
      title: "أهلاً بك في المساعد المالي 🎉",
      description:
        "جولة تعليمية سريعة نمرّ فيها معاً على شاشات التطبيق بترتيب العمل الحقيقي: <b>منتجاتك ← الكاشير ← الفواتير ← الديون ← التقارير</b>. اضغط «التالي» وستنتقل معي بين الصفحات وأنا أشرح لك كل زر.",
      roles: EVERYONE
    },
    {
      id: "nav-overview",
      route: "/dashboard",
      pick: ["aside", "nav[aria-label='شريط التنقل السفلي']"],
      title: "كل الشاشات من هنا",
      description:
        "هذا شريط التنقل الرئيسي — لوحة التحكم، الكاشير، المبيعات، الديون، التقارير وغيرها. على الجوال تجد باقي الشاشات داخل زر «المزيد».",
      side: "bottom",
      align: "start",
      roles: EVERYONE
    },
    {
      id: "connection-status",
      route: "/dashboard",
      pick: ["[data-tour='connection-status']"],
      title: "أونلاين وأوفلاين — بلا فرق",
      description:
        "هذا المؤشر يوضح حالة الاتصال. التطبيق يعمل كليهما: كل عملية تُحفظ على جهازك فوراً حتى دون إنترنت، وتُزامَن تلقائياً مع السحابة عند عودة الاتصال. انقطع النت وأنت تبيع — لن تفقد أي فاتورة.",
      side: "bottom",
      align: "end",
      roles: EVERYONE
    },
    {
      id: "nav-products",
      route: "/dashboard",
      pick: ["[data-tour='nav-products']", "[data-tour='bnav-more']"],
      title: "الخطوة الأولى: منتجاتك",
      description:
        "ابدأ بإضافة منتجاتك هنا. على الجوال: اضغط «المزيد» في الشريط السفلي ثم «المنتجات». التالي ننتقل معاً إلى شاشة المنتجات.",
      side: "bottom",
      align: "start",
      roles: FINANCIAL
    },
    {
      id: "products-add",
      route: "/products",
      pick: ["[data-tour='products-add']"],
      title: "أضف منتجك الأول",
      description:
        "اضغط «منتج جديد» ثم امسح الباركود مباشرة من الكاميرا أو أدخله يدوياً. سجّل سعر الشراء وسعر البيع والكمية ووحدة القياس. عند نزول المخزون لحد التنبيه سيظهر تحذير، وتُخصم الكميات تلقائياً مع كل بيعة.",
      side: "bottom",
      roles: FINANCIAL
    },
    {
      id: "pos-scan",
      route: "/pos",
      pick: ["[data-tour='pos-scan']"],
      title: "الكاشير: امسح وبيع",
      description:
        "هذا حقول الباركود: امسح باركود المنتج فوراً أو اضغط أيقونة الكاميرا للمسح بالكاميرا، أو ابحث عن المنتج بالاسم. كل مسحة تُضاف سطراً مستقلاً في السلة.",
      side: "bottom",
      roles: EVERYONE
    },
    {
      id: "pos-checkout",
      route: "/pos",
      pick: ["[data-tour='pos-checkout']"],
      title: "إتمام البيع",
      description:
        "اختر طريقة الدفع: نقداً أو آجلاً أو تحويلاً، والحساب المالي المستلم، ثم اضغط «إتمام البيع». القيد المحاسبي المزدوج يُبنى تلقائياً خلف الكواليس — أرقامك دائماً متوازنة بلا محاسب.",
      side: "top",
      roles: EVERYONE
    },
    {
      id: "sales-new",
      route: "/sales",
      pick: ["[data-tour='sales-new']"],
      title: "سجلّ الفواتير",
      description:
        "كل مبيعاتك هنا مع البحث والتصفية بالحالة وطريقة الدفع. يمكنك إنشاء فاتورة يدوية، إصدار مرتجع من أي فاتورة، أو تعديلها بإضافة أصناف. فواتير المشتريات تجدها في شاشة «المشتريات».",
      side: "bottom",
      roles: EVERYONE
    },
    {
      id: "debts-tabs",
      route: "/debts",
      pick: ["[data-tour='debts-tabs']"],
      title: "الديون والدفعات",
      description:
        "تبويبات: ما تدين به لك (عملاء آجل)، ما تدين به أنت (موردون)، والمسدد. الدفعات جزئية متعددة حتى الصفر، ولكل جهة كشف حساب قابل للطباعة والمشاركة. تذكّر: الآجل لا يحرك الصندوق — الدفعة وحدها تحركه.",
      side: "bottom",
      roles: FINANCIAL
    },
    {
      id: "expenses-add",
      route: "/expenses",
      pick: ["[data-tour='expenses-add']"],
      title: "المصروفات",
      description:
        "سجّل كل مصروف: إيجار، كهرباء، نقل... فور حفظه يظهر في أرباحك وتقاريرك مباشرة — أرباحك هنا أرقام حقيقية لا تقديرات.",
      side: "bottom",
      roles: EVERYONE
    },
    {
      id: "reports-period",
      route: "/reports",
      pick: ["[data-tour='reports-period']"],
      title: "التقارير والأرباح",
      description:
        "10 تقارير مالية بأي فترة تريدها: أرباح، مبيعات، ديون، حركة الحسابات... مع تصدير CSV وطباعة PDF. مصدرها دفتر الأستاذ المحلي، فتتطابق دائماً مع أرصدتك.",
      side: "bottom",
      roles: FINANCIAL
    },
    {
      id: "tour-replay",
      route: "/settings",
      pick: ["[data-tour='tour-replay']"],
      title: "هل نسيت شيئاً؟",
      description:
        "في أي وقت تعيد هذه الجولة من الإعدادات بهذا الزر. هنا أيضاً تدير الحسابات المالية والاشتراك والنسخ الاحتياطي.",
      side: "bottom",
      roles: EVERYONE
    },
    {
      id: "finish",
      title: "أنت جاهز 💪",
      description:
        "جرّب الآن بنفسك: أضف منتجاً واحداً، ثم اذهب إلى الكاشير وامسح باركوده. ولو احتجت شيئاً — زر «إعادة الجولة التعليمية» بانتظارك في الإعدادات.",
      roles: EVERYONE
    }
  ];

  return fullPlan.filter((step) => allowed(step.roles));
}

const BASE_CONFIG = {
  animate: true,
  allowClose: true,
  allowKeyboardControl: true,
  overlayColor: "#0F172A",
  overlayOpacity: 0.65,
  stagePadding: 8,
  stageRadius: 12,
  smoothScroll: true,
  showProgress: true,
  nextBtnText: "التالي",
  prevBtnText: "السابق",
  doneBtnText: "يلا نبدأ",
  closeBtnLabel: "إنهاء الجولة",
  popoverClass: "musaed-tour-popover"
};

const ELEMENT_WAIT_MS = 8000;

function isVisible(element: Element): boolean {
  const rect = (element as HTMLElement).getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(element);
  return style.visibility !== "hidden" && style.display !== "none";
}

function pickVisible(selectors: string[]): Element | undefined {
  for (const selector of selectors) {
    try {
      const element = document.querySelector(selector);
      if (element && isVisible(element)) return element;
    } catch {
      void 0;
    }
  }
  return undefined;
}

function waitForVisible(
  selectors: string[],
  timeoutMs: number,
  signal: AbortSignal
): Promise<boolean> {
  return new Promise((resolve) => {
    if (pickVisible(selectors)) {
      resolve(true);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (signal.aborted || pickVisible(selectors)) {
        window.clearInterval(timer);
        resolve(!signal.aborted);
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        window.clearInterval(timer);
        resolve(false);
      }
    }, 120);
    signal.addEventListener(
      "abort",
      () => {
        window.clearInterval(timer);
      },
      { once: true }
    );
  });
}

export function AppTour({
  role,
  enabled = true
}: {
  role?: NavRole;
  enabled?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const driverRef = useRef<Driver | null>(null);
  const pendingIndexRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const navigatingRef = useRef(false);
  const pathnameRef = useRef(pathname);

  pathnameRef.current = pathname;

  const planRef = useRef(buildPlan(role));
  planRef.current = buildPlan(role);

  const abortWait = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const goToRef = useRef<(globalIndex: number) => void>(() => undefined);

  const markDone = useCallback(() => {
    try {
      window.localStorage.setItem(APP_TOUR_KEY, "done");
    } catch {
      void 0;
    }
    pendingIndexRef.current = null;
    abortWait();
  }, [abortWait]);

  const finishTour = useCallback(() => {
    markDone();
    const driverObj = driverRef.current;
    driverRef.current = null;
    if (driverObj?.isActive()) {
      navigatingRef.current = false;
      driverObj.destroy();
    }
  }, [markDone]);

  const startSegment = useCallback(
    async (globalIndex: number) => {
      const currentPlan = planRef.current;
      const def = currentPlan[globalIndex];
      if (!def) {
        finishTour();
        return;
      }
      abortWait();
      const previousDriver = driverRef.current;
      driverRef.current = null;
      if (previousDriver?.isActive()) {
        navigatingRef.current = true;
        previousDriver.destroy();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      if (def.pick) {
        const found = await waitForVisible(def.pick, ELEMENT_WAIT_MS, controller.signal);
        if (controller.signal.aborted) return;
        if (!found) {
          pendingIndexRef.current = null;
          return;
        }
      }

      let segmentEnd = globalIndex;
      const route = def.route ?? null;
      while (
        segmentEnd < currentPlan.length &&
        (currentPlan[segmentEnd]!.route ?? null) === route
      ) {
        segmentEnd += 1;
      }

      const steps: DriveStep[] = [];
      for (let index = globalIndex; index < segmentEnd; index += 1) {
        const stepDef = currentPlan[index]!;
        steps.push({
          element: stepDef.pick
            ? () => pickVisible(stepDef.pick!) ?? document.body
            : undefined,
          popover: {
            title: stepDef.title,
            description: stepDef.description,
            side: stepDef.side ?? "bottom",
            align: stepDef.align ?? "center",
            progressText: `${index + 1} من ${currentPlan.length}`,
            doneBtnText: index === currentPlan.length - 1 ? "يلا نبدأ" : "التالي"
          }
        });
      }

      const driverObj = driver({
        ...BASE_CONFIG,
        steps,
        onNextClick: (_element, _step, opts) => {
          const activeIndex = opts.index ?? 0;
          if (globalIndex + activeIndex + 1 < segmentEnd) {
            driverObj.moveNext();
            return;
          }
          const nextGlobal = globalIndex + activeIndex + 1;
          if (nextGlobal >= currentPlan.length) {
            finishTour();
            return;
          }
          goToRef.current(nextGlobal);
        },
        onPrevClick: (_element, _step, opts) => {
          const activeIndex = opts.index ?? 0;
          if (activeIndex > 0) {
            driverObj.movePrevious();
            return;
          }
          const prevGlobal = globalIndex - 1;
          if (prevGlobal < 0) return;
          goToRef.current(prevGlobal);
        },
        onDoneClick: (_element, _step, opts) => {
          const nextGlobal = globalIndex + (opts.index ?? 0) + 1;
          if (nextGlobal >= currentPlan.length) {
            finishTour();
            return;
          }
          goToRef.current(nextGlobal);
        },
        onCloseClick: () => {
          finishTour();
        },
        onDestroyStarted: (_element, _step, opts) => {
          opts.driver.destroy();
        },
        onDestroyed: (_element, _step, opts) => {
          if (driverRef.current === driverObj) {
            driverRef.current = null;
          }
          if (navigatingRef.current) {
            navigatingRef.current = false;
            return;
          }
          if (opts.reason !== "api") {
            markDone();
          }
        }
      });

      driverRef.current = driverObj;
      driverObj.drive(0);
    },
    [abortWait, finishTour, markDone]
  );

  const goTo = useCallback(
    (globalIndex: number) => {
      const currentPlan = planRef.current;
      if (globalIndex >= currentPlan.length) {
        finishTour();
        return;
      }
      const def = currentPlan[globalIndex]!;
      const route = def.route ?? null;
      if (route && pathnameRef.current !== route) {
        pendingIndexRef.current = globalIndex;
        navigatingRef.current = true;
        abortWait();
        driverRef.current?.destroy();
        driverRef.current = null;
        router.push(route);
        return;
      }
      void startSegment(globalIndex);
    },
    [abortWait, finishTour, router, startSegment]
  );

  goToRef.current = goTo;

  useEffect(() => {
    let seen = true;
    try {
      seen = window.localStorage.getItem(APP_TOUR_KEY) === "done";
    } catch {
      seen = false;
    }
    if (seen || !enabled) return;
    const timer = window.setTimeout(() => {
      void startSegment(0);
    }, 700);
    return () => {
      window.clearTimeout(timer);
    };
  }, [enabled, startSegment]);

  useEffect(() => {
    pathnameRef.current = pathname;
    const pending = pendingIndexRef.current;
    if (pending === null) return;
    const def = planRef.current[pending];
    if (!def) {
      pendingIndexRef.current = null;
      return;
    }
    const route = def.route ?? null;
    if (route && pathname !== route) return;
    pendingIndexRef.current = null;
    void startSegment(pending);
  }, [pathname, startSegment]);

  useEffect(() => {
    function onReplay() {
      abortWait();
      pendingIndexRef.current = null;
      navigatingRef.current = false;
      const driverObj = driverRef.current;
      driverRef.current = null;
      if (driverObj?.isActive()) {
        driverObj.destroy();
      }
      try {
        window.localStorage.removeItem(APP_TOUR_KEY);
      } catch {
        void 0;
      }
      void startSegment(0);
    }
    window.addEventListener("musaed:replay-tour", onReplay);
    return () => window.removeEventListener("musaed:replay-tour", onReplay);
  }, [abortWait, startSegment]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      driverRef.current?.destroy();
      driverRef.current = null;
    };
  }, []);

  return null;
}
