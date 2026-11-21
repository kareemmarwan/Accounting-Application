# ARCHITECTURE.md — المعمارية الهندسية

> يُقرأ بعد PROJECT_PLAN.md. هذا الملف يشرح **كيف** يعمل النظام تقنياً.

---

## 1. طبقات النظام والمسؤوليات

| الطبقة | الموقع | المسؤولية | ممنوعات |
|---|---|---|---|
| UI Components | `src/components`, `src/features/*/components` | عرض فقط، استدعاء hooks/services | أي منطق محاسبي أو حسابات مالية |
| Feature Services | `src/features/<module>/services` | تنسيق العمليات: تحقق Zod → استدعاء المحرك → كتابة محلية → Outbox | تفاصيل SQL/HTTP |
| Accounting Engine | `src/core/accounting` | دوال نقية: بناء القيود، حساب الأرصدة، التحقق من التوازن | أي I/O، أي React، أي DB |
| Local DB | `src/core/db` | مخطط Dexie + مستودعات (repositories) + Outbox | منطق أعمال |
| Sync Engine | `src/core/sync` | Push/Pull، إعادة محاولة، تعارضات، حالة المزامنة | منطق محاسبي |
| Server Actions/API | `src/app/api`, `src/features/*/server` | تشغيل المحرك داخل transaction + RLS + Audit | ثقة ببيانات العميل |
| Validation | `src/core/validation` | مخططات Zod لكل كيان وحمولة مزامنة | — |

---

## 2. هيكل المجلدات

```
src/
├── app/
│   ├── (auth)/                  # تسجيل/دخول/onboarding
│   ├── (app)/                   # التطبيق الرئيسي (بسايدبار)
│   │   ├── dashboard/
│   │   ├── sales/
│   │   ├── purchases/
│   │   ├── debts/
│   │   ├── expenses/
│   │   ├── accounts/            # الصندوق والحسابات المالية
│   │   ├── contacts/            # العملاء والموردون
│   │   ├── reports/
│   │   └── settings/
│   ├── api/                     # نقاط المزامنة والخدمات الخلفية
│   ├── layout.tsx               # RTL + Cairo + SW registration
│   └── page.tsx                 # صفحة هبوط
├── core/
│   ├── accounting/              # المحرك المحاسبي (نقي)
│   │   ├── money.ts             # تمثيل المبالغ (integers minor units)
│   │   ├── types.ts
│   │   ├── chart-of-accounts.ts # دليل الحسابات الافتراضي
│   │   ├── engine.ts            # بناة القيود + التحقق
│   │   └── balance.ts           # اشتقاق الأرصدة من القيود
│   ├── db/                      # Dexie schema + repositories + outbox
│   ├── sync/                    # محرك المزامنة
│   ├── supabase/                # عملاء Supabase (browser/server)
│   └── validation/              # مخططات Zod
├── features/                    # sales, purchases, expenses, debts,
│  (لكل ميزة)                     # accounts, contacts, dashboard, reports, settings
│   └── <feature>/{components,services,hooks,types,server}
├── components/                  # ui/ (shadcn-style), layout/, shared/
├── lib/                         # format (عملة/تاريخ), utils, constants
└── types/
supabase/
├── migrations/                  # SQL migrations (ترتيبياً)
└── seed/                        # بيانات demo منفصلة
public/
├── manifest.webmanifest
├── sw.js
└── icons/
scripts/
└── generate-icons.mjs           # توليد أيقونات PNG للـ PWA
```

---

## 3. المحرك المحاسبي (Financial Accounting Engine)

### 3.1 دليل الحسابات الافتراضي (System Chart of Accounts)

| الكود | الاسم | النوع | ملاحظات |
|---|---|---|---|
| 1000 | الأصول | asset | أب |
| 1100 | الصندوق النقدي | asset | مربوط بحسابات `cash` |
| 1200 | البنوك والمحافظ | asset | مربوط بحسابات `bank/wallet` |
| 1300 | العملاء (مدينون) | asset | AR |
| 1400 | المخزون | asset | يُفعَّل مع المخزون |
| 2000 | الالتزامات | liability | أب |
| 2100 | الموردون (دائنون) | liability | AP |
| 3000 | حقوق الملكية | equity | أب |
| 3100 | رأس المال الافتتاحي | equity | أرصدة الافتتاح |
| 4000 | الإيرادات | revenue | أب |
| 4100 | المبيعات | revenue | |
| 4900 | خصومات مبيعات | revenue | رصيد مدين طبيعي |
| 5000 | المصروفات | expense | أب |
| 5100+ | بند لكل تصنيف مصروف | expense | إيجار، كهرباء... (من expense_categories) |
| 5900 | تكلفة المبيعات/المشتريات | expense | لغير المخزنين |

### 3.2 قوالب القيود (Entry Templates)

المبالغ بالأجور/الوحدات الصغرى. `CASH` = الصندوق أو الحساب المالي المختار.

| العملية | مدين | دائن |
|---|---|---|
| **بيع نقدي (صافي N، خصم D)** | CASH = N | مبيعات = N |
| **بيع آجل (صافي N)** | عملاء = N | مبيعات = N |
| **بيع مختلط (مدفوع P، متبقٍ R، صافي N=P+R)** | CASH = P، عملاء = R | مبيعات = N |
| **خصم مبيعات (إن أُطبق على مستوى القيد)** | خصومات = D | مبيعات = D (معكوس) |
| **شراء مع مخزون (صافي N، مدفوع P)** | مخزون = N | CASH = P، موردون = R |
| **شراء بدون مخزون (صافي N، مدفوع P)** | تكلفة مبيعات = N | CASH = P، موردون = R |
| **دفعة دين مستحق (عملاء)** | CASH = M | عملاء = M |
| **سداد دين دائن (موردون)** | موردون = M | CASH = M |
| **مصروف (تصنيف X)** | مصروف X = M | CASH = M |
| **تحويل بين حسابين** | حساب الوجهة = M | حساب المصدر = M |
| **رصيد افتتاحي موجب** | CASH = O | رأس مال افتتاحي = O |
| **تسوية رصيد (نقص فعلي)** | مصروف تسويات = Δ | CASH = Δ (والعكس للزيادة) |
| **Void (إلغاء عملية مرحّلة)** | معكوس القيد الأصلي بالكامل | مرتبط بـ `reverses_entry_id` |

- بيع = سطران دائمان على الأقل (مبيعات + آجل إن وجد)؛ لا يُسمح بـ `paid > net` ولا `remaining < 0` ولا قيم سالبة.
- مع المخزون: عند البيع يضاف قيد تكلفة (مدين: تكلفة مبيعات / دائن: مخزون) إذا توفرت تكلفة الوحدة.

### 3.3 الثوابت (Invariants) — يتحقق منها المحرك قبل أي كتابة

1. `sum(debit) === sum(credit)` (بوحدات صغرى) وإلا `UnbalancedEntryError`.
2. لا مبالغ صفرية في السطور، لا قيم سالبة.
3. كل قيد مرتبط بعملية مصدر (`source_type` + `source_id`) — قابل للتتبع.
4. القيد المرحّل للقراءة فقط؛ التصحيح عبر قيد عكسي.
5. رصيد أي حساب مالي ≥ 0 بعد كل عملية (سحب أكثر من الرصيد = `InsufficientBalanceError` إلا في التسوية الصريحة).

### 3.4 تمثيل المبالغ (money.ts)

- `Minor = number` (وحدات صغرى صحيحة: أغورة للـ ILS).
- `toMinor(decimalString: string): Minor` — تحويل آمن من إدخال المستخدم.
- `fromMinor(m: Minor): string` — للعرض والتخزين.
- `add/sub/mulQty` بعمليات صحيحة فقط. صفر كسور = خطأ إدخال مرفوض.

### 3.5 الاستخدام المزدوج للدوال

```
Online:  Server Action → engine.buildSaleEntry(payload) → DB transaction → canonical result
Offline: UI → engine.validate + اختيار محلي → Dexie write (doc + مؤقتات أرصدة) → Outbox.push(opPayload)
Sync:    Server يعيد اشتقاق القيود من opPayload → يرجع Canonical Doc → العميل يستبدل نسخته
```

المحرك دوال نقية بلا I/O — نفس الملف يعمل في المتصفح والخادم (لا Node APIs).

---

## 4. قاعدة البيانات المحلية (Dexie)

| الجدول | الوصف |
|---|---|
| `businesses` | بيانات المشروع (كاش للمتاح دون إنترنت) |
| `financial_accounts`, `customers`, `suppliers` | كيانات أساسية |
| `sales`, `purchases`, `purchase_items`, `expenses`, `expense_categories` | مستندات |
| `debts`, `debt_payments` | ديون ودفعات |
| `journal_entries`, `journal_entry_lines` | القيود المحلية (للعرض/تقارير محلية) |
| `attachments_meta` | بيانات المرفقات (الملف نفسه يُخزن لاحقاً Blob عند الحاجة) |
| **`outbox`** | طابور العمليات: `{id uuid, opType, payload, createdAt, attempts, status, lastError, dependsOn}` |
| `sync_meta` | `{deviceId, lastPulledAt, perTableWatermarks}` |
| `notifications`, `audit_log_local` | إشعارات وسجل محلي |

- كل سجل يحمل: `id (uuid)`, `businessId`, `updatedAt`, `syncStatus` (`pending|syncing|synced|failed|conflict`), `deletedAt` (soft delete).
- المزامنة لا تعتمد LocalStorage إطلاقاً. جلسة Auth الصالحة محلياً فقط تسمح بالدخول — لا صلاحيات فوق منتهية.

---

## 5. محرك المزامنة (Sync Engine)

### 5.1 حالات العملية

```
pending ──▶ syncing ──▶ synced
               │
               ├──▶ failed (retry مع backoff: 5s, 30s, 2m, 10m… max 12)
               └──▶ conflict (يتطلب قرار المستخدم)
```

### 5.2 دورة المزامنة (عند عودة الاتصال)

1. اكتشاف الاتصال (`online` event + heartbeat).
2. **Push** بترتيب طوبولوجي: الوجوه الأساسية (customers/suppliers/accounts) قبل مستنداتها؛ العمليات لكل عمل تجاري بالتسلسل.
3. لكل عملية: إرسال `opPayload` + `clientOpId (uuid)` إلى `/api/sync/push`.
4. الخادم: Idempotency — جدول `operation_log` بقيود unique على `(business_id, client_op_id)`؛ العملية المكررة تُرجع النتيجة المحفوظة دون تنفيذ.
5. الخادم يطبق المحرك داخل transaction ويُرجع المستند الكانوني (رقم نهائي، مبالغ محسوبة، `version` جديد).
6. العميل يستبدل نسخته المحلية بالكانونية ويحدث الحالة `synced`.
7. **Pull**: سحب دلتا لكل جدول `updated_at > watermark` + حلول التعارضات + تنظيف الحذف الناعم.

### 5.3 سياسة التعارضات (Conflicts)

| النوع | الاستراتيجية |
|---|---|
| عمليات مالية (مبيعات/مشتريات/دفعات/تحويلات) | **Server-authoritative** — لا LWW. الخادم يشتق الحقيقة؛ العميل يتبنى النتيجة ويعرض إشعاراً بأي فرق. |
| تعديل كيان (عميل/مورد/حساب) | Optimistic concurrency: عمود `version`؛ عدم تطابق ⇒ `conflict` وواجهة «احتفظ بنسختي / خذ نسخة الخادم». |
| حذف + تعديل متزامن | الحذف الناعم يفوز إذا كان لاحقاً؛ إشعار المستخدم. |
| قيد مرحّل | غير قابل للكتابة من أي جهة — تصحيح فقط بقيد عكسي. |

### 5.4 ضمانات

- **لا فقدان:** الكتابة محلياً أولاً (Dexie transactions) قبل أي محاولة شبكة.
- **لا تكرار:** UUID + Idempotency على الخادم.
- **ترتيب:** طابور FIFO + تبعيات `dependsOn`.
- **شفافية:** مؤشر حالة المزامنة في الواجهة + سجل مزامنة قابل للعرض.

---

## 6. الأمان

| الطبقة | الآلية |
|---|---|
| Auth | Supabase Auth (email+password أولاً)؛ جلسة محلية صالحة تسمح بعمل Offline حتى انتهائها الفعلي — لا تجاوز صلاحيات |
| Authorization | RLS على كل جدول: العضوية النشطة في `business_members` شرط لكل قراءة/كتابة |
| API | Server Actions تتحقق من الجلسة والدور والملكية قبل تشغيل المحرك |
| Attachments | Storage Buckets بمسار `business_id/...` + Storage Policies بنفس شرط RLS |
| Secrets | فقط `anon key` في المتصفح. Service Role Key يبقى في الخادم/بيئات آمنة فقط |
| Audit | `audit_logs` لكل عملية حساسة (من/ماذا/متى/قيم قديمة-جديدة) |

---

## 7. PWA والعمل دون إنترنت

- **manifest.webmanifest**: اسم عربي، أيقونات 192/512 (SVG + PNG مولدة بسكربت)، `display: standalone`, `dir: rtl`, `lang: ar`.
- **Service Worker (يدوي):**
  - Precache: App Shell (HTML skeleton، JS/CSS الأساسي، الخطوط) + صفحة Offline.
  - Navigation: Network-first مع fallback للـ shell المحفوظ.
  - Static assets: Cache-first (تحديث عند نسخة جديدة).
  - **لا تخزين كاش لاستجابات البيانات المالية** — البيانات من Dexie فقط.
  - استراتيجية إبطال: نسخة الكاش بالـ build hash.
- تسجيل SW من مكون عميل، مع مؤشر حالة Online/Offline و«N عملية بانتظار المزامنة».
- Background Sync عند توفره (`SyncManager`) مع بديل مؤقت بالـ heartbeat.

---

## 8. الترقيم والمستندات

- الخادم يعين رقم المستند النهائي من `business_sequences` (function ذرية): `S-2026-0001`, `P-…`, `JE-…`.
- محلياً: مرجع مؤقت `L-<uuid8>` يُستبدل بالرقم النهائي عند المزامنة.

---

## 9. الأداء

- فهارس Dexie على `businessId + date` و`syncStatus` لكل جدول مستندات.
- حساب الأرصدة: تحديث تفاضلي عند كل عملية (delta) + إعادة احتساب دورية للتحقق (`balance.ts` reconciliation).
- رسوم Recharts تُغذى من بيانات مجمعة (daily aggregates) لا من الجداول الخام في الشاشات الثقيلة.
- تقسيم الشيفرة: صفحات Server Components افتراضياً؛ مكونات الرسوم والنماذج `"use client"`.
