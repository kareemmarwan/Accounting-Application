-- =====================================================================
-- تطبيق المحاسبة — سكربت إنشاء قاعدة البيانات كاملة (ملف واحد)
-- Supabase Dashboard → SQL Editor → New query → الصق الملف كاملاً → Run
-- ينفَّذ مرة واحدة فقط. عند أي خطأ يتراجع كل شيء (لا تطبيق جزئي).
-- =====================================================================

begin;

-- ============================================================
-- 0001_init_extensions.sql
-- ============================================================
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ============================================================
-- 0002_enums.sql
-- ============================================================
do $$ begin
  create type user_role as enum ('owner','manager','accountant','employee');
exception when duplicate_object then null; end $$;

do $$ begin
  create type business_type as enum ('grocery','restaurant','clothing','food','produce','electronics','trade','services','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type account_type as enum ('cash','bank','wallet','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_method as enum ('cash','bank_transfer','palpay','jawwal_pay','electronic','credit');
exception when duplicate_object then null; end $$;

do $$ begin
  create type doc_status as enum ('draft','posted','void');
exception when duplicate_object then null; end $$;

do $$ begin
  create type debt_direction as enum ('receivable','payable');
exception when duplicate_object then null; end $$;

do $$ begin
  create type debt_status as enum ('open','partial','settled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type entry_source as enum ('sale','purchase','expense','debt_payment','transfer','deposit','withdrawal','opening','adjustment','inventory','reversal');
exception when duplicate_object then null; end $$;

-- ============================================================
-- 0003_core_tables.sql
-- ============================================================
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop function if exists next_doc_number(uuid, text, timestamptz);

create or replace function next_doc_number(bid uuid, p_doc_type text, p_at timestamptz default now())
returns text
language plpgsql security definer set search_path = public as $$
declare
  prefix text;
  y int;
  n int;
begin
  if p_doc_type = 'sale' then prefix := 'S';
  elsif p_doc_type = 'purchase' then prefix := 'P';
  elsif p_doc_type = 'journal' then prefix := 'JE';
  else raise exception 'نوع مستند غير مدعوم: %', p_doc_type;
  end if;
  y := extract(year from p_at)::int;
  insert into business_sequences (business_id, doc_type, prefix, last_number, year)
  values (bid, p_doc_type, prefix, 1, y)
  on conflict (business_id, doc_type, year)
  do update set last_number = business_sequences.last_number + 1
  returning last_number into n;
  return prefix || '-' || y || '-' || lpad(n::text, 4, '0');
end $$;

create or replace function assert_balanced_entry() returns trigger
language plpgsql as $$
declare
  rec record;
  total_debit numeric(14,2);
  total_credit numeric(14,2);
  bad_lines int;
begin
  for rec in select distinct entry_id from inserted_lines loop
    select coalesce(sum(debit),0), coalesce(sum(credit),0)
      into total_debit, total_credit
      from journal_entry_lines where entry_id = rec.entry_id;
    if total_debit <> total_credit or total_debit = 0 then
      raise exception 'قيد غير متوازن: مدين=% دائن=% (entry=%)', total_debit, total_credit, rec.entry_id;
    end if;
    select count(*) into bad_lines
      from journal_entry_lines
      where entry_id = rec.entry_id
        and ((debit > 0 and credit > 0) or (debit = 0 and credit = 0) or debit < 0 or credit < 0);
    if bad_lines > 0 then
      raise exception 'سطور قيد فاسدة (entry=%)', rec.entry_id;
    end if;
  end loop;
  return null;
end $$;

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  locale text not null default 'ar',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business_type business_type not null,
  owner_id uuid not null references profiles(id),
  currency char(3) not null default 'ILS',
  phone text,
  address text,
  logo_url text,
  fiscal_year_start date not null default (date_trunc('year', now())::date),
  settings jsonb not null default '{}',
  plan text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version int not null default 1
);

create table if not exists business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role user_role not null,
  permissions jsonb not null default '{}',
  status text not null default 'active',
  invited_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, user_id)
);

create table if not exists financial_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  type account_type not null,
  provider text,
  currency char(3) not null default 'ILS',
  opening_balance numeric(14,2) not null default 0,
  current_balance numeric(14,2) not null default 0,
  total_deposits numeric(14,2) not null default 0,
  total_withdrawals numeric(14,2) not null default 0,
  gl_account_code text not null default '1100',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version int not null default 1
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  phone text,
  address text,
  notes text,
  current_balance numeric(14,2) not null default 0,
  total_transactions numeric(14,2) not null default 0,
  last_transaction_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version int not null default 1
);

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  phone text,
  address text,
  notes text,
  current_balance numeric(14,2) not null default 0,
  total_transactions numeric(14,2) not null default 0,
  last_transaction_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version int not null default 1
);

create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  sale_number text not null,
  customer_id uuid references customers(id),
  occurred_at timestamptz not null,
  description text not null default '',
  total_amount numeric(14,2) not null,
  discount numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null,
  payment_method payment_method not null,
  account_id uuid references financial_accounts(id),
  paid_amount numeric(14,2) not null default 0,
  remaining_amount numeric(14,2) not null default 0,
  debt_id uuid,
  status doc_status not null default 'posted',
  notes text not null default '',
  created_by uuid not null references profiles(id),
  posted_at timestamptz,
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version int not null default 1,
  unique (business_id, sale_number),
  constraint sales_net_math check (net_amount = total_amount - discount and net_amount >= 0),
  constraint sales_paid_bounds check (paid_amount >= 0 and paid_amount <= net_amount),
  constraint sales_account_required check (
    payment_method = 'credit' or account_id is not null
  )
);

create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  purchase_number text not null,
  supplier_id uuid references suppliers(id),
  occurred_at timestamptz not null,
  description text not null default '',
  total_amount numeric(14,2) not null,
  discount numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null,
  payment_method payment_method not null,
  account_id uuid references financial_accounts(id),
  paid_amount numeric(14,2) not null default 0,
  remaining_amount numeric(14,2) not null default 0,
  transfer_reference text,
  receipt_attachment_id uuid,
  transfer_proof_attachment_id uuid,
  debt_id uuid,
  status doc_status not null default 'posted',
  notes text not null default '',
  created_by uuid not null references profiles(id),
  posted_at timestamptz,
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version int not null default 1,
  unique (business_id, purchase_number),
  constraint purchases_net_math check (net_amount = total_amount - discount and net_amount >= 0),
  constraint purchases_paid_bounds check (paid_amount >= 0 and paid_amount <= net_amount),
  constraint purchases_account_required check (
    payment_method = 'credit' or account_id is not null
  )
);

create table if not exists purchase_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  purchase_id uuid not null references purchases(id) on delete cascade,
  product_id uuid,
  name text not null,
  quantity numeric(14,3) not null,
  unit_price numeric(14,2) not null,
  total numeric(14,2) not null
);

create table if not exists expense_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  gl_code text not null,
  is_system boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version int not null default 1,
  unique (business_id, gl_code)
);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  title text not null,
  category_id uuid not null references expense_categories(id),
  amount numeric(14,2) not null,
  occurred_at timestamptz not null,
  payment_method payment_method not null,
  account_id uuid not null references financial_accounts(id),
  receipt_attachment_id uuid,
  notes text not null default '',
  status doc_status not null default 'posted',
  created_by uuid not null references profiles(id),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version int not null default 1,
  constraint expenses_amount_positive check (amount > 0),
  constraint expenses_no_credit check (payment_method <> 'credit')
);

create table if not exists debts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  direction debt_direction not null,
  customer_id uuid references customers(id),
  supplier_id uuid references suppliers(id),
  source_type text not null default 'manual',
  source_id uuid,
  amount numeric(14,2) not null,
  paid_amount numeric(14,2) not null default 0,
  remaining_amount numeric(14,2) not null,
  due_date date,
  status debt_status not null default 'open',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version int not null default 1,
  constraint debts_party_required check (
    (direction = 'receivable' and customer_id is not null and supplier_id is null)
    or (direction = 'payable' and supplier_id is not null and customer_id is null)
  ),
  constraint debts_amounts check (amount > 0 and paid_amount >= 0 and remaining_amount >= 0)
);

create table if not exists debt_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  debt_id uuid not null references debts(id),
  amount numeric(14,2) not null,
  occurred_at timestamptz not null,
  account_id uuid not null references financial_accounts(id),
  payment_method payment_method not null,
  journal_entry_id uuid,
  notes text not null default '',
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version int not null default 1,
  constraint debt_payments_amount_positive check (amount > 0)
);

create table if not exists journal_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  entry_number text not null,
  occurred_at timestamptz not null,
  description text not null default '',
  source_type entry_source not null,
  source_id uuid,
  status doc_status not null default 'posted',
  reversal_of_entry_id uuid references journal_entries(id),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, entry_number)
);

create table if not exists journal_entry_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  entry_id uuid not null references journal_entries(id) on delete cascade,
  gl_account_code text not null,
  debit numeric(14,2) not null default 0,
  credit numeric(14,2) not null default 0,
  financial_account_id uuid references financial_accounts(id),
  party_type text check (party_type in ('customer','supplier')),
  party_id uuid,
  description text
);

create table if not exists chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  code text not null,
  name text not null,
  type text not null check (type in ('asset','liability','equity','revenue','expense')),
  parent_code text,
  is_system boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1
);

create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  storage_path text not null,
  bucket text not null default 'attachments',
  mime_type text,
  size_bytes bigint,
  entity_type text not null,
  entity_id uuid,
  uploaded_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version int not null default 1
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);

create table if not exists operation_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  client_op_id uuid not null,
  op_type text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  unique (business_id, client_op_id)
);

create table if not exists sync_metadata (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  device_id text not null,
  last_pulled_at timestamptz,
  last_push_at timestamptz,
  watermarks jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, device_id)
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid references profiles(id),
  type text not null,
  title text not null,
  body text not null default '',
  data jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists business_sequences (
  business_id uuid not null references businesses(id) on delete cascade,
  doc_type text not null,
  prefix text not null,
  last_number int not null default 0,
  year int not null,
  primary key (business_id, doc_type, year)
);

create unique index if not exists chart_of_accounts_scope_code_idx
  on chart_of_accounts (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), code);

create index if not exists sales_business_date_idx on sales (business_id, occurred_at desc);
create index if not exists sales_customer_idx on sales (business_id, customer_id) where customer_id is not null;
create index if not exists sales_delta_idx on sales (business_id, updated_at) where deleted_at is null;
create index if not exists purchases_business_date_idx on purchases (business_id, occurred_at desc);
create index if not exists purchases_supplier_idx on purchases (business_id, supplier_id) where supplier_id is not null;
create index if not exists purchases_delta_idx on purchases (business_id, updated_at) where deleted_at is null;
create index if not exists purchase_items_purchase_idx on purchase_items (purchase_id);
create index if not exists expenses_business_date_idx on expenses (business_id, occurred_at desc);
create index if not exists expenses_category_idx on expenses (business_id, category_id);
create index if not exists expenses_delta_idx on expenses (business_id, updated_at) where deleted_at is null;
create index if not exists debts_business_dir_status_idx on debts (business_id, direction, status);
create index if not exists debt_payments_debt_idx on debt_payments (business_id, debt_id, occurred_at);
create index if not exists journal_entries_business_date_idx on journal_entries (business_id, occurred_at desc);
create index if not exists journal_entries_source_idx on journal_entries (business_id, source_type, source_id);
create index if not exists journal_entry_lines_entry_idx on journal_entry_lines (entry_id);
create index if not exists journal_entry_lines_account_idx on journal_entry_lines (financial_account_id) where financial_account_id is not null;
create index if not exists business_members_user_idx on business_members (user_id);
create index if not exists customers_business_name_idx on customers (business_id, name);
create index if not exists suppliers_business_name_idx on suppliers (business_id, name);
create index if not exists attachments_entity_idx on attachments (business_id, entity_type, entity_id);

create trigger set_updated_at_profiles before update on profiles for each row execute function set_updated_at();
create trigger set_updated_at_businesses before update on businesses for each row execute function set_updated_at();
create trigger set_updated_at_business_members before update on business_members for each row execute function set_updated_at();
create trigger set_updated_at_financial_accounts before update on financial_accounts for each row execute function set_updated_at();
create trigger set_updated_at_customers before update on customers for each row execute function set_updated_at();
create trigger set_updated_at_suppliers before update on suppliers for each row execute function set_updated_at();
create trigger set_updated_at_sales before update on sales for each row execute function set_updated_at();
create trigger set_updated_at_purchases before update on purchases for each row execute function set_updated_at();
create trigger set_updated_at_expense_categories before update on expense_categories for each row execute function set_updated_at();
create trigger set_updated_at_expenses before update on expenses for each row execute function set_updated_at();
create trigger set_updated_at_debts before update on debts for each row execute function set_updated_at();
create trigger set_updated_at_debt_payments before update on debt_payments for each row execute function set_updated_at();
create trigger set_updated_at_journal_entries before update on journal_entries for each row execute function set_updated_at();
create trigger set_updated_at_attachments before update on attachments for each row execute function set_updated_at();
create trigger set_updated_at_sync_metadata before update on sync_metadata for each row execute function set_updated_at();

create trigger journal_lines_balance_guard
after insert on journal_entry_lines
referencing new table as inserted_lines
for each statement execute function assert_balanced_entry();

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ============================================================
-- 0004_rls.sql
-- ============================================================
create or replace function is_member(bid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from business_members m
    where m.business_id = bid and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

create or replace function user_role_in(bid uuid, roles user_role[]) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from business_members m
    where m.business_id = bid and m.user_id = auth.uid()
      and m.status = 'active' and m.role = any(roles)
  );
$$;

create or replace function is_owner(bid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from business_members m
    where m.business_id = bid and m.user_id = auth.uid()
      and m.status = 'active' and m.role = 'owner'
  );
$$;

create or replace function is_financial_role(bid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select user_role_in(bid, array['owner','manager','accountant']::user_role[]);
$$;

alter table profiles enable row level security;
alter table businesses enable row level security;
alter table business_members enable row level security;
alter table financial_accounts enable row level security;
alter table customers enable row level security;
alter table suppliers enable row level security;
alter table sales enable row level security;
alter table purchases enable row level security;
alter table purchase_items enable row level security;
alter table expense_categories enable row level security;
alter table expenses enable row level security;
alter table debts enable row level security;
alter table debt_payments enable row level security;
alter table journal_entries enable row level security;
alter table journal_entry_lines enable row level security;
alter table chart_of_accounts enable row level security;
alter table attachments enable row level security;
alter table audit_logs enable row level security;
alter table operation_log enable row level security;
alter table sync_metadata enable row level security;
alter table notifications enable row level security;
alter table business_sequences enable row level security;

drop policy if exists profiles_select_own on profiles;
create policy profiles_select_own on profiles for select to authenticated
  using (id = auth.uid());

drop policy if exists profiles_insert_own on profiles;
create policy profiles_insert_own on profiles for insert to authenticated
  with check (id = auth.uid());

drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_select_members on profiles;
create policy profiles_select_members on profiles for select to authenticated
  using (
    exists (
      select 1 from business_members m
      where m.user_id = profiles.id
        and (m.user_id = auth.uid() or is_member(m.business_id))
    )
  );

drop policy if exists businesses_select on businesses;
create policy businesses_select on businesses for select to authenticated
  using (owner_id = auth.uid() or is_member(id));

drop policy if exists businesses_insert on businesses;
create policy businesses_insert on businesses for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists businesses_update on businesses;
create policy businesses_update on businesses for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists business_members_select on business_members;
create policy business_members_select on business_members for select to authenticated
  using (user_id = auth.uid() or is_member(business_id));

drop policy if exists business_members_insert on business_members;
create policy business_members_insert on business_members for insert to authenticated
  with check (is_owner(business_id));

drop policy if exists business_members_update on business_members;
create policy business_members_update on business_members for update to authenticated
  using (is_owner(business_id)) with check (is_owner(business_id));

drop policy if exists business_members_delete on business_members;
create policy business_members_delete on business_members for delete to authenticated
  using (is_owner(business_id));

drop policy if exists financial_accounts_select on financial_accounts;
create policy financial_accounts_select on financial_accounts for select to authenticated
  using (is_member(business_id) and (is_financial_role(business_id) or type = 'cash'));

drop policy if exists financial_accounts_insert on financial_accounts;
create policy financial_accounts_insert on financial_accounts for insert to authenticated
  with check (is_financial_role(business_id));

drop policy if exists financial_accounts_update on financial_accounts;
create policy financial_accounts_update on financial_accounts for update to authenticated
  using (is_financial_role(business_id)) with check (is_financial_role(business_id));

drop policy if exists customers_select on customers;
create policy customers_select on customers for select to authenticated
  using (is_member(business_id));

drop policy if exists customers_insert on customers;
create policy customers_insert on customers for insert to authenticated
  with check (is_financial_role(business_id));

drop policy if exists customers_update on customers;
create policy customers_update on customers for update to authenticated
  using (is_financial_role(business_id)) with check (is_financial_role(business_id));

drop policy if exists suppliers_select on suppliers;
create policy suppliers_select on suppliers for select to authenticated
  using (is_member(business_id));

drop policy if exists suppliers_insert on suppliers;
create policy suppliers_insert on suppliers for insert to authenticated
  with check (is_financial_role(business_id));

drop policy if exists suppliers_update on suppliers;
create policy suppliers_update on suppliers for update to authenticated
  using (is_financial_role(business_id)) with check (is_financial_role(business_id));

drop policy if exists sales_select on sales;
create policy sales_select on sales for select to authenticated
  using (is_member(business_id));

drop policy if exists sales_insert on sales;
create policy sales_insert on sales for insert to authenticated
  with check (is_member(business_id));

drop policy if exists sales_update on sales;
create policy sales_update on sales for update to authenticated
  using (is_financial_role(business_id)) with check (is_financial_role(business_id));

drop policy if exists purchases_select on purchases;
create policy purchases_select on purchases for select to authenticated
  using (is_member(business_id));

drop policy if exists purchases_insert on purchases;
create policy purchases_insert on purchases for insert to authenticated
  with check (is_financial_role(business_id));

drop policy if exists purchases_update on purchases;
create policy purchases_update on purchases for update to authenticated
  using (is_financial_role(business_id)) with check (is_financial_role(business_id));

drop policy if exists purchase_items_select on purchase_items;
create policy purchase_items_select on purchase_items for select to authenticated
  using (is_member(business_id));

drop policy if exists purchase_items_insert on purchase_items;
create policy purchase_items_insert on purchase_items for insert to authenticated
  with check (is_financial_role(business_id));

drop policy if exists purchase_items_update on purchase_items;
create policy purchase_items_update on purchase_items for update to authenticated
  using (is_financial_role(business_id)) with check (is_financial_role(business_id));

drop policy if exists expense_categories_select on expense_categories;
create policy expense_categories_select on expense_categories for select to authenticated
  using (is_member(business_id));

drop policy if exists expense_categories_insert on expense_categories;
create policy expense_categories_insert on expense_categories for insert to authenticated
  with check (is_financial_role(business_id));

drop policy if exists expense_categories_update on expense_categories;
create policy expense_categories_update on expense_categories for update to authenticated
  using (is_financial_role(business_id)) with check (is_financial_role(business_id));

drop policy if exists expenses_select on expenses;
create policy expenses_select on expenses for select to authenticated
  using (is_member(business_id));

drop policy if exists expenses_insert on expenses;
create policy expenses_insert on expenses for insert to authenticated
  with check (is_member(business_id));

drop policy if exists expenses_update on expenses;
create policy expenses_update on expenses for update to authenticated
  using (is_financial_role(business_id)) with check (is_financial_role(business_id));

drop policy if exists debts_select on debts;
create policy debts_select on debts for select to authenticated
  using (is_member(business_id));

drop policy if exists debts_insert on debts;
create policy debts_insert on debts for insert to authenticated
  with check (is_financial_role(business_id));

drop policy if exists debts_update on debts;
create policy debts_update on debts for update to authenticated
  using (is_financial_role(business_id)) with check (is_financial_role(business_id));

drop policy if exists debt_payments_select on debt_payments;
create policy debt_payments_select on debt_payments for select to authenticated
  using (is_member(business_id));

drop policy if exists debt_payments_insert on debt_payments;
create policy debt_payments_insert on debt_payments for insert to authenticated
  with check (is_financial_role(business_id));

drop policy if exists debt_payments_update on debt_payments;
create policy debt_payments_update on debt_payments for update to authenticated
  using (is_financial_role(business_id)) with check (is_financial_role(business_id));

drop policy if exists journal_entries_select on journal_entries;
create policy journal_entries_select on journal_entries for select to authenticated
  using (is_financial_role(business_id));

drop policy if exists journal_entry_lines_select on journal_entry_lines;
create policy journal_entry_lines_select on journal_entry_lines for select to authenticated
  using (is_financial_role(business_id));

drop policy if exists chart_of_accounts_select on chart_of_accounts;
create policy chart_of_accounts_select on chart_of_accounts for select to authenticated
  using (business_id is null or is_member(business_id));

drop policy if exists chart_of_accounts_insert on chart_of_accounts;
create policy chart_of_accounts_insert on chart_of_accounts for insert to authenticated
  with check (business_id is not null and is_owner(business_id));

drop policy if exists chart_of_accounts_update on chart_of_accounts;
create policy chart_of_accounts_update on chart_of_accounts for update to authenticated
  using (business_id is not null and is_owner(business_id))
  with check (business_id is not null and is_owner(business_id));

drop policy if exists attachments_select on attachments;
create policy attachments_select on attachments for select to authenticated
  using (is_member(business_id));

drop policy if exists attachments_insert on attachments;
create policy attachments_insert on attachments for insert to authenticated
  with check (is_member(business_id));

drop policy if exists attachments_update on attachments;
create policy attachments_update on attachments for update to authenticated
  using (is_member(business_id)) with check (is_member(business_id));

drop policy if exists audit_logs_select on audit_logs;
create policy audit_logs_select on audit_logs for select to authenticated
  using (user_role_in(business_id, array['owner','manager']::user_role[]));

drop policy if exists audit_logs_insert on audit_logs;
create policy audit_logs_insert on audit_logs for insert to authenticated
  with check (is_member(business_id) and user_id = auth.uid());

drop policy if exists operation_log_select on operation_log;
create policy operation_log_select on operation_log for select to authenticated
  using (is_member(business_id));

drop policy if exists operation_log_insert on operation_log;
create policy operation_log_insert on operation_log for insert to authenticated
  with check (is_member(business_id));

drop policy if exists sync_metadata_select on sync_metadata;
create policy sync_metadata_select on sync_metadata for select to authenticated
  using (is_member(business_id));

drop policy if exists sync_metadata_insert on sync_metadata;
create policy sync_metadata_insert on sync_metadata for insert to authenticated
  with check (is_member(business_id));

drop policy if exists sync_metadata_update on sync_metadata;
create policy sync_metadata_update on sync_metadata for update to authenticated
  using (is_member(business_id)) with check (is_member(business_id));

drop policy if exists notifications_select on notifications;
create policy notifications_select on notifications for select to authenticated
  using (user_id = auth.uid() or (user_id is null and is_member(business_id)));

drop policy if exists notifications_update on notifications;
create policy notifications_update on notifications for update to authenticated
  using (user_id = auth.uid() or is_member(business_id))
  with check (user_id = auth.uid() or is_member(business_id));

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

drop policy if exists attachments_storage_insert on storage.objects;
create policy attachments_storage_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and is_member(((split_part(name, '/', 1)))::uuid)
  );

drop policy if exists attachments_storage_select on storage.objects;
create policy attachments_storage_select on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and is_member(((split_part(name, '/', 1)))::uuid)
  );

drop policy if exists attachments_storage_update on storage.objects;
create policy attachments_storage_update on storage.objects for update to authenticated
  using (
    bucket_id = 'attachments'
    and is_member(((split_part(name, '/', 1)))::uuid)
  )
  with check (
    bucket_id = 'attachments'
    and is_member(((split_part(name, '/', 1)))::uuid)
  );

drop policy if exists attachments_storage_delete on storage.objects;
create policy attachments_storage_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and is_member(((split_part(name, '/', 1)))::uuid)
  );

-- ============================================================
-- 0005_business_setup_rpc.sql
-- ============================================================
create or replace function setup_new_business(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  bid uuid;
  currency text;
  business_type_val business_type;
  owner_name text;
  business_name text;
  cash jsonb;
  bank jsonb;
  cust jsonb;
  sup jsonb;
  cash_name text;
  cash_open numeric(14,2) := 0;
  bank_name text;
  bank_type account_type;
  bank_provider text;
  bank_open numeric(14,2) := 0;
  bank_gl text := '1200';
  opening_total numeric(14,2) := 0;
  acc_cash uuid;
  acc_bank uuid;
  entry_id uuid;
  current_year int := extract(year from now())::int;
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED: يجب تسجيل الدخول أولاً';
  end if;

  owner_name := trim(coalesce(payload->>'ownerName', ''));
  business_name := trim(coalesce(payload->>'businessName', ''));
  currency := coalesce(payload->>'currency', 'ILS');
  cash := payload->'cashAccount';
  bank := nullif(payload->'bankAccount', 'null'::jsonb);
  cust := nullif(payload->'firstCustomer', 'null'::jsonb);
  sup := nullif(payload->'firstSupplier', 'null'::jsonb);

  if length(owner_name) < 2 then raise exception 'VALIDATION: اسم المالك مطلوب'; end if;
  if length(business_name) < 2 then raise exception 'VALIDATION: اسم المشروع مطلوب'; end if;
  if cash is null or length(trim(coalesce(cash->>'name',''))) < 2 then
    raise exception 'VALIDATION: حساب الصندوق مطلوب';
  end if;

  begin
    business_type_val := (payload->>'businessType')::business_type;
  exception when invalid_text_representation then
    raise exception 'VALIDATION: نوع النشاط غير صالح';
  end;

  cash_name := trim(cash->>'name');
  cash_open := coalesce((cash->>'openingBalance')::numeric, 0);
  if cash_open < 0 then raise exception 'VALIDATION: رصيد الصندوق لا يجوز أن يكون سالباً'; end if;

  if bank is not null then
    bank_name := trim(coalesce(bank->>'name',''));
    begin
      bank_type := (bank->>'type')::account_type;
    exception when invalid_text_representation then
      raise exception 'VALIDATION: نوع الحساب البنكي غير صالح';
    end;
    bank_provider := nullif(trim(coalesce(bank->>'provider','')), '');
    bank_open := coalesce((bank->>'openingBalance')::numeric, 0);
    if length(bank_name) < 2 then raise exception 'VALIDATION: اسم الحساب البنكي مطلوب'; end if;
    if bank_open < 0 then raise exception 'VALIDATION: رصيد الحساب البنكي لا يجوز أن يكون سالباً'; end if;
    if bank_type in ('bank','wallet','other') then bank_gl := '1200'; else bank_gl := '1100'; end if;
  end if;

  insert into profiles (id, full_name)
  values (uid, owner_name)
  on conflict (id) do update set full_name = excluded.full_name;

  insert into businesses (name, business_type, owner_id, currency)
  values (business_name, business_type_val, uid, currency)
  returning id into bid;

  insert into business_members (business_id, user_id, role, status)
  values (bid, uid, 'owner', 'active');

  insert into chart_of_accounts (business_id, code, name, type, parent_code, is_system, sort_order) values
    (bid, '1000', 'الأصول', 'asset', null, true, 10),
    (bid, '1100', 'الصندوق النقدي', 'asset', '1000', true, 20),
    (bid, '1200', 'البنوك والمحافظ', 'asset', '1000', true, 30),
    (bid, '1300', 'العملاء (مدينون)', 'asset', '1000', true, 40),
    (bid, '1400', 'المخزون', 'asset', '1000', true, 50),
    (bid, '2000', 'الالتزامات', 'liability', null, true, 60),
    (bid, '2100', 'الموردون (دائنون)', 'liability', '2000', true, 70),
    (bid, '3000', 'حقوق الملكية', 'equity', null, true, 80),
    (bid, '3100', 'رأس المال الافتتاحي', 'equity', '3000', true, 90),
    (bid, '4000', 'الإيرادات', 'revenue', null, true, 100),
    (bid, '4100', 'المبيعات', 'revenue', '4000', true, 110),
    (bid, '4900', 'خصومات المبيعات', 'revenue', '4000', true, 120),
    (bid, '5000', 'المصروفات', 'expense', null, true, 130),
    (bid, '5900', 'تكلفة المبيعات والمشتريات', 'expense', '5000', true, 140),
    (bid, '5950', 'فروقات تسوية الحسابات', 'expense', '5000', true, 150);

  insert into expense_categories (business_id, name, gl_code, is_system, sort_order) values
    (bid, 'إيجار', '5100', true, 10),
    (bid, 'كهرباء', '5110', true, 20),
    (bid, 'مياه', '5120', true, 30),
    (bid, 'أجور ورواتب', '5130', true, 40),
    (bid, 'مواصلات', '5140', true, 50),
    (bid, 'صيانة', '5150', true, 60),
    (bid, 'إنترنت واتصالات', '5160', true, 70),
    (bid, 'مواد تشغيلية', '5170', true, 80),
    (bid, 'مصروفات إدارية', '5180', true, 90),
    (bid, 'مصروفات أخرى', '5190', true, 100);

  insert into chart_of_accounts (business_id, code, name, type, parent_code, is_system, sort_order)
  select bid, c.gl_code, c.name, 'expense', '5000', true, 200 + c.sort_order
  from expense_categories c
  where c.business_id = bid;

  insert into business_sequences (business_id, doc_type, prefix, last_number, year) values
    (bid, 'sale', 'S', 0, current_year),
    (bid, 'purchase', 'P', 0, current_year),
    (bid, 'journal', 'JE', 0, current_year)
  on conflict (business_id, doc_type, year) do nothing;

  insert into financial_accounts (business_id, name, type, provider, currency, opening_balance, current_balance, gl_account_code)
  values (bid, cash_name, 'cash', null, currency, cash_open, cash_open, '1100')
  returning id into acc_cash;

  if bank is not null then
    insert into financial_accounts (business_id, name, type, provider, currency, opening_balance, current_balance, gl_account_code)
    values (bid, bank_name, bank_type, bank_provider, currency, bank_open, bank_open, bank_gl)
    returning id into acc_bank;
  end if;

  opening_total := cash_open + bank_open;

  if opening_total > 0 then
    insert into journal_entries (business_id, entry_number, occurred_at, description, source_type, status, created_by)
    values (bid, next_doc_number(bid, 'journal'), now(), 'قيد الأرصدة الافتتاحية', 'opening', 'posted', uid)
    returning id into entry_id;

    if cash_open > 0 then
      insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit, financial_account_id)
      values (bid, entry_id, '1100', cash_open, 0, acc_cash);
    end if;
    if bank is not null and bank_open > 0 then
      insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit, financial_account_id)
      values (bid, entry_id, bank_gl, bank_open, 0, acc_bank);
    end if;
    insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit)
    values (bid, entry_id, '3100', 0, opening_total);
  end if;

  if cust is not null and length(trim(coalesce(cust->>'name',''))) >= 2 then
    insert into customers (business_id, name, phone)
    values (bid, trim(cust->>'name'), nullif(trim(coalesce(cust->>'phone','')), ''));
  end if;

  if sup is not null and length(trim(coalesce(sup->>'name',''))) >= 2 then
    insert into suppliers (business_id, name, phone)
    values (bid, trim(sup->>'name'), nullif(trim(coalesce(sup->>'phone','')), ''));
  end if;

  return bid;
end $$;

revoke execute on function setup_new_business(jsonb) from public, anon;
grant execute on function setup_new_business(jsonb) to authenticated;

-- ============================================================
-- 0006_subscriptions_trial.sql
-- ============================================================
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

-- ============================================================
-- 0007_server_sync.sql
-- ============================================================
-- 0007: تطبيق عمليات المزامنة على الخادم (Server-authoritative + Idempotency)
-- الخادم يعيد اشتقاق القيود من حمولة العملية — لا يثق بقيد وصل من العميل (ADR-2)

create or replace function op_log_get(bid uuid, coid uuid)
returns jsonb
language sql
security definer
stable
set search_path = public as $$
  select result from operation_log
  where business_id = bid and client_op_id = coid
$$;

create or replace function op_log_put(bid uuid, coid uuid, op_type text, result jsonb)
returns void
language sql
security definer
set search_path = public as $$
  insert into operation_log (business_id, client_op_id, op_type, result)
  values (bid, coid, op_type, result)
  on conflict (business_id, client_op_id) do nothing
$$;

create or replace function op_audit(bid uuid, action text, entity_type text, entity_id uuid, new_values jsonb)
returns void
language plpgsql
security definer
set search_path = public as $$
begin
  insert into audit_logs (business_id, user_id, action, entity_type, entity_id, new_values)
  values (bid, auth.uid(), action, entity_type, entity_id, new_values);
end $$;

-- دور المستخدم في المشروع
create or replace function op_role(bid uuid)
returns user_role
language sql
security definer
stable
set search_path = public as $$
  select m.role from business_members m
  where m.business_id = bid and m.user_id = auth.uid() and m.status = 'active'
$$;

create or replace function op_assert_role(bid uuid, allowed user_role[])
returns void
language plpgsql
security definer
set search_path = public as $$
declare r user_role;
begin
  r := op_role(bid);
  if r is null then
    raise exception 'UNAUTHENTICATED: لست عضواً في هذا المشروع';
  end if;
  if not (r = any(allowed)) then
    raise exception 'FORBIDDEN: دورك لا يسمح بهذه العملية';
  end if;
end $$;

-- حارس: رصيد الحساب المالي لا يجوز أن يصير سالباً
create or replace function assert_account_balance_ok(acc_id uuid)
returns void
language plpgsql
security definer
set search_path = public as $$
declare bal numeric(14,2);
begin
  if acc_id is null then return; end if;
  select current_balance into bal from financial_accounts where id = acc_id;
  if bal < 0 then
    raise exception 'INSUFFICIENT_BALANCE: رصيد الحساب لا يكفي';
  end if;
end $$;

create or replace function gl_code_for_account(acc_type account_type)
returns text
language sql
immutable as $$
  select case when acc_type = 'cash' then '1100' else '1200' end
$$;

-- ====================== مبيعات ======================
create or replace function apply_sale(bid uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  sale_payload jsonb := p->'sale';
  debt_payload jsonb := nullif(p->'debt', 'null'::jsonb);
  sid uuid := (sale_payload->>'id')::uuid;
  total numeric(14,2) := (sale_payload->>'totalAmountMinor')::bigint / 100.0;
  disc numeric(14,2) := (sale_payload->>'discountMinor')::bigint / 100.0;
  net numeric(14,2) := (sale_payload->>'netAmountMinor')::bigint / 100.0;
  paid numeric(14,2) := (sale_payload->>'paidAmountMinor')::bigint / 100.0;
  rem numeric(14,2) := (sale_payload->>'remainingAmountMinor')::bigint / 100.0;
  cust_id uuid := (sale_payload->>'customerId');
  acc_id uuid := (sale_payload->>'accountId');
  method payment_method;
  occurred timestamptz := (sale_payload->>'occurredAt')::timestamptz;
  acc record;
  sale_no text;
  entry_id uuid;
  result jsonb;
  debt_id uuid := (debt_payload->>'id')::uuid;
begin
  method := (sale_payload->>'paymentMethod')::payment_method;
  if net <> total - disc or net <= 0 then
    raise exception 'VALIDATION: الصافي غير صحيح';
  end if;
  if paid < 0 or paid > net then raise exception 'VALIDATION: المدفوع خارج الحدود'; end if;
  if rem <> net - paid then raise exception 'VALIDATION: المتبقي غير صحيح'; end if;
  if method = 'credit' and (acc_id is not null or paid <> 0) then
    raise exception 'VALIDATION: البيع الآجل لا يقبل حركة نقدية';
  end if;
  if rem > 0 and cust_id is null then
    raise exception 'VALIDATION: البيع الآجل يتطلب عميلاً';
  end if;
  if rem > 0 and debt_id is null then
    raise exception 'VALIDATION: معرّف الدين مطلوب للجزء الآجل';
  end if;

  if exists (select 1 from sales where id = sid and business_id = bid) then
    raise exception 'DUPLICATE: عملية البيع موجودة مسبقاً';
  end if;

  select * into acc from financial_accounts
    where id = acc_id and business_id = bid and deleted_at is null;
  if acc_id is not null and not found then
    raise exception 'VALIDATION: حساب الاستلام غير موجود';
  end if;

  sale_no := next_doc_number(bid, 'sale', occurred);

  insert into sales (id, business_id, sale_number, customer_id, occurred_at, description,
    total_amount, discount, net_amount, payment_method, account_id, paid_amount,
    remaining_amount, status, notes, created_by, posted_at)
  values (sid, bid, sale_no, cust_id, occurred, coalesce(sale_payload->>'description',''),
    total, disc, net, method, acc_id, paid, rem, 'posted',
    coalesce(sale_payload->>'notes',''), uid, now());

  insert into journal_entries (business_id, entry_number, occurred_at, description, source_type, source_id, status, created_by)
  values (bid, next_doc_number(bid, 'journal', occurred), occurred, 'عملية بيع — ' || coalesce(nullif(sale_payload->>'description',''), 'بدون وصف'), 'sale', sid, 'posted', uid)
  returning id into entry_id;

  insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit)
  values (bid, entry_id, '4100', 0, net);

  if paid > 0 and acc_id is not null then
    insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit, financial_account_id)
    values (bid, entry_id, gl_code_for_account(acc.type), paid, 0, acc_id);
    update financial_accounts
      set current_balance = current_balance + paid,
          total_deposits = total_deposits + paid
    where id = acc_id;
    perform assert_account_balance_ok(acc_id);
  end if;

  if rem > 0 then
    insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit, party_type, party_id)
    values (bid, entry_id, '1300', rem, 0, 'customer', cust_id);

    insert into debts (id, business_id, direction, customer_id, source_type, source_id,
      amount, paid_amount, remaining_amount, status)
    values (debt_id, bid, 'receivable', cust_id, 'sale', sid, rem, 0, rem, 'open');

    update sales set debt_id = debt_id where id = sid;

    update customers set
      current_balance = current_balance + rem,
      total_transactions = total_transactions + net,
      last_transaction_at = occurred
    where id = cust_id;
  else
    update customers set
      total_transactions = total_transactions + net,
      last_transaction_at = occurred
    where id = cust_id;
  end if;

  perform op_audit(bid, 'create', 'sale', sid, jsonb_build_object('sale_number', sale_no, 'net', net, 'paid', paid, 'remaining', rem));

  result := jsonb_build_object(
    'doc', jsonb_build_object('id', sid, 'saleNumber', sale_no, 'netAmountMinor', (net*100)::bigint,
      'paidAmountMinor', (paid*100)::bigint, 'remainingAmountMinor', (rem*100)::bigint, 'debtId', debt_id),
    'entryId', entry_id
  );
  return result;
end $$;

-- ====================== مشتريات ======================
create or replace function apply_purchase(bid uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  purchase_payload jsonb := p->'purchase';
  debt_payload jsonb := nullif(p->'debt', 'null'::jsonb);
  pid uuid := (purchase_payload->>'id')::uuid;
  total numeric(14,2) := (purchase_payload->>'totalAmountMinor')::bigint / 100.0;
  disc numeric(14,2) := (purchase_payload->>'discountMinor')::bigint / 100.0;
  net numeric(14,2) := (purchase_payload->>'netAmountMinor')::bigint / 100.0;
  paid numeric(14,2) := (purchase_payload->>'paidAmountMinor')::bigint / 100.0;
  rem numeric(14,2) := (purchase_payload->>'remainingAmountMinor')::bigint / 100.0;
  sup_id uuid := (purchase_payload->>'supplierId');
  acc_id uuid := (purchase_payload->>'accountId');
  method payment_method;
  occurred timestamptz := (purchase_payload->>'occurredAt')::timestamptz;
  acc record;
  purchase_no text;
  entry_id uuid;
  debt_id uuid := (debt_payload->>'id')::uuid;
  result jsonb;
begin
  method := (purchase_payload->>'paymentMethod')::payment_method;
  if net <> total - disc or net <= 0 then
    raise exception 'VALIDATION: الصافي غير صحيح';
  end if;
  if paid < 0 or paid > net then raise exception 'VALIDATION: المدفوع خارج الحدود'; end if;
  if rem <> net - paid then raise exception 'VALIDATION: المتبقي غير صحيح'; end if;
  if method = 'credit' and paid <> 0 then
    raise exception 'VALIDATION: الشراء الآجل لا يقبل مبلغاً مدفوعاً';
  end if;
  if rem > 0 and sup_id is null then
    raise exception 'VALIDATION: الشراء الآجل يتطلب مورداً';
  end if;
  if rem > 0 and debt_id is null then
    raise exception 'VALIDATION: معرّف الدين مطلوب للجزء الآجل';
  end if;

  if exists (select 1 from purchases where id = pid and business_id = bid) then
    raise exception 'DUPLICATE: فاتورة الشراء موجودة مسبقاً';
  end if;

  select * into acc from financial_accounts
    where id = acc_id and business_id = bid and deleted_at is null;
  if acc_id is not null and not found then
    raise exception 'VALIDATION: حساب الدفع غير موجود';
  end if;

  purchase_no := next_doc_number(bid, 'purchase', occurred);

  insert into purchases (id, business_id, purchase_number, supplier_id, occurred_at, description,
    total_amount, discount, net_amount, payment_method, account_id, paid_amount,
    remaining_amount, transfer_reference, status, notes, created_by, posted_at)
  values (pid, bid, purchase_no, sup_id, occurred, coalesce(purchase_payload->>'description',''),
    total, disc, net, method, acc_id, paid, rem,
    nullif(purchase_payload->>'transferReference',''), 'posted', coalesce(purchase_payload->>'notes',''), uid, now());

  insert into journal_entries (business_id, entry_number, occurred_at, description, source_type, source_id, status, created_by)
  values (bid, next_doc_number(bid, 'journal', occurred), occurred, 'فاتورة مشتريات — ' || coalesce(nullif(purchase_payload->>'description',''), 'بدون وصف'), 'purchase', pid, 'posted', uid)
  returning id into entry_id;

  insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit)
  values (bid, entry_id, '5900', net, 0);

  if paid > 0 and acc_id is not null then
    insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit, financial_account_id)
    values (bid, entry_id, gl_code_for_account(acc.type), 0, paid, acc_id);
    update financial_accounts
      set current_balance = current_balance - paid,
          total_withdrawals = total_withdrawals + paid
    where id = acc_id;
    perform assert_account_balance_ok(acc_id);
  end if;

  if rem > 0 then
    insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit, party_type, party_id)
    values (bid, entry_id, '2100', 0, rem, 'supplier', sup_id);

    insert into debts (id, business_id, direction, supplier_id, source_type, source_id,
      amount, paid_amount, remaining_amount, status)
    values (debt_id, bid, 'payable', sup_id, 'purchase', pid, rem, 0, rem, 'open');

    update purchases set debt_id = debt_id where id = pid;

    update suppliers set
      current_balance = current_balance + rem,
      total_transactions = total_transactions + net,
      last_transaction_at = occurred
    where id = sup_id;
  else
    update suppliers set
      total_transactions = total_transactions + net,
      last_transaction_at = occurred
    where id = sup_id;
  end if;

  perform op_audit(bid, 'create', 'purchase', pid, jsonb_build_object('purchase_number', purchase_no, 'net', net, 'paid', paid, 'remaining', rem));

  result := jsonb_build_object(
    'doc', jsonb_build_object('id', pid, 'purchaseNumber', purchase_no, 'netAmountMinor', (net*100)::bigint,
      'paidAmountMinor', (paid*100)::bigint, 'remainingAmountMinor', (rem*100)::bigint, 'debtId', debt_id),
    'entryId', entry_id
  );
  return result;
end $$;

-- ====================== مصروفات ======================
create or replace function apply_expense(bid uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  eid uuid := (p->>'id')::uuid;
  amount numeric(14,2) := (p->>'amountMinor')::bigint / 100.0;
  acc_id uuid := (p->>'accountId');
  occurred timestamptz := (p->>'occurredAt')::timestamptz;
  acc record;
  gl text := p->>'glCode';
  entry_id uuid;
  result jsonb;
begin
  if amount <= 0 then raise exception 'VALIDATION: مبلغ المصروف غير صحيح'; end if;
  if (p->>'paymentMethod')::text = 'credit' then
    raise exception 'VALIDATION: المصروف لا يقبل الدفع الآجل';
  end if;
  if not exists (select 1 from expense_categories where id = (p->>'categoryId')::uuid and business_id = bid) then
    raise exception 'VALIDATION: تصنيف المصروف غير موجود';
  end if;

  select * into acc from financial_accounts
    where id = acc_id and business_id = bid and deleted_at is null;
  if not found then raise exception 'VALIDATION: حساب الدفع غير موجود'; end if;

  if exists (select 1 from expenses where id = eid and business_id = bid) then
    raise exception 'DUPLICATE: المصروف موجود مسبقاً';
  end if;

  insert into expenses (id, business_id, title, category_id, amount, occurred_at,
    payment_method, account_id, receipt_attachment_id, status, notes, created_by, posted_at)
  values (eid, bid, p->>'title', (p->>'categoryId')::uuid, amount, occurred,
    (p->>'paymentMethod')::payment_method, acc_id, (p->>'receiptAttachmentId'),
    'posted', coalesce(p->>'notes',''), uid, now());

  insert into journal_entries (business_id, entry_number, occurred_at, description, source_type, source_id, status, created_by)
  values (bid, next_doc_number(bid, 'journal', occurred), occurred, 'مصروف — ' || p->>'title', 'expense', eid, 'posted', uid)
  returning id into entry_id;

  insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit)
  values (bid, entry_id, gl, amount, 0);
  insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit, financial_account_id)
  values (bid, entry_id, gl_code_for_account(acc.type), 0, amount, acc_id);

  update financial_accounts
    set current_balance = current_balance - amount,
        total_withdrawals = total_withdrawals + amount
  where id = acc_id;
  perform assert_account_balance_ok(acc_id);

  perform op_audit(bid, 'create', 'expense', eid, jsonb_build_object('title', p->>'title', 'amount', amount));

  result := jsonb_build_object(
    'doc', jsonb_build_object('id', eid, 'amountMinor', (amount*100)::bigint),
    'entryId', entry_id
  );
  return result;
end $$;

-- ====================== دفعات الديون ======================
create or replace function apply_debt_payment(bid uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  pay_id uuid := (p->>'id')::uuid;
  amount numeric(14,2) := (p->>'amountMinor')::bigint / 100.0;
  debt_id uuid := (p->>'debtId')::uuid;
  direction debt_direction;
  debt record;
  acc_id uuid := (p->>'accountId')::uuid;
  acc record;
  occurred timestamptz := (p->>'occurredAt')::timestamptz;
  entry_id uuid;
  result jsonb;
begin
  if amount <= 0 then raise exception 'VALIDATION: مبلغ الدفعة غير صحيح'; end if;

  select * into debt from debts where id = debt_id and business_id = bid and deleted_at is null;
  if not found then raise exception 'VALIDATION: الدين غير موجود'; end if;
  direction := debt.direction;
  if amount > debt.remaining_amount then
    raise exception 'OVERPAYMENT: الدفعة تتجاوز المتبقي من الدين';
  end if;

  select * into acc from financial_accounts
    where id = acc_id and business_id = bid and deleted_at is null;
  if not found then raise exception 'VALIDATION: حساب الدفعة غير موجود'; end if;

  if exists (select 1 from debt_payments where id = pay_id and business_id = bid) then
    raise exception 'DUPLICATE: الدفعة موجودة مسبقاً';
  end if;

  insert into journal_entries (business_id, entry_number, occurred_at, description, source_type, source_id, status, created_by)
  values (bid, next_doc_number(bid, 'journal', occurred), occurred,
    case when direction = 'receivable' then 'دفعة من عميل' else 'سداد لمورد' end,
    'debt_payment', pay_id, 'posted', uid)
  returning id into entry_id;

  if direction = 'receivable' then
    insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit, financial_account_id)
    values (bid, entry_id, gl_code_for_account(acc.type), amount, 0, acc_id);
    insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit, party_type, party_id)
    values (bid, entry_id, '1300', 0, amount, 'customer', debt.customer_id);

    update financial_accounts
      set current_balance = current_balance + amount,
          total_deposits = total_deposits + amount
    where id = acc_id;
    perform assert_account_balance_ok(acc_id);

    update customers set current_balance = current_balance - amount, last_transaction_at = occurred
      where id = debt.customer_id;
  else
    insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit, party_type, party_id)
    values (bid, entry_id, '2100', amount, 0, 'supplier', debt.supplier_id);
    insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit, financial_account_id)
    values (bid, entry_id, gl_code_for_account(acc.type), 0, amount, acc_id);

    update financial_accounts
      set current_balance = current_balance - amount,
          total_withdrawals = total_withdrawals + amount
    where id = acc_id;
    perform assert_account_balance_ok(acc_id);

    update suppliers set current_balance = current_balance - amount, last_transaction_at = occurred
      where id = debt.supplier_id;
  end if;

  update debts set
    paid_amount = paid_amount + amount,
    remaining_amount = remaining_amount - amount,
    status = case when remaining_amount - amount = 0 then 'settled' else 'partial' end
  where id = debt_id;

  insert into debt_payments (id, business_id, debt_id, amount, occurred_at, account_id,
    payment_method, journal_entry_id, notes, created_by)
  values (pay_id, bid, debt_id, amount, occurred, acc_id,
    (p->>'paymentMethod')::payment_method, entry_id, coalesce(p->>'notes',''), uid);

  perform op_audit(bid, 'create', 'debt_payment', pay_id, jsonb_build_object('debtId', debt_id, 'amount', amount));

  result := jsonb_build_object(
    'doc', jsonb_build_object('id', pay_id, 'amountMinor', (amount*100)::bigint),
    'debt', jsonb_build_object('id', debt_id, 'paidAmountMinor', ((debt.paid_amount + amount)*100)::bigint,
      'remainingAmountMinor', ((debt.remaining_amount - amount)*100)::bigint),
    'entryId', entry_id
  );
  return result;
end $$;

-- ====================== دين يدوي ======================
create or replace function apply_manual_debt(bid uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  debt_payload jsonb := p->'debt';
  debt_id uuid := (debt_payload->>'id')::uuid;
  amount numeric(14,2) := (debt_payload->>'amountMinor')::bigint / 100.0;
  direction debt_direction := (debt_payload->>'direction')::debt_direction;
  occurred timestamptz := (debt_payload->>'occurredAt')::timestamptz;
  entry_id uuid;
  result jsonb;
begin
  if amount <= 0 then raise exception 'VALIDATION: مبلغ الدين غير صحيح'; end if;
  if exists (select 1 from debts where id = debt_id and business_id = bid) then
    raise exception 'DUPLICATE: الدين موجود مسبقاً';
  end if;

  if direction = 'receivable' then
    if not exists (select 1 from customers where id = (debt_payload->>'partyId')::uuid and business_id = bid) then
      raise exception 'VALIDATION: العميل غير موجود';
    end if;
    insert into debts (id, business_id, direction, customer_id, source_type, amount, paid_amount, remaining_amount, status, notes)
    values (debt_id, bid, 'receivable', (debt_payload->>'partyId')::uuid, 'manual', amount, 0, amount, 'open', coalesce(debt_payload->>'notes',''));

    insert into journal_entries (business_id, entry_number, occurred_at, description, source_type, source_id, status, created_by)
    values (bid, next_doc_number(bid, 'journal', occurred), occurred, 'دين يدوي — عميل', 'opening', debt_id, 'posted', uid)
    returning id into entry_id;
    insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit, party_type, party_id)
    values (bid, entry_id, '1300', amount, 0, 'customer', (debt_payload->>'partyId')::uuid);
    insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit)
    values (bid, entry_id, '3100', 0, amount);

    update customers set current_balance = current_balance + amount, last_transaction_at = occurred
      where id = (debt_payload->>'partyId')::uuid;
  else
    if not exists (select 1 from suppliers where id = (debt_payload->>'partyId')::uuid and business_id = bid) then
      raise exception 'VALIDATION: المورد غير موجود';
    end if;
    insert into debts (id, business_id, direction, supplier_id, source_type, amount, paid_amount, remaining_amount, status, notes)
    values (debt_id, bid, 'payable', (debt_payload->>'partyId')::uuid, 'manual', amount, 0, amount, 'open', coalesce(debt_payload->>'notes',''));

    insert into journal_entries (business_id, entry_number, occurred_at, description, source_type, source_id, status, created_by)
    values (bid, next_doc_number(bid, 'journal', occurred), occurred, 'دين يدوي — مورد', 'opening', debt_id, 'posted', uid)
    returning id into entry_id;
    insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit)
    values (bid, entry_id, '3100', amount, 0);
    insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit, party_type, party_id)
    values (bid, entry_id, '2100', 0, amount, 'supplier', (debt_payload->>'partyId')::uuid);

    update suppliers set current_balance = current_balance + amount, last_transaction_at = occurred
      where id = (debt_payload->>'partyId')::uuid;
  end if;

  perform op_audit(bid, 'create', 'manual_debt', debt_id, jsonb_build_object('amount', amount, 'direction', direction));

  result := jsonb_build_object(
    'doc', jsonb_build_object('id', debt_id, 'amountMinor', (amount*100)::bigint),
    'entryId', entry_id
  );
  return result;
end $$;

-- ====================== تحويل / إيداع / سحب / تسوية ======================
create or replace function apply_transfer(bid uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  amount numeric(14,2) := (p->>'amountMinor')::bigint / 100.0;
  from_id uuid := (p->>'fromAccountId')::uuid;
  to_id uuid := (p->>'toAccountId')::uuid;
  occurred timestamptz := (p->>'occurredAt')::timestamptz;
  from_acc record; to_acc record;
  entry_id uuid;
  result jsonb;
begin
  if amount <= 0 then raise exception 'VALIDATION: مبلغ التحويل غير صحيح'; end if;
  if from_id = to_id then raise exception 'VALIDATION: لا يمكن التحويل إلى نفس الحساب'; end if;

  select * into from_acc from financial_accounts where id = from_id and business_id = bid and deleted_at is null;
  if not found then
    raise exception 'VALIDATION: أحد الحسابين غير موجود';
  end if;
  select * into to_acc from financial_accounts where id = to_id and business_id = bid and deleted_at is null;
  if not found then
    raise exception 'VALIDATION: أحد الحسابين غير موجود';
  end if;

  insert into journal_entries (business_id, entry_number, occurred_at, description, source_type, status, created_by)
  values (bid, next_doc_number(bid, 'journal', occurred), occurred, 'تحويل بين الحسابات', 'transfer', 'posted', uid)
  returning id into entry_id;

  insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit, financial_account_id)
  values (bid, entry_id, gl_code_for_account(to_acc.type), amount, 0, to_id);
  insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit, financial_account_id)
  values (bid, entry_id, gl_code_for_account(from_acc.type), 0, amount, from_id);

  update financial_accounts set current_balance = current_balance - amount,
    total_withdrawals = total_withdrawals + amount where id = from_id;
  update financial_accounts set current_balance = current_balance + amount,
    total_deposits = total_deposits + amount where id = to_id;
  perform assert_account_balance_ok(from_id);

  perform op_audit(bid, 'create', 'transfer', from_id, jsonb_build_object('amount', amount, 'from', from_id, 'to', to_id));

  result := jsonb_build_object('entryId', entry_id, 'fromBalanceMinor', null, 'toBalanceMinor', null);
  return result;
end $$;

create or replace function apply_deposit(bid uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  amount numeric(14,2) := (p->>'amountMinor')::bigint / 100.0;
  acc_id uuid := (p->>'accountId')::uuid;
  occurred timestamptz := (p->>'occurredAt')::timestamptz;
  entry_id uuid;
  result jsonb;
begin
  if amount <= 0 then raise exception 'VALIDATION: مبلغ الإيداع غير صحيح'; end if;
  if not exists (select 1 from financial_accounts where id = acc_id and business_id = bid and deleted_at is null) then
    raise exception 'VALIDATION: الحساب غير موجود';
  end if;

  insert into journal_entries (business_id, entry_number, occurred_at, description, source_type, status, created_by)
  values (bid, next_doc_number(bid, 'journal', occurred), occurred, 'إيداع من رأس المال', 'deposit', 'posted', uid)
  returning id into entry_id;
  insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit, financial_account_id)
  values (bid, entry_id, gl_code_for_account((select type from financial_accounts where id = acc_id)), amount, 0, acc_id);
  insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit)
  values (bid, entry_id, '3100', 0, amount);

  update financial_accounts set current_balance = current_balance + amount,
    total_deposits = total_deposits + amount where id = acc_id;

  perform op_audit(bid, 'create', 'deposit', acc_id, jsonb_build_object('amount', amount));
  result := jsonb_build_object('entryId', entry_id);
  return result;
end $$;

create or replace function apply_withdrawal(bid uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  amount numeric(14,2) := (p->>'amountMinor')::bigint / 100.0;
  acc_id uuid := (p->>'accountId')::uuid;
  occurred timestamptz := (p->>'occurredAt')::timestamptz;
  entry_id uuid;
  result jsonb;
begin
  if amount <= 0 then raise exception 'VALIDATION: مبلغ السحب غير صحيح'; end if;

  update financial_accounts set current_balance = current_balance - amount,
    total_withdrawals = total_withdrawals + amount where id = acc_id and business_id = bid and deleted_at is null;
  if not found then raise exception 'VALIDATION: الحساب غير موجود'; end if;
  perform assert_account_balance_ok(acc_id);

  insert into journal_entries (business_id, entry_number, occurred_at, description, source_type, status, created_by)
  values (bid, next_doc_number(bid, 'journal', occurred), occurred, 'سحب من رأس المال', 'withdrawal', 'posted', uid)
  returning id into entry_id;
  insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit)
  values (bid, entry_id, '3100', amount, 0);
  insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit, financial_account_id)
  values (bid, entry_id, gl_code_for_account((select type from financial_accounts where id = acc_id)), 0, amount, acc_id);

  perform op_audit(bid, 'create', 'withdrawal', acc_id, jsonb_build_object('amount', amount));
  result := jsonb_build_object('entryId', entry_id);
  return result;
end $$;

create or replace function apply_adjustment(bid uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  counted numeric(14,2) := (p->>'countedBalanceMinor')::bigint / 100.0;
  current_bal numeric(14,2) := (p->>'currentBalanceMinor')::bigint / 100.0;
  diff numeric(14,2) := (p->>'diffMinor')::bigint / 100.0;
  acc_id uuid := (p->>'accountId')::uuid;
  occurred timestamptz := (p->>'occurredAt')::timestamptz;
  entry_id uuid;
  result jsonb;
begin
  if diff <> counted - current_bal or diff = 0 or counted < 0 then
    raise exception 'VALIDATION: أرقام التسوية غير متسقة';
  end if;

  select current_balance into current_bal from financial_accounts
    where id = acc_id and business_id = bid and deleted_at is null;
  if not found then raise exception 'VALIDATION: الحساب غير موجود'; end if;
  if counted - current_bal <> diff then
    raise exception 'CONFLICT: رصيد الحساب تغيّر على الخادم — أعد التسوية';
  end if;

  insert into journal_entries (business_id, entry_number, occurred_at, description, source_type, status, created_by)
  values (bid, next_doc_number(bid, 'journal', occurred), occurred, 'تسوية رصيد', 'adjustment', 'posted', uid)
  returning id into entry_id;

  if diff > 0 then
    insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit, financial_account_id)
    values (bid, entry_id, gl_code_for_account((select type from financial_accounts where id = acc_id)), diff, 0, acc_id);
    insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit)
    values (bid, entry_id, '5950', 0, diff);
  else
    insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit)
    values (bid, entry_id, '5950', -diff, 0);
    insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit, financial_account_id)
    values (bid, entry_id, gl_code_for_account((select type from financial_accounts where id = acc_id)), 0, -diff, acc_id);
  end if;

  update financial_accounts set current_balance = counted where id = acc_id;

  perform op_audit(bid, 'create', 'adjustment', acc_id, jsonb_build_object('counted', counted, 'diff', diff));
  result := jsonb_build_object('entryId', entry_id, 'countedBalanceMinor', (counted*100)::bigint);
  return result;
end $$;

-- ====================== كيانات (upsert) ======================
create or replace function apply_entity_upsert(bid uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  entity_type text := p->>'entityType';
  row jsonb := p->'row';
  rid uuid := (row->>'id')::uuid;
  expected int := (p->>'expectedVersion');
  current_version int;
  result jsonb;
begin
  if entity_type in ('customers','suppliers') then
    if length(trim(coalesce(row->>'name',''))) < 2 then
      raise exception 'VALIDATION: الاسم مطلوب';
    end if;
  end if;

  if entity_type = 'customers' then
    select version into current_version from customers where id = rid and business_id = bid;
    if found then
      if expected is not null and current_version <> expected then
        raise exception 'CONFLICT: نسخة العميل تغيّرت على الخادم';
      end if;
      update customers set name = row->>'name', phone = nullif(row->>'phone',''),
        address = nullif(row->>'address',''), notes = nullif(row->>'notes','')
      where id = rid and business_id = bid;
      perform op_audit(bid, 'update', 'customer', rid, row);
    else
      insert into customers (id, business_id, name, phone, address, notes)
      values (rid, bid, row->>'name', nullif(row->>'phone',''), nullif(row->>'address',''), nullif(row->>'notes',''));
      perform op_audit(bid, 'create', 'customer', rid, row);
    end if;
  elsif entity_type = 'suppliers' then
    select version into current_version from suppliers where id = rid and business_id = bid;
    if found then
      if expected is not null and current_version <> expected then
        raise exception 'CONFLICT: نسخة المورد تغيّرت على الخادم';
      end if;
      update suppliers set name = row->>'name', phone = nullif(row->>'phone',''),
        address = nullif(row->>'address',''), notes = nullif(row->>'notes','')
      where id = rid and business_id = bid;
      perform op_audit(bid, 'update', 'supplier', rid, row);
    else
      insert into suppliers (id, business_id, name, phone, address, notes)
      values (rid, bid, row->>'name', nullif(row->>'phone',''), nullif(row->>'address',''), nullif(row->>'notes',''));
      perform op_audit(bid, 'create', 'supplier', rid, row);
    end if;
  elsif entity_type = 'financial_accounts' then
    select version into current_version from financial_accounts where id = rid and business_id = bid;
    if found then
      if expected is not null and current_version <> expected then
        raise exception 'CONFLICT: نسخة الحساب تغيّرت على الخادم';
      end if;
      update financial_accounts set name = row->>'name',
        provider = nullif(coalesce(row->>'provider',''), ''),
        is_active = coalesce((row->>'isActive')::boolean, true)
      where id = rid and business_id = bid;
      perform op_audit(bid, 'update', 'financial_account', rid, row);
    else
      insert into financial_accounts (id, business_id, name, type, provider, currency, gl_account_code)
      values (rid, bid, row->>'name', (row->>'type')::account_type, nullif(coalesce(row->>'provider',''), ''),
        'ILS', case when (row->>'type')::account_type = 'cash' then '1100' else '1200' end);
      perform op_audit(bid, 'create', 'financial_account', rid, row);
    end if;
  else
    raise exception 'VALIDATION: نوع كيان غير مدعوم: %', entity_type;
  end if;

  result := jsonb_build_object('entityId', rid);
  return result;
end $$;

create or replace function apply_entity_soft_delete(bid uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public as $$
declare
  entity_type text := p->>'entityType';
  rid uuid := (p->>'entityId')::uuid;
  bal numeric(14,2);
  result jsonb;
begin
  if entity_type = 'customers' then
    select current_balance into bal from customers where id = rid and business_id = bid;
    if bal is null then result := jsonb_build_object('skipped', true); return result; end if;
    if bal <> 0 then raise exception 'VALIDATION: لا حذف لجهة برصيد غير صفري'; end if;
    update customers set deleted_at = now() where id = rid and business_id = bid;
    perform op_audit(bid, 'delete', 'customer', rid, null);
  elsif entity_type = 'suppliers' then
    select current_balance into bal from suppliers where id = rid and business_id = bid;
    if bal is null then result := jsonb_build_object('skipped', true); return result; end if;
    if bal <> 0 then raise exception 'VALIDATION: لا حذف لجهة برصيد غير صفري'; end if;
    update suppliers set deleted_at = now() where id = rid and business_id = bid;
    perform op_audit(bid, 'delete', 'supplier', rid, null);
  elsif entity_type = 'financial_accounts' then
    select current_balance into bal from financial_accounts where id = rid and business_id = bid;
    if bal is null then result := jsonb_build_object('skipped', true); return result; end if;
    if bal <> 0 then raise exception 'VALIDATION: لا حذف لحساب برصيد غير صفري'; end if;
    update financial_accounts set deleted_at = now() where id = rid and business_id = bid;
    perform op_audit(bid, 'delete', 'financial_account', rid, null);
  else
    raise exception 'VALIDATION: نوع كيان غير مدعوم للحذف: %', entity_type;
  end if;
  result := jsonb_build_object('deleted', rid);
  return result;
end $$;

-- ====================== الموزّع الرئيسي (Idempotent) ======================
create or replace function apply_sync_operation(bid uuid, op jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public as $$
declare
  op_type text := op->>'opType';
  client_op_id uuid;
  existing jsonb;
  result jsonb;
begin
  if not is_member(bid) then
    raise exception 'UNAUTHENTICATED: لست عضواً في هذا المشروع';
  end if;

  client_op_id := (op->>'clientOpId')::uuid;
  if client_op_id is null then
    raise exception 'VALIDATION: clientOpId مطلوب';
  end if;

  existing := op_log_get(bid, client_op_id);
  if existing is not null then
    existing := jsonb_set(existing, '{duplicate}', 'true');
    return existing;
  end if;

  case op_type
    when 'sale.create' then
      perform op_assert_role(bid, array['owner','manager','accountant','employee']::user_role[]);
      result := apply_sale(bid, op);
    when 'purchase.create' then
      perform op_assert_role(bid, array['owner','manager','accountant']::user_role[]);
      result := apply_purchase(bid, op);
    when 'expense.create' then
      perform op_assert_role(bid, array['owner','manager','accountant','employee']::user_role[]);
      result := apply_expense(bid, op->'expense');
    when 'debt_payment.create' then
      perform op_assert_role(bid, array['owner','manager','accountant']::user_role[]);
      result := apply_debt_payment(bid, op->'payment');
    when 'manual_debt.create' then
      perform op_assert_role(bid, array['owner','manager','accountant']::user_role[]);
      result := apply_manual_debt(bid, op);
    when 'transfer.create' then
      perform op_assert_role(bid, array['owner','manager','accountant']::user_role[]);
      result := apply_transfer(bid, op->'transfer');
    when 'deposit.create' then
      perform op_assert_role(bid, array['owner','manager','accountant']::user_role[]);
      result := apply_deposit(bid, op->'deposit');
    when 'withdrawal.create' then
      perform op_assert_role(bid, array['owner','manager','accountant']::user_role[]);
      result := apply_withdrawal(bid, op->'withdrawal');
    when 'adjustment.create' then
      perform op_assert_role(bid, array['owner','manager','accountant']::user_role[]);
      result := apply_adjustment(bid, op->'adjustment');
    when 'entity.upsert' then
      perform op_assert_role(bid, array['owner','manager','accountant']::user_role[]);
      result := apply_entity_upsert(bid, op);
    when 'entity.soft_delete' then
      perform op_assert_role(bid, array['owner','manager','accountant']::user_role[]);
      result := apply_entity_soft_delete(bid, op);
    else
      raise exception 'VALIDATION: نوع عملية غير مدعوم: %', op_type;
  end case;

  result := jsonb_set(result, '{opType}', to_jsonb(op_type));
  result := jsonb_set(result, '{clientOpId}', to_jsonb(client_op_id));
  perform op_log_put(bid, client_op_id, op_type, result);
  return result;
end $$;

revoke execute on function apply_sync_operation(uuid, jsonb) from public, anon;
grant execute on function apply_sync_operation(uuid, jsonb) to authenticated;

-- ====================== إلغاء مستند مرحّل (Void بقيد عكسي) ======================
create or replace function void_posted_document(bid uuid, doc_type text, doc_id uuid, reason text)
returns jsonb
language plpgsql
security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  doc record;
  doc2 record;
  entry record;
  rev_entry_id uuid;
  result jsonb;
begin
  perform op_assert_role(bid, array['owner','manager','accountant']::user_role[]);
  if reason is null or length(trim(reason)) < 3 then
    raise exception 'VALIDATION: سبب الإلغاء مطلوب (3 أحرف على الأقل)';
  end if;

  if doc_type = 'sale' then
    select * into doc from sales where id = doc_id and business_id = bid and deleted_at is null;
    if not found then raise exception 'VALIDATION: الفاتورة غير موجودة'; end if;
    if doc.status = 'void' then raise exception 'VALIDATION: الفاتورة ملغاة مسبقاً'; end if;

    select e.* into entry from journal_entries e where e.source_id = doc_id and e.source_type = 'sale' and e.status = 'posted' limit 1;
    insert into journal_entries (business_id, entry_number, occurred_at, description, source_type, source_id, status, reversal_of_entry_id, created_by)
    values (bid, next_doc_number(bid, 'journal'), now(), 'قيد عكسي: إلغاء بيع ' || doc.sale_number, 'reversal', doc_id, 'posted', entry.id, uid)
    returning id into rev_entry_id;
    insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit, financial_account_id, party_type, party_id)
    select bid, rev_entry_id, l.gl_account_code, l.credit, l.debit, l.financial_account_id, l.party_type, l.party_id
      from journal_entry_lines l where l.entry_id = entry.id;

    update financial_accounts f set current_balance = f.current_balance - t.delta,
      total_withdrawals = f.total_withdrawals + greatest(t.delta, 0),
      total_deposits = f.total_deposits + greatest(-t.delta, 0)
    from (
      select l.financial_account_id as fid, sum(l.debit - l.credit) as delta
      from journal_entry_lines l where l.entry_id = rev_entry_id and l.financial_account_id is not null
      group by l.financial_account_id
    ) t where t.fid = f.id;
    perform assert_account_balance_ok(doc.account_id);

    if doc.debt_id is not null then
      update debts set deleted_at = now() where id = doc.debt_id;
      update customers set current_balance = current_balance - doc.remaining_amount where id = doc.customer_id;
    end if;
    update customers set total_transactions = total_transactions - doc.net_amount where id = doc.customer_id;
    update sales set status = 'void', voided_at = now(), voided_by = uid, void_reason = reason where id = doc_id;

    perform op_audit(bid, 'void', 'sale', doc_id, jsonb_build_object('reason', reason, 'reversal_entry', rev_entry_id));
    result := jsonb_build_object('voided', doc_id, 'reversalEntryId', rev_entry_id);

  elsif doc_type = 'purchase' then
    select * into doc from purchases where id = doc_id and business_id = bid and deleted_at is null;
    if not found then raise exception 'VALIDATION: الفاتورة غير موجودة'; end if;
    if doc.status = 'void' then raise exception 'VALIDATION: الفاتورة ملغاة مسبقاً'; end if;

    select e.* into entry from journal_entries e where e.source_id = doc_id and e.source_type = 'purchase' and e.status = 'posted' limit 1;
    insert into journal_entries (business_id, entry_number, occurred_at, description, source_type, source_id, status, reversal_of_entry_id, created_by)
    values (bid, next_doc_number(bid, 'journal'), now(), 'قيد عكسي: إلغاء شراء ' || doc.purchase_number, 'reversal', doc_id, 'posted', entry.id, uid)
    returning id into rev_entry_id;
    insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit, financial_account_id, party_type, party_id)
    select bid, rev_entry_id, l.gl_account_code, l.credit, l.debit, l.financial_account_id, l.party_type, l.party_id
      from journal_entry_lines l where l.entry_id = entry.id;

    update financial_accounts f set current_balance = f.current_balance + t.delta,
      total_deposits = f.total_deposits + greatest(t.delta, 0),
      total_withdrawals = f.total_withdrawals + greatest(-t.delta, 0)
    from (
      select l.financial_account_id as fid, sum(l.debit - l.credit) as delta
      from journal_entry_lines l where l.entry_id = rev_entry_id and l.financial_account_id is not null
      group by l.financial_account_id
    ) t where t.fid = f.id;
    perform assert_account_balance_ok(doc.account_id);

    if doc.debt_id is not null then
      update debts set deleted_at = now() where id = doc.debt_id;
      update suppliers set current_balance = current_balance - doc.remaining_amount where id = doc.supplier_id;
    end if;
    update suppliers set total_transactions = total_transactions - doc.net_amount where id = doc.supplier_id;
    update purchases set status = 'void', voided_at = now(), voided_by = uid, void_reason = reason where id = doc_id;

    perform op_audit(bid, 'void', 'purchase', doc_id, jsonb_build_object('reason', reason, 'reversal_entry', rev_entry_id));
    result := jsonb_build_object('voided', doc_id, 'reversalEntryId', rev_entry_id);

  elsif doc_type = 'expense' then
    select * into doc from expenses where id = doc_id and business_id = bid and deleted_at is null;
    if not found then raise exception 'VALIDATION: المصروف غير موجود'; end if;
    if doc.status = 'void' then raise exception 'VALIDATION: المصروف ملغى مسبقاً'; end if;

    select e.* into entry from journal_entries e where e.source_id = doc_id and e.source_type = 'expense' and e.status = 'posted' limit 1;
    insert into journal_entries (business_id, entry_number, occurred_at, description, source_type, source_id, status, reversal_of_entry_id, created_by)
    values (bid, next_doc_number(bid, 'journal'), now(), 'قيد عكسي: إلغاء مصروف ' || doc.title, 'reversal', doc_id, 'posted', entry.id, uid)
    returning id into rev_entry_id;
    insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit, financial_account_id)
    select bid, rev_entry_id, l.gl_account_code, l.credit, l.debit, l.financial_account_id
      from journal_entry_lines l where l.entry_id = entry.id;

    update financial_accounts f set current_balance = f.current_balance + t.delta,
      total_deposits = f.total_deposits + greatest(t.delta, 0)
    from (
      select l.financial_account_id as fid, sum(l.debit - l.credit) as delta
      from journal_entry_lines l where l.entry_id = rev_entry_id and l.financial_account_id is not null
      group by l.financial_account_id
    ) t where t.fid = f.id;
    perform assert_account_balance_ok(doc.account_id);

    update expenses set status = 'void', voided_at = now(), voided_by = uid, void_reason = reason where id = doc_id;

    perform op_audit(bid, 'void', 'expense', doc_id, jsonb_build_object('reason', reason, 'reversal_entry', rev_entry_id));
    result := jsonb_build_object('voided', doc_id, 'reversalEntryId', rev_entry_id);

  elsif doc_type = 'debt_payment' then
    select * into doc from debt_payments where id = doc_id and business_id = bid and deleted_at is null;
    if not found then raise exception 'VALIDATION: الدفعة غير موجودة'; end if;

    select e.* into entry from journal_entries e where e.source_id = doc_id and e.source_type = 'debt_payment' and e.status = 'posted' limit 1;
    if entry.id is null then raise exception 'VALIDATION: قيد الدفعة غير موجود'; end if;

    insert into journal_entries (business_id, entry_number, occurred_at, description, source_type, source_id, status, reversal_of_entry_id, created_by)
    values (bid, next_doc_number(bid, 'journal'), now(), 'قيد عكسي: إلغاء دفعة', 'reversal', doc_id, 'posted', entry.id, uid)
    returning id into rev_entry_id;
    insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit, financial_account_id, party_type, party_id)
    select bid, rev_entry_id, l.gl_account_code, l.credit, l.debit, l.financial_account_id, l.party_type, l.party_id
      from journal_entry_lines l where l.entry_id = entry.id;

    select * into doc2 from debts where id = doc.debt_id;
    if doc2.direction = 'receivable' then
      update financial_accounts f set current_balance = f.current_balance - doc.amount,
        total_withdrawals = f.total_withdrawals + doc.amount where id = doc.account_id;
      perform assert_account_balance_ok(doc.account_id);
      update customers set current_balance = current_balance + doc.amount where id = doc2.customer_id;
    else
      update financial_accounts f set current_balance = f.current_balance + doc.amount,
        total_deposits = f.total_deposits + doc.amount where id = doc.account_id;
      update suppliers set current_balance = current_balance + doc.amount where id = doc2.supplier_id;
    end if;

    update debts set paid_amount = paid_amount - doc.amount,
      remaining_amount = remaining_amount + doc.amount,
      status = case when remaining_amount + doc.amount = amount then 'open' else 'partial' end
    where id = doc.debt_id;
    update debt_payments set deleted_at = now() where id = doc_id;

    perform op_audit(bid, 'void', 'debt_payment', doc_id, jsonb_build_object('reason', reason, 'reversal_entry', rev_entry_id));
    result := jsonb_build_object('voided', doc_id, 'reversalEntryId', rev_entry_id);
  else
    raise exception 'VALIDATION: نوع مستند غير مدعوم للإلغاء';
  end if;

  return result;
end $$;

revoke execute on function void_posted_document(uuid, text, uuid, text) from public, anon;
grant execute on function void_posted_document(uuid, text, uuid, text) to authenticated;

commit;

-- =====================================================================
-- 0008_fix_balance_trigger.sql (المطلوب تشغيله الآن)
-- =====================================================================
-- 0008: إصلاح حارس توازن القيود
-- المشكلة: التريغر القديم على مستوى الجملة (FOR EACH STATEMENT) يفحص التوازن بعد كل
-- عبارة إدراج منفصلة، ودوال RPC تدرج سطور القيد في عبارات متعاقبة (مدين ثم دائن)
-- فيفشل الفحص الوسيط «مدين=100 دائن=0» رغم أن القيد النهائي متوازن.
-- الحل: Constraint Trigger مؤجّل (DEFERRABLE INITIALLY DEFERRED) على مستوى الصف
-- يُنفّذ عند نهاية المعاملة بعد اكتمال كل السطور.

drop trigger if exists journal_lines_balance_guard on journal_entry_lines;
drop function if exists assert_balanced_entry();

create or replace function assert_balanced_entry_row()
returns trigger
language plpgsql as $$
declare
  total_debit numeric(14,2);
  total_credit numeric(14,2);
  bad_lines int;
begin
  if new.debit < 0 or new.credit < 0
    or (new.debit > 0 and new.credit > 0)
    or (new.debit = 0 and new.credit = 0) then
    raise exception 'سطر قيد فاسد: مدين=% دائن=%', new.debit, new.credit;
  end if;

  select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into total_debit, total_credit
    from journal_entry_lines
    where entry_id = new.entry_id;

  if total_debit <> total_credit then
    raise exception 'قيد غير متوازن: مدين=% دائن=% (entry=%)', total_debit, total_credit, new.entry_id;
  end if;
  if total_debit = 0 then
    raise exception 'قيد بقيمة صفر (entry=%)', new.entry_id;
  end if;

  select count(*) into bad_lines
    from journal_entry_lines
    where entry_id = new.entry_id
      and ((debit > 0 and credit > 0) or (debit = 0 and credit = 0) or debit < 0 or credit < 0);
  if bad_lines > 0 then
    raise exception 'سطور قيد فاسدة (entry=%)', new.entry_id;
  end if;

  return null;
end $$;

create constraint trigger journal_lines_balance_guard
after insert on journal_entry_lines
deferrable initially deferred
for each row execute function assert_balanced_entry_row();

-- تحقق فوري إضافي (غير مؤجل) على صحة السطر نفسه فقط، بلا فحص مجموع
create or replace function assert_line_shape()
returns trigger
language plpgsql as $$
begin
  if new.debit < 0 or new.credit < 0
    or (new.debit > 0 and new.credit > 0)
    or (new.debit = 0 and new.credit = 0) then
    raise exception 'سطر قيد فاسد: مدين=% دائن=%', new.debit, new.credit;
  end if;
  return new;
end $$;

drop trigger if exists journal_line_shape_guard on journal_entry_lines;
create trigger journal_line_shape_guard
before insert on journal_entry_lines
for each row execute function assert_line_shape();
