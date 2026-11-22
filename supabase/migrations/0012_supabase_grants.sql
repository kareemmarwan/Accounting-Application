-- 0012: المنح القياسية لدور Supabase
-- المشكلة: الجداول أُنشئت عبر SQL Editor بلا منح تلقائية لدور anon/authenticated/service_role
-- فرفض PostgREST أي وصول مباشر: 42501 permission denied for table businesses
-- (سياسات RLS لا تلغي الحاجة إلى GRANT على الجدول نفسه — RLS يرشّح الصفوف،
-- والمنح تسمح بالوصول أصلاً)

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;

grant usage, select, update on all sequences in schema public
  to anon, authenticated, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables
  to anon, authenticated, service_role;

alter default privileges in schema public
  grant usage, select, update on sequences
  to anon, authenticated, service_role;
