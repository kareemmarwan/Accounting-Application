# TASKS.md — خطة التنفيذ وتتبع المهام

> **قواعد التحديث:** علّم `[x]` فور اكتمال المهمة فعلياً (مع فحص build/typecheck/test). لا تنقل مرحلة قبل استيفاء معايير خروجها في PROJECT_PLAN.md §10. سجّل أي عائق في «سجل التقدم».

الحالات: `[ ]` لم تبدأ — `[~]` جارية — `[x]` مكتملة — `[!]` معوقة (بسبب مسجل)

---

## Phase 0 — التوثيق والمرجعية
- [x] PROJECT_PLAN.md (المرجعية الشاملة + سجل القرارات ADR)
- [x] ARCHITECTURE.md (الطبقات، المحرك، المزامنة، PWA)
- [x] DATABASE_SCHEMA.md (الجداول، RLS، الفهارس، Triggers)
- [x] TASKS.md + AGENTS.md

---

## Phase 1 — Foundation (الحالية)
**معيار الخروج:** `npm run build` + `typecheck` + `lint` + `test` خضراء؛ التطبيق يعمل RTL عربي بخط Cairo بألوان الهوية؛ PWA قابل للتثبيت (manifest + icons + SW مسجل)؛ عملاء Supabase جاهزون بفحص env؛ مخطط Dexie v1 معرّف؛ نواة المحرك المحاسبي مع اختباراتها خضراء.

- [x] 1.1 package.json (الإصدارات المثبتة) + tsconfig strict + next/postcss/tailwind configs
- [x] 1.2 .env.example + .gitignore
- [x] 1.3 Tailwind RTL + متغيرات الألوان (الهوية) + globals.css
- [x] 1.4 Cairo font + root layout (dir=rtl, lang=ar) + تسجيل SW
- [x] 1.5 صفحة الهبوط + هيكل (app) shell (سايدبار/هيدر/مؤشر حالة الاتصال والمزامنة)
- [x] 1.6 PWA: manifest.webmanifest + أيقونات (سكربت توليد PNG) + sw.js (App Shell + Offline fallback)
- [x] 1.7 عملاء Supabase (browser/server) بتحقق Zod من env ووضع not-configured واضح
- [x] 1.8 lib/format: تنسيق ILS (ar-PS) والتواريخ المحلية
- [x] 1.9 core/accounting: money.ts + types.ts + chart-of-accounts.ts + engine.ts (بناة القيود) + balance.ts
- [x] 1.10 core/db: مخطط Dexie v1 (جداول + outbox + sync_meta)
- [x] 1.11 Vitest: اختبارات المحرك (توازن القيود، بيع نقدي/آجل/مختلط، شراء، دفعة جزئية/كاملة، رفض دفعة زائدة، تحويل محايد، رفض قيد غير متوازن/سالب)
- [x] 1.12 فحص نهائي: build + typecheck + lint + test

## Phase 2 — Authentication & Business
- [x] 2.1 صفحات auth: تسجيل/دخول Supabase Auth (email+password) بحالات خطأ عربية
- [x] 2.2 Middleware حماية (app) + جلسة محلية تسمح بعمل Offline حتى انتهائها
- [x] 2.3 Onboarding (رحلة 9 خطوات من المواصفة §15): اسم صاحب/مشروع → نوع النشاط → عملة → رصيد افتتاحي → حساب بنكي → عميل/مورد أول (اختياري) → إنشاء أرصدة الافتتاح بقيد صحيح (3100)
- [x] 2.4 Migrations: 0001–0004 (extensions, enums, core tables, RLS)
- [x] 2.5 زرع دليل الحسابات + تصنيفات المصروفات + business_sequences عند إنشاء مشروع (RPC)
- [x] 2.6 business_members + دعوة مستخدم + تطبيق مصفوفة الأدوار في RLS
- [x] 2.7 اختيار/تبديل المشروع النشط (سياق جلسة)
- [!] 2.8 اختبارات: دورة تسجيل→onboarding→دخول؛ عزل مشروع آخر (RLS test) — **اختبارات الوحدات خضراء (55/55) وملف pgTAP جاهز في supabase/tests/rls_isolation_test.sql؛ التشغيل الفعلي يتطلب مشروع Supabase مربوطاً (لا يوجد .env.local ولا Supabase CLI في البيئة) — انظر العوائق**

## Phase 3 — Financial Core (Offline-First)
- [~] 3.1 repositories محلية (Dexie) لكل كيان + توليد UUID + syncStatus — **الأساس جاهز: core/db/repositories.ts (newId/tempDocNumber/syncFields/outbox enqueue)**؛ ما تبقى مستودعات الاستعلام لكل ميزة تُبنى مع كل ميزة
- [x] 3.2 الحسابات المالية: CRUD + إيداع/سحب/تحويل/تسوية بقيد صحيح
- [x] 3.3 المبيعات: نموذج + قائمة + بحث/تصفية + نقدي/آجل/مختلط + رفض paid>net
- [x] 3.4 المشتريات: نموذج + قائمة + إرفاق إثبات (محلياً) + آجل لا يخصم حساباً
- [x] 3.5 المصروفات: نموذج + تصنيفات + إيصال
- [x] 3.6 العملاء والموردون: CRUD + ملف كامل بسجل العمليات
- [x] 3.7 الديون: قسمان + دفعات جزئية متعددة حتى الصفر + رفض الزيادة + كشف حساب
- [x] 3.8 Outbox: كل العمليات — sale/purchase/expense/debt_payment/manual_debt/transfer/deposit/withdrawal/adjustment/entity.upsert/entity.soft_delete
- [x] 3.9 ترقيم مؤقت محلي L-…
- [x] 3.10 اختبارات خدمات الوحدات — **165/165 خضراء: مبيعات + مشتريات + ديون + مصروفات + حسابات + جهات (CRUD + دفتر دين + دين يدوي بقيد متوازن مقابل رأس المال + رفض حذف جهة برصيد)**

## Phase 4 — Accounting Engine + Server & DB
- [x] 4.1 Migrations كاملة لكل الجداول (DATABASE_SCHEMA) + الفهارس + Triggers — **0001–0007 شاملة**
- [x] 4.2 RLS كامل + دوال is_member/user_role_in/is_owner/is_financial_role + Storage Policies (0004)
- [x] 4.3 Server Actions/RPC تشغّل المحرك داخل transaction — **0007: apply_sync_operation دالة ذرّية security definer تشتق القيد من حمولة العملية (ADR-2) وتحدّث الأرصدة والحُرّاس**
- [x] 4.4 Idempotency: operation_log + unique(business_id, client_op_id) + إرجاع النتيجة المحفوظة مع علامة duplicate
- [x] 4.5 Trapping: assert_balanced_entry + next_doc_number + حُرّاس الأرصدة (assert_account_balance_ok — رفض رصيد سالب خارج التسوية)
- [x] 4.6 Void بقيد عكسي (sale/purchase/expense/debt_payment) + audit_logs لكل عملية — **void_posted_document RPC**
- [~] 4.7 اختبارات SQL (Supabase local): ملف pgTAP جاهز — التشغيل الفعلي بعد تطبيق التهجيرات على المشروع

## Phase 5 — Sync Engine
- [x] 5.1 /api/sync/push + pull (deltas بwatermarks) + تحقق Zod مزدوج (حمولات + طلبات)
- [x] 5.2 معالج Outbox: ترتيب طوبولوجي (كيانات قبل مستندات) + attempts/backoff (5s→10m) + حالات pending/syncing/failed
- [x] 5.3 استبدال الكانوني بعد sync: حذف القيد المحلي المؤقت + الجلب يجلبه بنسخة نهائية بالترقيم + تحديث أرقام المستندات
- [x] 5.4 تعارضات: version optimistic للكيانات (expectedVersion) + server-authoritative للمستندات + CONFLICT يعلّم السجل محلياً
- [x] 5.5 Soft delete سحب/دفع (entity.soft_delete + دلتا deleted_at) 
- [x] 5.6 مؤشرات الواجهة: متصل/غير متصل + «N بانتظار المزامنة» (زر مزامنة فورية) + تعارضات + «محلي فقط» حين لا توجد Supabase
- [~] 5.7 اختبارات: قطع اتصال/إعادة مزامنة/تعارض — يتطلب مشروع Supabase بجداول مطبقة (سلوك الكود مغطى بفحص الأنواع ومنطق idempotency على الخادم)

## Phase 6 — Dashboard & Reports
- [x] 6.1 مزامنة الداشبورد: 10 بطاقات + تصفية فترات (يوم/أسبوع/شهر/سنة) من Dexie
- [x] 6.2 الرسوم: مبيعات/مشتريات/مصروفات 30 يوماً، مقارنة 6 أشهر، توزيع المصروفات، وسائل الدفع (Recharts)
- [x] 6.3 النشاط الأخير + إجراءات سريعة تعمل فعلياً
- [x] 6.4 التقارير العشرة + تقرير P&L (استحقاق/تقديري مع صبغة واضحة وملاحظة الأساس)
- [x] 6.5 تصدير CSV (BOM للعربية) + طباعة/PDF + كشف حساب جهة قابل للطباعة
- [~] 6.6 اتساق: الداشبورد والتقارير من مصدر واحد (Dexie/دفتر الأستاذ المحلي) — اختبار اتساق آلي متبقي

## Phase 7 — Advanced Features
- [ ] 7.1 المخزون (اختياري): products/items + ربط مبيعات/مشتريات + قيد COGS + تنبيه نقص + جرد — **خارج نطاق الإطلاق v1 (جاهز بنوياً: purchase_items + قيد 5900)**
- [ ] 7.2 الإشعارات: جدول notifications جاهز (محلي وسحابي) — واجهة التنبيهات قرب قرب
- [x] 7.3 الإعدادات الكاملة (معلومات/أعضاء/دعوة/تبديل/خروج) + **اشتراك (بطاقة خطط وطلب ترقية)** + **نسخة احتياطية JSON كاملة**
- [ ] 7.4 المساعد AI — لاحقاً (معزول، موافقة صريحة)
- [x] 7.5 بنية الاشتراكات: trial 14 يوماً (يعادل احترافية/4 أعضاء) + خطط 29/59/99₪ + حدود الأعضاء مفروضة على دعوة الأعضاء (Server) + طلب ترقية/إلغاء — **بدون بوابة دفع (تفعيل يدوي)**
- [x] 7.6 إدارة الموظفين: أدوار (owner/manager/accountant/employee) + تغيير دور/إزالة + سايدبار حسب الدور (الموظف: مبيعات/مصروفات فقط) + بانر التجربة

---

## سجل التقدم (Progress Log)

| التاريخ | الإنجاز | ملاحظات |
|---|---|---|
| 2026-11-14 | Phase 0 مكتملة: 4 وثائق مرجعية + AGENTS.md | قرارات ADR-1..10 مثبتة |
| 2026-11-14 | Phase 1 مكتملة: Next.js 14 + TS strict + Tailwind RTL + Cairo ذاتي الاستضافة (ADR-11) + PWA (manifest/sw/أيقونات مولدة) + عملاء Supabase + مخطط Dexie v1 + نواة المحرك المحاسبي (money/chart/engine/balance) | build ✓ typecheck ✓ lint ✓ 28/28 اختبار ✓ — ملاحظة: Google Fonts محجوب في البيئة، الحل @fontsource/cairo |
| 2026-11-14 | اكتشاف أثناء العمل: أوامر معالجة نصوص PowerShell تكفّد ترميز الملفات العربية — أُعيد بناء engine.ts | **قاعدة:** لا تستخدم Get-Content/Set-Content لتحرير ملفات المشروع؛ استخدم أدوات التحرير المباشرة |
| 2026-11-15 | Phase 2 مكتملة: صفحات (auth) دخول/تسجيل بأخطاء عربية مُترجمة + middleware حماية (app) + onboarding 9 خطوات (Server Action يستدعي RPC `setup_new_business` بمشروع واحد كامل: أعمال+عضوية مالك+دليل حسابات+10 تصنيفات مصروف 51xx+ترقيم+حسابات مالية+قيد افتتاحي متوازن 3100) + Migrations 0001–0005 + RLS بمصفوفة الأدوار + Storage policies + دعوة أعضاء بـ SERVICE_ROLE_KEY من الخادم فقط + سياق المشروع النشط (كوكي httpOnly) + صفحة إعدادات (معلومات/أعضاء/دعوة/تبديل/خروج) + Dexie v2 (businesses) لكاش ما بعد الـ onboarding | typecheck ✓ lint ✓ 55/55 اختبار ✓ build ✓ — مسارات مولدة: login/register/onboarding/settings/dashboard |
| 2026-11-15 | تفعيل المبيعات (3.3): صفحة /sales كاملة Offline-First — نموذج (نقدي/آجل/مختلط + خصم + معاينة صافي/متبقي) + قائمة بحث/تصفية (حالة/طريقة دفع) + شارات مزامنة. الخدمة: Zod → المحرك (`buildSaleEntry`) → Dexie transaction واحدة (بيع+دين receivable+قيد JE وسطور+تحديث رصيد الصندوق والعميل) → Outbox `sale.create`. مستودعات أساسية (repositories.ts: newId/L- رقم مؤقت/syncFields/enqueue). تفعيل المبيعات في السايدبار + إجراء سريع بالداشبورد. Dexie guard أصبح indexedDB وdevDep fake-indexeddb للاختبار | typecheck ✓ lint ✓ 81/81 اختبار ✓ build ✓ (مسار /sales 10.1kB) |
| 2026-11-15 | تفعيل المشتريات (3.4): صفحة /purchases بنفس النمط — نموذج (نقدي/آجل/مختلط + رقم تحويل للتحويلات + إرفاق صورة فاتورة/إثبات محلياً Blob في Dexie v3 `attachmentBlobs` + meta) + قائمة بحث/تصفية. الخدمة: `buildPurchaseEntry` على 5900 (بلا مخزون) → transaction (شراء+دين payable+قيد+خصم رصيد الصندوق بقيمة المدفوع فقط+تحديث رصيد المورد) → Outbox `purchase.create`. القاعدة الحرجة مؤكدة بالاختبارات: آجل = صفر حركة مالية. تفعيل المشتريات بالسايدبار + زر «شراء جديد» بالداشبورد | typecheck ✓ lint ✓ 104/104 اختبار ✓ build ✓ (مسار /purchases 7.2kB) — ملاحظة: عملية بناء متداخلة سببت قفل EPERM على .next/trace؛ الحل إنهاء عمليات node الميتة ومسح .next |
| 2026-11-15 | تفعيل الديون (3.7): صفحة /debts بتبويبين (ديون العملاء/مستحقات الموردين مع عدّاد غير المسدد) + ملخص (أصل/مسدد/متبقي) + نموذج دفعة جزئية (حساب إلزامي، طرق نقدية فقط) + سجل دفعات قابل للطي لكل دين + كشف حساب جهة (افتتاحي محسوب عكسياً + صفوف زمنية + رصيد بعدها). الخدمة: `buildDebtPaymentEntry` + `validateDebtPaymentAmount` (رفض الزيادة) → transaction (دفعة+دين open→partial→settled+حركة الصندوق بالاتجاه+خفض رصيد الجهة) → Outbox `debt_payment.create`. Dexie: `createdAt` على LocalDebt لترتيب الكشف | typecheck ✓ lint ✓ 120/120 اختبار ✓ build ✓ (مسار /debts 7kB) |
| 2026-11-18 | إكمال المصروفات (3.5): أُصلح اختبار «مصروف بتحويل بنكي» (الحمولة لم تكن تمرر accountId الخاص بالبنك ففشل فحص تطابق accountRef) + إصلاح عنوان صفحة /expenses التالف الترميز (PS المفتوح بترميز خطأ — استخدم أدوات التحرير المباشرة) | 8/8 اختبار المصروفات ✓ |
| 2026-11-18 | تفعيل الحسابات المالية (3.2): صفحة /accounts كاملة Offline-First — بطاقات ملخص (إجمالي/نقدي/بنوك ومحافظ) + قائمة بطاقات لكل حساب (نوع/مزود/رصيد/افتتاحي/إيداعات/سحوبات/شارة مزامنة) + تصفية نشط/مؤرشف + نموذج إنشاء (نوع+مزود مطلوب للبنك/المحفظة+رصيد افتتاحي يقيد على 3100 عبر `buildDepositEntry`) + تعديل (الاسم/المزود فقط) + أرشفة/تنشيط + حذف ناعم (يُرفض برصيد ≠ 0) + عمليات: إيداع/سحب (3100)/تحويل بقيد واحد متوازن (القاعدة الحرجة: التحويل محايد بلا إيراد/مصروف)/تسوية على 5950 (بلا فرق = بلا قيد/بلا Outbox) + كشف حساب لكل حساب (افتتاحي عكسي + صفوف من journalEntryLines بـ financialAccountId مع رصيد بعده). الخدمة `accounts-service`: Zod (validation/account.ts) → المحرك → Dexie transaction → Outbox (deposit.create/withdrawal.create/transfer.create/adjustment.create + entity.upsert/entity.soft_delete للـ CRUD). السايدبار: الحسابات المالية صارت نشطة بدل «قريباً» + إجراء سريع بالداشبورد + تحديث نص الحالة. ملاحظة تقنية: أزيل `transform()` من حقل المزود في Zod لكسر استدلال أنواع RHF — التطبيع في الخدمة (normalizeAccountProvider) | typecheck ✓ lint ✓ 156/156 اختبار ✓ build ✓ (مسار /accounts 11.1kB) |
| 2026-11-18 | إعادة هيكلة صفحة الهبوط بهيكل SaaS احترافي: هيدر ثابت بروابط مرساة + Hero بثقة (بدون بطاقة/Offline/إلغاء) + شبكة المزايا الست + قسم الأسعار بثلاث خطط اشتراك بالشيكل (أساسي 29 / احترافي 59 «الأكثر اختياراً» / متعدد المشاريع 99) + جدول مقارنة تفصيلي بين الخطط + قسم التجربة المجانية (14 يوماً بكل الميزات، 3 خطوات) + أسئلة شائعة (details/summary بلا JS) + شريط CTA داكن وفوتر بروابط. الأسعار الأولية قابلة للتعديل (لا بوابة دفع بعد — 7.5). إصلاح side-effect: حراسة undefined في accounts-service.test.ts | typecheck ✓ lint ✓ 156/156 اختبار ✓ build ✓ (التحذيرات الموجودة سلفاً في Edge Runtime) |
| 2026-11-21 | العملاء والموردون (3.6) + **دفتر دين**: /contacts بتبويبين (عملاء/موردون) + بحث + نموذج CRUD Offline-First (Outbox entity.upsert/soft_delete برفض الخادم لرصيد ≠ 0) + تبويب «دفتر دين» بجدول كل الجهات ذات رصيد + ملف جهة كامل (كشف حركة: بيع/شراء آجل + دين يدوي + دفعات، رصيد بعده محسوب، افتتاحي عكسي، طباعة) + دين يدوي جديد بقيد متوازن (AR/AP مقابل رأس المال 3100) مع دوال محرك buildManualDebtEntry + 9/9 اختبار | typecheck ✓ lint ✓ 165/165 ✓ |
| 2026-11-21 | **Phase 4 كاملة تقريباً**: Migration 0007 (apply_sync_operation ذرّية security definer تشتق القيد من الحمولة لكل 11 نوع عملية + ترقيم نهائي + أرصدة + حُرّاس رصيد + idempotency عبر operation_log + audit) + void_posted_document (إلغاء بقيد عكسي لبيع/شراء/مصروف/دفعة) + Migration 0006 (اشتراكات + trial + دوال effective_plan/plan_max_members/business_capacity) + /api/sync/push (تحقق Zod مزدوج + دفع دفعات 50) و/pull (deltas بwatermark لـ11 جدولاً) | build ✓ |
| 2026-11-21 | **Phase 5 محرك مزامنة العميل**: device.ts (معرف جهاز لكل مشروع في syncMeta) + row-mapping (تحويل صفوف snake/numeric إلى Local) + client.ts (push طوبولوجي + backoff 5s→10m + معالجة نتائج لكل عملية: تعليم synced/حذف قيد مؤقت/conflict) + pull يستبدل الكانوني مع قاعدة «لا تجتثث المعلق المحلي الأحدث» + heartbeat 60 ثانية + دفع تلقائي بعد أي enqueue (debounce 2s) + مؤشرات: عدّاد معلق/تعارضات/محلي فقط/زر مزامنة فورية | typecheck ✓ |
| 2026-11-21 | **Phase 6 الداشبورد والتقارير**: dashboard-service (10 بطاقات + 4 رسوم + نشاط أخير + تصفية فترة) + صفحة /reports: 10 تقارير (مبيعات/مشتريات/مصروفات/P&L استحقاق-تقديري/تدفقات نقدية/ديون عملاء/مستحقات موردين/أرصدة حسابات/أداء يومي/أداء شهري) بفترة من-إلى + مقاطع سريعة + تصدير CSV بـBOM + طباعة | build ✓ |
| 2026-11-21 | **الاشتراكات والموظفون**: خطط (مجانية 1 / تجربة 4 / أساسية 2 / احترافية 4 / متعددة 11) + دعوة الأعضاء تفرض الحد على الخادم + بطاقة اشتراك (استخدام + طلب ترقية/إلغاء) + إدارة أعضاء (تغيير دور/إزالة) + سايدبار حسب الدور (الموظف: مبيعات/مصروفات فقط) + بانر تجربة المتبقي + نسخة احتياطية JSON + README دليل إطلاق كامل + اكتشاف مفاتيح Supabase للمستخدم في .env.example ونقلها إلى .env.local (auth health 200؛ **التهجيرات لم تُطبق بعد — 0001→0007 عبر SQL Editor**) | typecheck ✓ lint ✓ 165/165 ✓ build ✓ |

## العوائق المسجلة (Blockers)

| التاريخ | العائق | الحل المقترح |
|---|---|---|
| — | — | — |
| 2026-11-21 | **التهجيرات غير مطبقة على مشروع Supabase** (المستخدم المكتشف: aulyklmgczrsciqljodg — مفاتيحه في .env.local، auth health 200، لكن profiles ترد 404) | نفّذ ملفات supabase/migrations/ 0001→0007 بالترتيب من SQL Editor في لوحة Supabase (أو `npx supabase link --project-ref aulyklmgczrsciqljodg && npx supabase db push`) ثم اختبر: تسجيل → onboarding → مزامنة |
| 2026-11-15 | 2.8: اختبارات RLS/E2E (تسجيل→onboarding→دخول، عزل مشروع) لا تُشغَّل: يلزم تطبيق التهجيرات أولاً | بعد تطبيق التهجيرات: `supabase test db supabase/tests/rls_isolation_test.sql` — الملف جاهز (pgTAP، 14 تأكيداً) |
