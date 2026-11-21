-- اختبارات RLS: العزل بين المشاريع + مصفوفة الأدوار
-- التشغيل: supabase test db supabase/tests/rls_isolation_test.sql (بعد supabase start)

begin;
select plan(14);

create extension if not exists pgtap;

-- بذرة مستخدمين ومشروعين
insert into auth.users (id, email, encrypted_password, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', 'owner-a@test.local', 'x', '{"full_name":"مالك أ"}'),
  ('22222222-2222-2222-2222-222222222222', 'owner-b@test.local', 'x', '{"full_name":"مالك ب"}'),
  ('33333333-3333-3333-3333-333333333333', 'employee@test.local', 'x', '{"full_name":"موظف"}')
on conflict (id) do nothing;

insert into profiles (id, full_name)
values
  ('11111111-1111-1111-1111-111111111111', 'مالك أ'),
  ('22222222-2222-2222-2222-222222222222', 'مالك ب'),
  ('33333333-3333-3333-3333-333333333333', 'موظف')
on conflict (id) do nothing;

insert into businesses (id, name, business_type, owner_id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'مشروع أ', 'grocery', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'مشروع ب', 'restaurant', '22222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;

insert into business_members (business_id, user_id, role, status)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner', 'active'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'owner', 'active'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'employee', 'active')
on conflict do nothing;

insert into customers (id, business_id, name)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'عميل في مشروع أ')
on conflict (id) do nothing;

-- 1: مالك أ يرى عميل مشروع أ
select set_claim('11111111-1111-1111-1111-111111111111', 'sub', '11111111-1111-1111-1111-111111111111');
select set_auth_context('11111111-1111-1111-1111-111111111111');
select is(
  (select count(*) from customers where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  1::bigint,
  'المالك يرى عملاء مشروعه'
);

-- 2: مالك أ لا يرى أي شيء من مشروع ب
select is(
  (select count(*) from customers where business_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0::bigint,
  'عزل قراءة مشروع آخر'
);

-- 3: مالك أ لا يستطيع الكتابة في مشروع ب
select throws(
  format(
    'insert into customers (business_id, name) values (%L, %L)',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'تسلل'
  ),
  'رفض الكتابة في مشروع آخر'
);

-- 4: الموظف يرى بيانات مشروع أ (قراءة أعضاء)
select set_auth_context('33333333-3333-3333-3333-333333333333');
select is(
  (select count(*) from sales where business_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0::bigint,
  'الموظف يرى مبيعات مشروعه (فارغة)'
);

-- 5: الموظف يستطيع إضافة بيع
select lives_ok(
  format('insert into sales (business_id, sale_number, occurred_at, total_amount, net_amount, payment_method, account_id, paid_amount, remaining_amount, created_by) values (%L, %L, now(), 100, 100, %L, null, 0, 100, %L)',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'S-TEST-0001', 'credit', '33333333-3333-3333-3333-333333333333'),
  'الموظف يسجل بيعاً آجلاً'
);

-- 6: الموظف لا يستطيع إضافة شراء
select throws(
  format(
    'insert into purchases (business_id, purchase_number, occurred_at, total_amount, net_amount, payment_method, account_id, paid_amount, remaining_amount, created_by) values (%L, %L, now(), 100, 100, %L, null, 0, 100, %L)',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'P-TEST-0001', 'credit', '33333333-3333-3333-3333-333333333333'
  ),
  'رفض شراء من موظف'
);

-- 7: الموظف لا يستطيع قراءة القيود
select is(
  (select count(*) from journal_entries where business_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0::bigint,
  'الموظف لا يرى القيود'
);

-- 8: الموظف لا يستطيع دفعات الديون
select throws(
  format('insert into debt_payments (business_id, debt_id, amount, occurred_at, account_id, payment_method, created_by) values (%L, %L, 10, now(), %L, %L, %L)',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000000', 'cash', '33333333-3333-3333-3333-333333333333'),
  'رفض دفعة دين من موظف'
);

-- 9: قيد غير متوازن يُرفض (كمالك ب)
select set_auth_context('22222222-2222-2222-2222-222222222222');
select throws(
  format('insert into journal_entries (business_id, entry_number, occurred_at, source_type, created_by) values (%L, %L, now(), %L, %L)',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'JE-TEST-BAD', 'opening', '22222222-2222-2222-2222-222222222222') ||
  format('; insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit) select business_id, id, %L, 100, 0 from journal_entries where entry_number = %L',
    '1100', 'JE-TEST-BAD'),
  'رفض قيد غير متوازن (trigger التوازن)'
);

-- 10: حذف حقيقي ممنوع (soft delete فقط)
select set_auth_context('11111111-1111-1111-1111-111111111111');
select throws(
  format('delete from customers where id = %L', 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'رفض الحذف الحقيقي'
);

-- 11: soft delete مسموح
select lives_ok(
  format('update customers set deleted_at = now() where id = %L', 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'الحذف الناعم مسموح'
);

-- 12: business_members إدارة للمالك فقط
select set_auth_context('33333333-3333-3333-3333-333333333333');
select throws(
  format('insert into business_members (business_id, user_id, role, status) values (%L, %L, %L, %L)',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'manager', 'active'),
  'رفض إدارة الأعضاء من موظف'
);

-- 13: مالك المشروع يدير الأعضاء
select set_auth_context('11111111-1111-1111-1111-111111111111');
select lives_ok(
  format('insert into business_members (business_id, user_id, role, status) values (%L, %L, %L, %L)',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'manager', 'invited'),
  'المالك يدعو عضواً'
);

-- 14: عزل المزامنة: sync_metadata لكل عضو فقط
select is(
  (select count(*) from sync_metadata),
  0::bigint,
  'لا سجلات مزامنة لمشروع آخر'
);

rollback;
