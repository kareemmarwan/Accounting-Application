import Link from "next/link";
import {
  ArrowLeftRight,
  BarChart3,
  BookOpenCheck,
  Check,
  CloudOff,
  HandCoins,
  Lock,
  Minus,
  Rocket,
  ShieldCheck,
  Sparkles,
  WifiOff,
  X
} from "lucide-react";

type Plan = {
  name: string;
  price: string;
  period: string;
  description: string;
  cta: string;
  href: string;
  highlighted: boolean;
  features: string[];
};

type FaqItem = { question: string; answer: string };

const features = [
  {
    icon: BookOpenCheck,
    title: "محاسبة قيد مزدوج تلقائية",
    description: "كل عملية تُقيَّد تلقائياً بقيد متوازن دون خبرة محاسبية."
  },
  {
    icon: WifiOff,
    title: "يعمل بدون إنترنت",
    description: "سجّل مبيعاتك ومصروفاتك دون اتصال، وستُزامن عند عودته."
  },
  {
    icon: HandCoins,
    title: "ديون ودفعات جزئية",
    description: "تابع ديون عملائك ومورديك وسجّل الدفعات حتى تُسدَّد بالكامل."
  },
  {
    icon: ArrowLeftRight,
    title: "صندوق وحسابات بنكية",
    description: "بنك فلسطين، PalPay، Jawwal Pay — كل حساباته في مكان واحد."
  },
  {
    icon: BarChart3,
    title: "تقارير مالية واضحة",
    description: "أرباح وخسائر وتدفقات نقدية وأداء شهري بلغة مفهومة."
  },
  {
    icon: ShieldCheck,
    title: "بيانات محمية",
    description: "عزل كامل لبيانات كل مشروع مع صلاحيات وأمان على مستوى القاعدة."
  }
];

const plans: Plan[] = [
  {
    name: "أساسي",
    price: "29",
    period: "₪ / شهرياً",
    description: "للتاجر الفرد الذي بدأ للتو ويريد نظاماً منظماً.",
    cta: "ابدأ 14 يوماً مجاناً",
    href: "/register",
    highlighted: false,
    features: [
      "مستخدم واحد",
      "مبيعات ومشتريات بلا حدود",
      "ديون ودفعات جزئية",
      "صندوق وحساب بنكي واحد",
      "تقارير أساسية (3 تقارير)",
      "نسخ احتياطي يومي سحابي"
    ]
  },
  {
    name: "احترافي",
    price: "59",
    period: "₪ / شهرياً",
    description: "للمشاريع النشطة التي تريد رؤية مالية كاملة وقرارات أسرع.",
    cta: "ابدأ 14 يوماً مجاناً",
    href: "/register",
    highlighted: true,
    features: [
      "كل ميزات الخطة الأساسية",
      "حتى 3 مستخدمين بصلاحيات",
      "حسابات بنكية ومحافظ متعددة",
      "التقارير العشرة + الأرباح والخسائر",
      "تصدير Excel وطباعة PDF",
      "إشعارات الديون المتأخرة",
      "دعم ذو أولوية عبر واتساب"
    ]
  },
  {
    name: "متعدد المشاريع",
    price: "99",
    period: "₪ / شهرياً",
    description: "لأصحاب أكثر من نشاط تجاري يعملون من حساب واحد.",
    cta: "ابدأ 14 يوماً مجاناً",
    href: "/register",
    highlighted: false,
    features: [
      "كل ميزات الخطة الاحترافية",
      "مشاريع غير محدودة",
      "مستخدمون حتى 10",
      "تقارير مجمّعة بين المشاريع",
      "سجل تدقيق كامل للعمليات",
      "جلسة تهيئة فردية عند البدء"
    ]
  }
];

type ComparisonRow = { label: string; values: [boolean, boolean, boolean] };

const comparison: ComparisonRow[] = [
  { label: "مستخدمون", values: [true, true, true] },
  { label: "مبيعات ومشتريات ومصروفات", values: [true, true, true] },
  { label: "ديون ودفعات جزئية", values: [true, true, true] },
  { label: "عمل بدون إنترنت ومزامنة تلقائية", values: [true, true, true] },
  { label: "عدد الحسابات النقدية والبنكية", values: [false, true, true] },
  { label: "التقارير الكاملة (P&L + التدفقات)", values: [false, true, true] },
  { label: "تصدير Excel وطباعة PDF", values: [false, true, true] },
  { label: "صلاحيات وأدوار للمستخدمين", values: [false, true, true] },
  { label: "تقارير مجمّعة بين المشاريع", values: [false, false, true] },
  { label: "سجل تدقيق كامل", values: [false, false, true] },
  { label: "دعم ذو أولوية", values: [false, true, true] }
];

const trialSteps = [
  {
    title: "أنشئ حسابك خلال دقيقة",
    description: "بريد إلكتروني وكلمة مرور فقط — لا بطاقة بنكية ولا التزام."
  },
  {
    title: "هيّئ مشروعك وأدخل رصيدك الافتتاحي",
    description: "رحلة إرشادية قصيرة تبني لك دليل حسابات وقيد افتتاحي صحيحاً تلقائياً."
  },
  {
    title: "سجّل أول عملية وشاهد النتيجة",
    description: "بيع واحد يكفي لترى القيد المحاسبي والتقرير — كذلك يعمل أول يوم في عملك الحقيقي."
  }
];

const faq: FaqItem[] = [
  {
    question: "هل تحتاج التجربة المجانية بطاقة بنكية؟",
    answer: "لا. أنشئ حسابك وابدأ مباشرة؛ عند انتهاء 14 يوماً تختار خطة أو تبقى بياناتك محفوظة بانتظار قرارك."
  },
  {
    question: "هل تفقد بياناتي إذا انتهت التجربة ولم أشترك؟",
    answer: "لا تُحذف فوراً. تبقى بياناتك كاملة ومحمية لفترة سماح، وتستطيع تصديرها في أي وقت."
  },
  {
    question: "هل يمكنني إلغاء الاشتراك في أي وقت؟",
    answer: "نعم، الإلغاء بنقرة واحدة من الإعدادات، ولا نطلب أي شروط. ما تدفعه مسبقاً يبقى فعّالاً حتى نهاية الشهر."
  },
  {
    question: "هل يعمل التطبيق عندما ينقطع الإنترنت؟",
    answer: "نعم، هذا جوهر النظام. كل العمليات تُسجَّل محلياً على جهازك وتُزامَن تلقائياً مع الخادم عند عودة الاتصال."
  },
  {
    question: "هل أحتاج خلفية محاسبية؟",
    answer: "لا. النظام يكتب القيد المزدوج عنك تلقائياً، والتقارير تُعرض بلغة يومية مبسطة وليس بمصطلحات محاسبية."
  }
];

const navLinks = [
  { href: "#features", label: "المزايا" },
  { href: "#pricing", label: "الأسعار" },
  { href: "#trial", label: "التجربة المجانية" },
  { href: "#faq", label: "الأسئلة الشائعة" }
];

function CheckIcon({ included }: { included: boolean }) {
  return included ? (
    <Check className="h-5 w-5 text-primary" aria-hidden />
  ) : (
    <Minus className="h-5 w-5 text-muted-foreground/40" aria-hidden />
  );
}

export default function LandingPage() {
  return (
    <main className="flex-1">
      <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg">
            <span className="inline-flex rounded-xl bg-primary p-2 text-primary-foreground">
              <Sparkles className="h-5 w-5" aria-hidden />
            </span>
            المساعد المالي
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-muted md:flex">
            {navLinks.map((link) => (
              <a key={link.href} href={link.href} className="transition-colors hover:text-foreground">
                {link.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="hidden text-sm font-medium text-muted transition-colors hover:text-foreground sm:block">
              تسجيل الدخول
            </Link>
            <Link href="/register" className="btn-primary">
              ابدأ مجاناً
            </Link>
          </div>
        </div>
      </header>

      <section className="relative mx-auto flex max-w-6xl flex-col items-center px-4 pb-16 pt-20 text-center sm:pt-28">
        <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-4 py-1.5 text-sm font-medium text-primary-700">
          <Rocket className="h-4 w-4" aria-hidden />
          تجربة مجانية 14 يوماً — بدون بطاقة بنكية
        </span>
        <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          أعرف وضعك المالي في أي لحظة
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">
          نظام مالي متكامل لمتجرك أو مطعمك أو مشروعك: مبيعات، مشتريات، ديون،
          صندوق وبنوك، وتقارير أرباح — بدون محاسب وبأبسط استخدام، ويعمل حتى
          بدون إنترنت.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/register" className="btn-primary px-6 py-3 text-base">
            ابدأ تجربتك المجانية
          </Link>
          <a href="#pricing" className="btn-outline px-6 py-3 text-base">
            استعرض الخطط والأسعار
          </a>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Lock className="h-4 w-4" aria-hidden />
            بياناتك مشفّرة ومعزولة
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CloudOff className="h-4 w-4" aria-hidden />
            يعمل Offline أولاً
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check className="h-4 w-4" aria-hidden />
            إلغاء في أي وقت
          </span>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-24">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-bold">كل ما يحتاجه مشروعك المالي في مكان واحد</h2>
          <p className="mt-3 text-muted">أدوات تُنجز العمل اليومي وتحوّله تلقائياً إلى محاسبة سليمة.</p>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div key={feature.title} className="card text-start transition-shadow hover:shadow-lg">
              <div className="mb-4 inline-flex rounded-xl bg-primary-50 p-3 text-primary">
                <feature.icon className="h-6 w-6" aria-hidden />
              </div>
              <h3 className="text-lg font-bold">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="scroll-mt-20 border-y border-border bg-surface/60 py-24">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-bold">خطط بسيطة وواضحة</h2>
            <p className="mt-3 text-muted">
              اختر ما يناسب حجم مشروعك — وكل الخطط تبدأ بتجربة مجانية 14 يوماً.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={
                  plan.highlighted
                    ? "relative rounded-2xl border-2 border-primary bg-surface p-6 shadow-card"
                    : "rounded-2xl border border-border bg-surface p-6 shadow-card"
                }
              >
                {plan.highlighted && (
                  <span className="absolute -top-3 start-6 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
                    الأكثر اختياراً
                  </span>
                )}
                <h3 className="text-lg font-bold">{plan.name}</h3>
                <p className="mt-1 text-sm text-muted">{plan.description}</p>
                <div className="mt-5 flex items-baseline gap-1.5">
                  <span className="num text-4xl font-bold">{plan.price}</span>
                  <span className="text-sm text-muted">{plan.period}</span>
                </div>
                <Link
                  href={plan.href}
                  className={`${plan.highlighted ? "btn-primary" : "btn-outline"} mt-6 w-full py-3`}
                >
                  {plan.cta}
                </Link>
                <ul className="mt-6 space-y-3 border-t border-border pt-6 text-sm">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-16 overflow-x-auto">
            <h3 className="mb-4 text-center text-xl font-bold">مقارنة تفصيلية بين الخطط</h3>
            <table className="w-full min-w-[560px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="rounded-tr-2xl border-b border-border bg-surface p-4 text-start font-bold">الميزة</th>
                  {plans.map((plan) => (
                    <th key={plan.name} className="border-b border-border bg-surface p-4 text-center font-bold">
                      {plan.name}
                      <span className="num ms-1 text-xs font-medium text-muted">({plan.price}₪)</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.map((row, index) => (
                  <tr key={row.label}>
                    <td
                      className={`border-b border-border bg-surface p-4 text-start ${
                        index === comparison.length - 1 ? "rounded-br-2xl" : ""
                      }`}
                    >
                      {row.label}
                    </td>
                    {row.values.map((included, planIndex) => (
                      <td
                        key={planIndex}
                        className={`border-b border-border bg-surface p-4 text-center ${
                          index === comparison.length - 1 && planIndex === row.values.length - 1 ? "rounded-bl-2xl" : ""
                        }`}
                      >
                        <span className="inline-flex justify-center">
                          <CheckIcon included={included} />
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-center text-xs text-muted">
              <X className="me-1 inline h-3.5 w-3.5" aria-hidden />
              غير متوفرة في الخطة
            </p>
          </div>
        </div>
      </section>

      <section id="trial" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24">
        <div className="rounded-3xl border border-primary-200 bg-primary-50 p-8 sm:p-12">
          <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                تجربة مجانية كاملة
              </span>
              <h2 className="mt-4 text-3xl font-bold">14 يوماً بكل الميزات — بدون بطاقة بنكية</h2>
              <p className="mt-4 leading-relaxed text-muted">
                لا نسخة محدودة ولا ميزات مقفلة: التجربة هي الخطة الاحترافية
                كاملة، وقرارك الوحيد بعد 14 يوماً هو أي خطة تناسبك.
              </p>
              <Link href="/register" className="btn-primary mt-6 px-6 py-3 text-base">
                أنشئ حسابك الآن
              </Link>
            </div>
            <ol className="space-y-6">
              {trialSteps.map((step, index) => (
                <li key={step.title} className="flex gap-4">
                  <span className="num flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground">
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="font-bold">{step.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 pb-24">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-bold">أسئلة شائعة</h2>
          <p className="mt-3 text-muted">كل ما تحتاج معرفته قبل البدء.</p>
        </div>
        <div className="space-y-3">
          {faq.map((item) => (
            <details key={item.question} className="card group">
              <summary className="cursor-pointer list-none font-bold marker:hidden">
                <span className="flex items-center justify-between gap-4">
                  {item.question}
                  <span className="text-primary transition-transform group-open:rotate-45">+</span>
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-24">
        <div className="flex flex-col items-center gap-6 rounded-3xl bg-secondary px-6 py-14 text-center text-secondary-foreground">
          <h2 className="text-3xl font-bold">جاهز تعرف وضعك المالي اليوم؟</h2>
          <p className="max-w-xl text-secondary-foreground/80">
            أنشئ حسابك وابدأ التجربة المجانية — أول عملية تسجّلها سترى أثرها في
            التقارير فوراً.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/register" className="btn-primary px-6 py-3 text-base">
              ابدأ مجاناً الآن
            </Link>
            <a
              href="#pricing"
              className="btn-outline border-secondary-foreground/30 bg-transparent px-6 py-3 text-base text-secondary-foreground hover:bg-secondary-foreground/10"
            >
              استعرض الخطط
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 text-sm text-muted sm:flex-row sm:justify-between">
          <span>المساعد المالي — مبني للمشاريع الصغيرة في فلسطين</span>
          <nav className="flex items-center gap-5">
            <a href="#features" className="transition-colors hover:text-foreground">المزايا</a>
            <a href="#pricing" className="transition-colors hover:text-foreground">الأسعار</a>
            <a href="#faq" className="transition-colors hover:text-foreground">الأسئلة</a>
          </nav>
        </div>
      </footer>
    </main>
  );
}
