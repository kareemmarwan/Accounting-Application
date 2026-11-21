# DATABASE_SCHEMA.md — تصميم قاعدة البيانات (Supabase PostgreSQL)

> يُقرأ بعد PROJECT_PLAN.md وARCHITECTURE.md. المخطط الرسمي الذي تُبنى منه Migrations.

---

## 1. قواعد عامة (Conventions)

- المفاتيح: `id uuid primary key default gen_random_uuid()`.
- المبالغ: `numeric(14,2)` — لا Float إطلاقاً. العملة: `currency char(3) default 'ILS'`.
- الطوابع الزمنية: `created_at timestamptz default now()`, `updated_at timestamptz default now()` (يحدّثه trigger).
- **Soft Delete**: `deleted_at timestamptz null` على كل جدول بيانات مشروع.
- **Optimistic concurrency**: `version integer not null default 1` على الكيانات القابلة للتعديل.
- كل جدول بيانات مشروع يحمل `business_id uuid not null references businesses(id)` + **RLS مفعّل**.
- المزامنة: `updated_at` يُحدّث آلياً (trigger) ويُستخدم كـ watermark للسحب الدلتا.
- دوال/Triggers مشتركة: `set_updated_at()`, `assert_balanced_entry()`, `next_doc_number(business_id, doc_type)`, `is_member(business_id)`.

### Enums

```sql
create type user_role           as enum ('owner','manager','accountant','employee');
create type business_type       as enum ('grocery','restaurant','clothing','food','produce','electronics','trade','services','other');
create type account_type        as enum ('cash','bank','wallet','other');
create type payment_method      as enum ('cash','bank_transfer','palpay','jawwal_pay','electronic','credit');
create type doc_status          as enum ('draft','posted','void');
create type debt_direction      as enum ('receivable','payable');
create type debt_status         as enum ('open','partial','settled');
create type entry_source        as enum ('sale','purchase','expense','debt_payment','transfer','deposit','withdrawal','opening','adjustment','inventory','reversal');
create type sync_state          as enum ('pending','syncing','synced','failed','conflict'); -- محلياً فقط، للمرجعية
```

---

## 2. الجداول

### 2.1 profiles
| عمود | نوع | ملاحظات |
|---|---|---|
| id | uuid PK | = `auth.users.id` |
| full_name | text not null | |
| phone | text | |
| locale | text default 'ar' | |
| created_at / updated_at | timestamptz | |

### 2.2 businesses
| عمود | نوع | ملاحظات |
|---|---|---|
| id | uuid PK | |
| name | text not null | اسم المشروع |
| business_type | business_type not null | |
| owner_id | uuid → profiles | صاحب المشروع |
| currency | char(3) default 'ILS' | |
| phone, address, logo_url | text | |
| fiscal_year_start | date default '01-01' | بداية السنة المالية |
| settings | jsonb default '{}' | تفضيلات (تنسيق تاريخ، إشعارات…) |
| plan | text default 'free' | free/basic/pro/business (تفعيل لاحقاً) |
| created_at / updated_at / deleted_at / version | | |

### 2.3 business_members
| عمود | نوع | ملاحظات |
|---|---|---|
| id | uuid PK | |
| business_id | uuid FK | |
| user_id | uuid → profiles | |
| role | user_role not null | |
| permissions | jsonb default '{}' | تخصيص إضافي فوق الدور |
| status | text default 'active' | active/invited/removed |
| invited_by | uuid | |
| **unique (business_id, user_id)** | | |

### 2.4 financial_accounts
| عمود | نوع | ملاحظات |
|---|---|---|
| id, business_id | | |
| name | text not null | «الصندوق الرئيسي»، «بنك فلسطين»… |
| type | account_type not null | cash/bank/wallet/other |
| provider | text | bank_palestine/palpay/jawwal_pay/other |
| currency | char(3) default 'ILS' | |
| opening_balance | numeric(14,2) default 0 | |
| current_balance | numeric(14,2) default 0 | يديره المحرك في transaction |
| total_deposits / total_withdrawals | numeric(14,2) default 0 | إحصاءات تراكمية |
| gl_account_code | text | 1100 أو 1200 حسب النوع |
| is_active | boolean default true | |
| timestamps / deleted_at / version | | |

### 2.5 customers & suppliers (نفس البنية)
| عمود | نوع | ملاحظات |
|---|---|---|
| id, business_id, name not null, phone, address, notes | | |
| current_balance | numeric(14,2) default 0 | العملاء: ما علينا قبضه (+). الموردون: ما ندينه (+) |
| total_transactions | numeric(14,2) default 0 | إجمالي التعاملات |
| last_transaction_at | timestamptz | |
| timestamps / deleted_at / version | | |

### 2.6 sales
| عمود | نوع | ملاحظات |
|---|---|---|
| id, business_id | | |
| sale_number | text | نهائي من الخادم: `S-2026-0001` |
| customer_id | uuid → customers null | بيع نقدي بلا عميل مسموح |
| occurred_at | timestamptz not null | تاريخ/وقت العملية |
| description | text | |
| total_amount | numeric(14,2) not null | قبل الخصم |
| discount | numeric(14,2) default 0 | |
| net_amount | numeric(14,2) not null | = total − discount (يولّده المحرك) |
| payment_method | payment_method not null | |
| account_id | uuid → financial_accounts null | إلزامي إلا مع `credit` |
| paid_amount | numeric(14,2) not null | ≥0 و≤ net |
| remaining_amount | numeric(14,2) not null | = net − paid |
| debt_id | uuid → debts null | يُنشأ تلقائياً عند الآجل |
| status | doc_status default 'posted' | |
| notes | text | |
| created_by | uuid → profiles | |
| posted_at | timestamptz | |
| voided_at / voided_by / void_reason | | للإلغاء بقيد عكسي |
| timestamps / deleted_at / version | | |
| **unique (business_id, sale_number)** | | |

### 2.7 purchases (+ purchase_items)
نفس بنية sales مع: `purchase_number` (`P-…`)، `supplier_id`، `transfer_reference` (رقم التحويل البنكي)، `receipt_attachment_id`، `transfer_proof_attachment_id`. الحساب = المدفوع منه.

**purchase_items:** `id, purchase_id FK, product_id null, name text, quantity numeric(14,3), unit_price numeric(14,2), total numeric(14,2)` — يُفعَّل مع المخزون.

### 2.8 expenses
| عمود | نوع |
|---|---|
| id, business_id | |
| title | text not null |
| category_id | uuid → expense_categories |
| amount | numeric(14,2) not null |
| occurred_at | timestamptz not null |
| payment_method | payment_method not null (لا `credit` في v1 للمصروف) |
| account_id | uuid → financial_accounts not null |
| receipt_attachment_id | uuid → attachments null |
| notes, status doc_status, created_by, voided_* | |
| timestamps / deleted_at / version | |

### 2.9 expense_categories
`id, business_id, name not null, is_system boolean default false, sort_order int` — تصنيفات افتراضية تُزرع عند إنشاء المشروع (إيجار، كهرباء، مياه، أجور، مواصلات، صيانة، إنترنت، مواد تشغيلية، إدارية، أخرى) وكل واحدة بند GL 51xx مرتبط.

### 2.10 debts
| عمود | نوع | ملاحظات |
|---|---|---|
| id, business_id | | |
| direction | debt_direction not null | receivable=عملاء / payable=موردون |
| customer_id / supplier_id | uuid null | واحد منهما إلزامي حسب الاتجاه |
| source_type | text | sale/purchase/manual |
| source_id | uuid null | المستند الأصلي |
| amount | numeric(14,2) not null | أصل الدين |
| paid_amount | numeric(14,2) default 0 | |
| remaining_amount | numeric(14,2) not null | يحدّثه المحرك مع كل دفعة |
| due_date | date | تاريخ الاستحقاق |
| status | debt_status | open/partial/settled |
| notes | text | |
| timestamps / deleted_at / version | | |

### 2.11 debt_payments
| عمود | نوع | ملاحظات |
|---|---|---|
| id, business_id, debt_id FK | | |
| amount | numeric(14,2) not null | ≤ remaining وقت التسجيل |
| occurred_at | timestamptz not null | |
| account_id | uuid → financial_accounts not null | حساب الاستلام/الدفع |
| payment_method | payment_method not null | |
| journal_entry_id | uuid → journal_entries | ربط القيد |
| notes, created_by | | |
| timestamps / deleted_at / version | | |

**قاعدة:** مجموع دفعات الدين ≤ أصل الدين. الزيادة تُرفض أو تُسجل كـ «رصيد دائن» عبر آلية صريحة (credit_note على الجهة) — قرار مستخدم، لا صمت.

### 2.12 journal_entries & journal_entry_lines
**journal_entries:** `id, business_id, entry_number (JE-…), occurred_at, description, source_type entry_source, source_id uuid, status ('posted'), reversal_of_entry_id uuid null, created_by, timestamps`.
**journal_entry_lines:** `id, entry_id FK, gl_account_code text not null, debit numeric(14,2) default 0, credit numeric(14,2) default 0, financial_account_id uuid null, party_type text null ('customer'|'supplier'), party_id uuid null, description`.

- **Trigger `assert_balanced_entry`:** يرفض أي entry مجموع مدينه ≠ مجموع دائنه أو سطراً بكل من debit وcredit أو بسعر صفر.
- كل قيد مالي مرتبط بعملية مصدر — لا قيود يدوية معلقة في v1 (تصحيح عبر reversal).

### 2.13 chart_of_accounts
`id, business_id (null = قالب نظام), code text not null, name text not null, type (asset/liability/equity/revenue/expense), parent_code text null, is_system boolean, sort_order`. unique `(coalesce(business_id,'000…'), code)`.

### 2.14 attachments
`id, business_id, storage_path text not null, bucket text, mime_type, size_bytes, entity_type, entity_id, uploaded_by, timestamps, deleted_at`.
Storage: bucket واحد `attachments` بمسار `{business_id}/{entity}/{uuid}.{ext}` + Storage Policies بنفس شرط RLS.

### 2.15 audit_logs
`id, business_id, user_id, action (create/update/void/delete/sync…), entity_type, entity_id, old_values jsonb, new_values jsonb, created_at`. **Insert-only** (لا تعديل/حذف — policy للقراءة للـ owner/manager فقط).

### 2.16 operation_log (Idempotency)
`id uuid PK, business_id, client_op_id uuid not null, op_type text not null, result jsonb, created_at`. **unique (business_id, client_op_id)** — أساس منع التكرار في المزامنة.

### 2.17 sync_metadata (per device)
`id, business_id, device_id text not null, last_pulled_at timestamptz, watermarks jsonb, last_push_at`. unique `(business_id, device_id)`.

### 2.18 notifications
`id, business_id, user_id null (null=للجميع), type text, title text, body text, data jsonb, read_at, created_at`.

### 2.19 business_sequences
`business_id, doc_type text, prefix text, last_number int default 0, year int` — PK `(business_id, doc_type, year)`؛ الدالة `next_doc_number` ذرّية (transaction).

### 2.20 (لاحقاً) products & inventory_movements
`products`: id, business_id, name, category, unit, purchase_price, sale_price, quantity, min_quantity, barcode, supplier_id, is_active.
`inventory_movements`: id, business_id, product_id, type (in/out/adjust/return), quantity, unit_cost, ref_type, ref_id, occurred_at. — تُفعَّل مع Phase 7 دون تغيير جداول المحاسبة.

---

## 3. Row Level Security (نمط موحد)

```sql
create or replace function is_member(bid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from business_members m
    where m.business_id = bid and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

create or replace function user_role_in(bid uuid, roles user_role[]) returns boolean ...;
```

لكل جدول بيانات مشروع:

| Policy | USING/WITH CHECK |
|---|---|
| SELECT | `is_member(business_id)` |
| INSERT | `is_member(business_id)` + دور مسموح بالكتابة |
| UPDATE | `is_member(business_id)` + دور مسموح + `version` تُفحص في الخدمة |
| DELETE | حقيقي ⛔ — الحذف ناعم فقط (UPDATE deleted_at)؛ Owner/Manager للـ void |

- **Employee**: insert على sales/expenses فقط؛ لا قراءة لأرصدة الحسابات البنكية ولا تقارير.
- **Owner فقط**: business_members (إدارة)، businesses (تعديل)، audit_logs (قراءة)، حذف ناعم نهائي.
- المرفقات: Storage policy بنفس `is_member` على مسار `{business_id}/…`.

---

## 4. الفهارس الأساسية

```sql
create index on sales         (business_id, occurred_at desc);
create index on sales         (business_id, customer_id) where customer_id is not null;
create index on purchases     (business_id, occurred_at desc);
create index on purchases     (business_id, supplier_id);
create index on expenses      (business_id, occurred_at desc);
create index on expenses      (business_id, category_id);
create index on debts         (business_id, direction, status);
create index on debt_payments (business_id, debt_id, occurred_at);
create index on journal_entry_lines (entry_id);
create index on journal_entry_lines (financial_account_id);
create index on journal_entries (business_id, occurred_at desc);
create index on journal_entries (business_id, source_type, source_id);
create index on business_members (user_id);
create index on operation_log   (business_id, client_op_id); -- unique يغطيها
create index on customers/suppliers (business_id, name);
-- فهرس partial للدلتا سحباً:
create index on sales (business_id, updated_at) where deleted_at is null;
```

---

## 5. Triggers & Functions

| الاسم | المهمة |
|---|---|
| `set_updated_at()` | trigger على كل جدول: `updated_at = now()` |
| `assert_balanced_entry()` | منع قيد غير متوازن/سطور فاسدة (قبل insert على lines: إعادة فحص مجموع الأب) |
| `next_doc_number(bid, doc_type)` | ترقيم ذري سنوي: `S-2026-0001` |
| `increment_member_totals()` | بعد قيد دفعة: تحديث `current_balance` للحساب المالي و`customers/suppliers.current_balance` و`debts.remaining_amount` — دائماً داخل نفس transaction المحرك (المحرك يكتب القيم، الـ trigger حارس تحقق لا مُعِدّ مستقل) |

**قرار:** أرصدة denormalized يكتبها المحرك صراحة في نفس الـ transaction؛ الحُرّاس (triggers) تتحقق من الاتساق وتفشل العملية عند الانحراف. تقرير مطابقة دوري (`balance.ts`) يكتشف أي انحراف.

---

## 6. مصفوفة الصلاحيات (تفصيل RLS لكل دور)

| الجدول/العملية | Owner | Manager | Accountant | Employee |
|---|---|---|---|---|
| sales/purchases/expenses: insert | ✅ | ✅ | ✅ | sales+expenses فقط |
| void مستند مرحّل | ✅ | ✅ | ✅ | ⛔ |
| debt_payments: insert | ✅ | ✅ | ✅ | ⛔ |
| customers/suppliers: كتابة | ✅ | ✅ | ✅ | ⛔ (قراءة) |
| financial_accounts: قراءة الأرصدة | ✅ | ✅ | ✅ | ⛔ |
| financial_accounts: معاملات (تحويل/إيداع/تسوية) | ✅ | ✅ | ✅ | ⛔ |
| journal_entries: قراءة | ✅ | ✅ | ✅ | ⛔ |
| reports | ✅ | ✅ | ✅ | ⛔ |
| business_members إدارة | ✅ | ⛔ | ⛔ | ⛔ |
| businesses تعديل/إعدادات | ✅ | جزئي | ⛔ | ⛔ |
| audit_logs قراءة | ✅ | ✅ | ⛔ | ⛔ |

---

## 7. استراتيجية Migrations

- مجلد `supabase/migrations/` ملفات مرقمة تسلسلياً: `0001_init_extensions.sql`, `0002_enums.sql`, `0003_core_tables.sql`, …
- كل migration idempotent حيث أمكن (`create type if not exists` عبر DO blocks).
- Seed منفصل `supabase/seed/demo.sql` — بيانات تجربة فقط، لا تُطبق على الإنتاج.
- التطبيق عبر Supabase CLI: `supabase db push` (يتطلب مشروع Supabase مربوطاً — انظر README لاحقاً).
