create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create or replace function next_doc_number(bid uuid, doc_type text, at timestamptz default now())
returns text
language plpgsql security definer set search_path = public as $$
declare
  prefix text;
  y int;
  n int;
begin
  if doc_type = 'sale' then prefix := 'S';
  elsif doc_type = 'purchase' then prefix := 'P';
  elsif doc_type = 'journal' then prefix := 'JE';
  else raise exception 'doc_type غير مدعوم: %', doc_type;
  end if;
  y := extract(year from at)::int;
  insert into business_sequences (business_id, doc_type, prefix, last_number, year)
  values (bid, doc_type, prefix, 1, y)
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
