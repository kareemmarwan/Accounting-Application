-- 0006: الاشتراكات + التجربة المجانية + حدود الموظفين
alter table businesses
  add column if not exists subscription_status text not null default 'trialing',
  add column if not exists trial_ends_at timestamptz not null default (now() + interval '14 days');

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  plan text not null check (plan in ('basic','pro','business')),
  status text not null default 'requested' check (status in ('requested','active','canceled')),
  requested_by uuid not null references profiles(id),
  requested_at timestamptz not null default now(),
  activated_at timestamptz,
  period_end timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1
);

create index if not exists subscriptions_business_idx on subscriptions (business_id, status);

-- الخطة الفعّالة: التجربة غير المنتهية = pro كامل الميزات
create or replace function effective_plan(bid uuid)
returns text
language sql
security definer
stable
set search_path = public as $$
  select case
    when b.subscription_status = 'trialing' and b.trial_ends_at > now()
      then 'pro'
    when b.subscription_status = 'trialing' and b.trial_ends_at <= now()
      then 'free'
    when b.subscription_status = 'active' and exists (
      select 1 from subscriptions s
      where s.business_id = b.id and s.status = 'active'
        and (s.period_end is null or s.period_end > now())
    )
      then b.plan
    when b.subscription_status = 'active'
      then b.plan
    else 'free'
  end
  from businesses b
  where b.id = bid
$$;

-- الحد الأقصى للأعضاء (مالك + موظفون)
create or replace function plan_max_members(plan_name text)
returns int
language sql
immutable
as $$
  select case plan_name
    when 'basic' then 2
    when 'pro' then 4
    when 'business' then 11
    else 1
  end
$$;

-- حالة السعة: هل يمكن دعوة عضو جديد؟
create or replace function business_capacity(bid uuid)
returns jsonb
language sql
security definer
stable
set search_path = public as $$
  select jsonb_build_object(
    'plan', effective_plan(bid),
    'subscription_status', b.subscription_status,
    'trial_ends_at', b.trial_ends_at,
    'in_trial', b.subscription_status = 'trialing' and b.trial_ends_at > now(),
    'active_members', (
      select count(*) from business_members m
      where m.business_id = bid and m.status in ('active','invited')
    ),
    'max_members', plan_max_members(effective_plan(bid))
  )
  from businesses b
  where b.id = bid
$$;

create or replace function can_invite_member(bid uuid)
returns boolean
language sql
security definer
stable
set search_path = public as $$
  select (business_capacity(bid)->>'active_members')::int
    < (business_capacity(bid)->>'max_members')::int
$$;

create trigger set_updated_at_subscriptions before update on subscriptions
  for each row execute function set_updated_at();

alter table subscriptions enable row level security;

drop policy if exists subscriptions_select on subscriptions;
create policy subscriptions_select on subscriptions for select to authenticated
  using (is_member(business_id));

drop policy if exists subscriptions_insert on subscriptions;
create policy subscriptions_insert on subscriptions for insert to authenticated
  with check (is_owner(business_id) and requested_by = auth.uid());

drop policy if exists subscriptions_update on subscriptions;
create policy subscriptions_update on subscriptions for update to authenticated
  using (is_owner(business_id) and status = 'requested')
  with check (is_owner(business_id) and status in ('canceled','requested'));

-- سجل تعديل: عند انتهاء التجربة دون اشتراك، القيد النشط الوحيد هو المالك
-- (الحدود تُطبَّق في Server Actions + تعطيل الدعوات؛ البيانات محفوظة كاملة)
