-- 0013: مسؤولو المنصة (المالك الأول)
-- جدول على مستوى المنصة بلا business_id — استثناء مقصود (مثل profiles):
-- يحدد من يرى لوحة /admin ويجري عمليات الاشتراك عبر Server Actions بعميل الخدمة.
-- إضافة أدمن لاحقاً:
--   insert into platform_admins (user_id, note)
--   select id, 'وصف' from auth.users where lower(email) = 'الإيميل';

create table if not exists platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text not null default '',
  created_at timestamptz not null default now()
);

alter table platform_admins enable row level security;

drop policy if exists platform_admins_select on platform_admins;
create policy platform_admins_select on platform_admins for select to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on platform_admins to anon, authenticated, service_role;

insert into platform_admins (user_id, note)
select id, 'المالك الأول للتطبيق'
from auth.users
where lower(email) = 'kareemkemoo23@gmail.com'
on conflict (user_id) do nothing;
