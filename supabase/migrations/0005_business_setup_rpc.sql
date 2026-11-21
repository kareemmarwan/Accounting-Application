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
