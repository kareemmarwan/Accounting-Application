# المساعد المالي — Financial Assistant

تطبيق ويب PWA (يعمل دون إنترنت) لإدارة حسابات المشاريع الصغيرة: مبيعات، مشتريات، مصروفات، ديون ودفعات، صندوق وحسابات بنكية، دفتر دين كامل، تقارير، ومزامنة سحابية عبر Supabase.

## التشغيل السريع

```bash
npm install
npm run dev        # http://localhost:3000
```

الفحوص:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

## الإطلاق الكامل (تسجيل مستخدمين + مزامنة سحابية)

### 1) ربط Supabase

1. أنشئ مشروعاً في [supabase.com](https://supabase.com).
2. من **Settings → API** انسخ: Project URL + anon publishable key + service_role secret key.
3. أنشئ ملف `.env.local` في جذر المشروع (انسخ من `.env.example`) وضِع:

```
NEXT_PUBLIC_SUPABASE_URL=<Project URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>

SUPABASE_SERVICE_ROLE_KEY=<service_role key>
```

- المفاتيح العامة (`NEXT_PUBLIC_*`) تصل المتصفح فقط.
- `SUPABASE_SERVICE_ROLE_KEY` يبقى في الخادم حصراً (يستخدم لدعوة الأعضاء) — لا يلمس أي كود متصفح إطلاقاً.
- في هذا المستودع توجد مفاتيح مشروع جاهزة داخل `.env.local` — لا ترفعها لعموم (gitignore يحميها).

### 2) تطبيق تهجيرات قاعدة البيانات (Migrations)

افتح لوحة Supabase → **SQL Editor** ونفّذ الملفات بالترتيب، ملفاً بعد ملف، من مجلد `supabase/migrations/`:

1. `0001_init_extensions.sql`
2. `0002_enums.sql`
3. `0003_core_tables.sql`
4. `0004_rls.sql` — يفعّل عزل بيانات كل مشروع (RLS) على كل جدول
5. `0005_business_setup_rpc.sql`
6. `0006_subscriptions_trial.sql` — الاشتراكات + التجربة المجانية 14 يوماً + حدود الموظفين
7. `0007_server_sync.sql` — محرك تطبيق عمليات المزامنة على الخادم + الإلغاء بقيد عكسي

بديل للسطرية: `npx supabase login && npx supabase link --project-ref <REF> && npx supabase db push`

### 3) النشر (Vercel)

1. ارفع المشروع إلى GitHub (اجعل `.env.local` مستثنى — gitignore يحميه).
2. استورده في [vercel.com](https://vercel.com) واضبط متغيرات البيئة في Project → Settings → Environment Variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (Environment: Production — يبقى في الخادم فقط)
3. بعد أول نشر، ضع رابط الإنتاج في متغير `NEXT_PUBLIC_SITE_URL` (لصح بـ metadataBase) وحدّث في Supabase:
   - **Auth → URL Configuration**: Site URL = رابط الإنتاج + أضف الرابط في Redirect URLs (للتسجيل/تأكيد البريد).
4. بعد النشر: افتح الموقع وسجّل الدخول مرة أونلاين — الـ Service Worker v6 يخزّن كل الصفحات ليعمل التطبيق أوفلاين.
5. عند تعديل `public/sw.js` مستقبلاً ارفع `VERSION` (v6 → v7) ليُحدَّث تلقائياً عند الأجهزة المثبتة.

ملاحظة: `src/app/opengraph-image.tsx` معطّل مؤقتاً بسبب قيود مسار Windows (ADR في TASKS.md) — على Vercel (Linux) يمكن استعادته من `scripts/disabled/` إلى `src/app/`.

### 4) تحقق من الإطلاق

1. افتح `/register` وسجّل حساباً — ثم أكمل Onboarding (يبدأ تلقائياً تجربة مجانية 14 يوماً).
2. سجّل بيعاً/شراءً/مصروفاً — يُحفظ محلياً فوراً ويعمل دون إنترنت.
3. عند عودة الاتصال يُدفع تلقائياً إلى الخادم (`operation_log` يمنع التكرار) ويُسحب رقم المستند النهائي `S-2026-…`.
4. الإعدادات → دعوة موظفين (حسب حدود الخطة) → الاشتراك والترقية.

## البنية (ملخص)

| الطبقة | المكان |
|---|---|
| المحرك المحاسبي (دوال نقية مشتركة عميل/خادم) | `src/core/accounting` |
| القاعدة المحلية Dexie + Outbox | `src/core/db` |
| محرك المزامنة (Push/Pull/Idempotency) | `src/core/sync` + `src/app/api/sync/*` |
| تطبيق العمليات على الخادم (SQL ذرّي) | `supabase/migrations/0007_server_sync.sql` |
| الوحدات | `src/features/<sales|purchases|expenses|debts|accounts|contacts|dashboard|reports|subscription|settings>` |

## الأمان

- RLS على كل جدول بـ `business_id` — عزل كامل بين المشاريع.
- الصلاحيات حسب الأدوار (owner/manager/accountant/employee) في RLS وServer Actions.
- لا تخزين بيانات مالية في LocalStorage — IndexedDB (Dexie) فقط.
- القيد المرحّل غير قابل للتعديل/الحذف؛ الإلغاء بقيد عكسي + سجل تدقيق.

## الخطط والتجربة

- **تجربة مجانية 14 يوماً** بكل الميزات (تساوي الخطة الاحترافية، حتى 4 أعضاء) تبدأ تلقائياً مع إنشاء المشروع.
- الأساسية 29₪ (مالك + 1 موظف) — الاحترافية 59₪ (مالك + 3) — متعددة المشاريع 99₪ (مالك + 10).
- بعد انتهاء التجربة تعود الخطة للمجانية (مالك فقط) مع الحفاظ الكامل على البيانات؛ الترقية تُطلب من الإعدادات (تفعيل يدوي بلا بوابة دفع في v1).
