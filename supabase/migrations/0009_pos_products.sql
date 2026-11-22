-- 0009: نظام الكاشير — المنتجات وسطور فواتير البيع وحركات المخزون
-- المنتجات بباركود فريد لكل مشروع، الكميات بوحدة الألف (milli = 1000 لكل وحدة)

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  category text not null default '',
  unit text not null default 'piece',
  barcode text,
  purchase_price numeric(14,2) not null default 0,
  sale_price numeric(14,2) not null default 0,
  quantity numeric(14,3) not null default 0,
  min_quantity numeric(14,3) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version int not null default 1,
  constraint products_unit_valid check (
    unit in ('piece','kg','liter','box','meter','other')
  ),
  constraint products_prices_nonnegative check (
    purchase_price >= 0 and sale_price >= 0
  )
);

create table if not exists sale_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  sale_id uuid not null references sales(id) on delete cascade,
  product_id uuid,
  name text not null,
  quantity numeric(14,3) not null,
  unit_price numeric(14,2) not null,
  total numeric(14,2) not null,
  line_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists inventory_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  type text not null,
  quantity numeric(14,3) not null,
  unit_cost numeric(14,2),
  ref_type text,
  ref_id uuid,
  occurred_at timestamptz not null default now(),
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint inventory_movements_type_valid check (
    type in ('in','out','adjust')
  )
);

-- باركود فريد لكل مشروع (بين السجلات غير المحذوفة)
create unique index if not exists products_barcode_unique
  on products (business_id, barcode)
  where barcode is not null and deleted_at is null;

create index if not exists products_business_name_idx on products (business_id, name);
create index if not exists products_business_active_idx on products (business_id, is_active) where deleted_at is null;
create index if not exists sale_items_sale_idx on sale_items (sale_id);
create index if not exists sale_items_product_idx on sale_items (business_id, product_id) where product_id is not null;
create index if not exists inventory_movements_product_idx on inventory_movements (business_id, product_id, occurred_at);
create index if not exists inventory_movements_ref_idx on inventory_movements (business_id, ref_type, ref_id);

create trigger set_updated_at_products before update on products
  for each row execute function set_updated_at();

create trigger set_updated_at_sale_items before update on sale_items
  for each row execute function set_updated_at();

-- ====================== RLS ======================
alter table products enable row level security;
alter table sale_items enable row level security;
alter table inventory_movements enable row level security;

drop policy if exists products_select on products;
create policy products_select on products for select to authenticated
  using (is_member(business_id));

drop policy if exists products_insert on products;
create policy products_insert on products for insert to authenticated
  with check (is_member(business_id) and user_role_in(business_id, array['owner','manager','accountant']::user_role[]));

drop policy if exists products_update on products;
create policy products_update on products for update to authenticated
  using (is_member(business_id) and user_role_in(business_id, array['owner','manager','accountant']::user_role[]))
  with check (is_member(business_id) and user_role_in(business_id, array['owner','manager','accountant']::user_role[]));

drop policy if exists sale_items_select on sale_items;
create policy sale_items_select on sale_items for select to authenticated
  using (is_member(business_id));

drop policy if exists sale_items_insert on sale_items;
create policy sale_items_insert on sale_items for insert to authenticated
  with check (is_member(business_id));

drop policy if exists inventory_movements_select on inventory_movements;
create policy inventory_movements_select on inventory_movements for select to authenticated
  using (is_member(business_id));

drop policy if exists inventory_movements_insert on inventory_movements;
create policy inventory_movements_insert on inventory_movements for insert to authenticated
  with check (is_member(business_id));

-- ====================== معالجات المزامنة (المنتجات) ======================
create or replace function apply_product_upsert(bid uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  row jsonb := p->'row';
  rid uuid := (row->>'id')::uuid;
  expected int := (p->>'expectedVersion');
  current_version int;
  unit text := coalesce(row->>'unit', 'piece');
  result jsonb;
begin
  perform op_assert_role(bid, array['owner','manager','accountant']::user_role[]);

  if length(trim(coalesce(row->>'name',''))) < 2 then
    raise exception 'VALIDATION: اسم المنتج مطلوب (حرفان على الأقل)';
  end if;
  if unit not in ('piece','kg','liter','box','meter','other') then
    raise exception 'VALIDATION: وحدة القياس غير صالحة';
  end if;
  if ((row->>'salePriceMinor')::bigint) < 0 or ((row->>'purchasePriceMinor')::bigint) < 0
     or ((row->>'quantityMilli')::bigint) < 0 or ((row->>'minQuantityMilli')::bigint) < 0 then
    raise exception 'VALIDATION: قيم المنتج غير صالحة';
  end if;

  if exists (
    select 1 from products
    where business_id = bid
      and barcode = nullif(row->>'barcode','')
      and id <> rid
      and deleted_at is null
  ) then
    raise exception 'VALIDATION: الباركود مستخدم لمنتج آخر';
  end if;

  select version into current_version from products where id = rid and business_id = bid;
  if found then
    if expected is not null and current_version <> expected then
      raise exception 'CONFLICT: نسخة المنتج تغيّرت على الخادم';
    end if;
    update products set
      name = row->>'name',
      category = coalesce(row->>'category',''),
      unit = unit,
      barcode = nullif(row->>'barcode',''),
      purchase_price = ((row->>'purchasePriceMinor')::bigint) / 100.0,
      sale_price = ((row->>'salePriceMinor')::bigint) / 100.0,
      quantity = ((row->>'quantityMilli')::bigint) / 1000.0,
      min_quantity = ((row->>'minQuantityMilli')::bigint) / 1000.0,
      is_active = coalesce((row->>'isActive')::boolean, true)
    where id = rid and business_id = bid;
    perform op_audit(bid, 'update', 'product', rid, row);
  else
    insert into products (id, business_id, name, category, unit, barcode,
      purchase_price, sale_price, quantity, min_quantity, is_active)
    values (rid, bid, row->>'name', coalesce(row->>'category',''), unit,
      nullif(row->>'barcode',''),
      ((row->>'purchasePriceMinor')::bigint) / 100.0,
      ((row->>'salePriceMinor')::bigint) / 100.0,
      ((row->>'quantityMilli')::bigint) / 1000.0,
      ((row->>'minQuantityMilli')::bigint) / 1000.0,
      coalesce((row->>'isActive')::boolean, true));
    perform op_audit(bid, 'create', 'product', rid, row);
  end if;

  result := jsonb_build_object('entityId', rid);
  return result;
end $$;

create or replace function apply_product_soft_delete(bid uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public as $$
declare
  rid uuid := (p->>'entityId')::uuid;
  result jsonb;
begin
  perform op_assert_role(bid, array['owner','manager','accountant']::user_role[]);
  if not exists (select 1 from products where id = rid and business_id = bid) then
    result := jsonb_build_object('skipped', true);
    return result;
  end if;
  update products set deleted_at = now() where id = rid and business_id = bid;
  perform op_audit(bid, 'delete', 'product', rid, null);
  result := jsonb_build_object('deleted', rid);
  return result;
end $$;

create or replace function apply_inventory_adjust(bid uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  pid uuid := (p->>'productId')::uuid;
  mv_type text := p->>'type';
  qty bigint := (p->>'quantityMilli')::bigint;
  counted bigint := nullif(p->>'countedQuantityMilli', '')::bigint;
  expected bigint := (p->>'expectedQuantityMilli')::bigint;
  current_qty bigint;
  result jsonb;
begin
  perform op_assert_role(bid, array['owner','manager','accountant','employee']::user_role[]);
  if not exists (select 1 from products where id = pid and business_id = bid and deleted_at is null) then
    raise exception 'VALIDATION: المنتج غير موجود';
  end if;
  if qty <= 0 then
    raise exception 'VALIDATION: كمية الحركة غير صالحة';
  end if;
  if mv_type not in ('in','out','adjust') then
    raise exception 'VALIDATION: نوع حركة المخزون غير صالحة';
  end if;

  select (quantity * 1000)::bigint into current_qty from products where id = pid;
  if mv_type = 'adjust' then
    if counted is null or counted < 0 then
      raise exception 'VALIDATION: الكمية المعدودة غير صالحة';
    end if;
    if expected is not null and current_qty <> expected then
      raise exception 'CONFLICT: كمية المنتج تغيّرت على الخادم — أعد الجرد';
    end if;
    update products set quantity = counted / 1000.0 where id = pid;
  elsif mv_type = 'in' then
    update products set quantity = quantity + qty / 1000.0 where id = pid;
  else
    update products set quantity = quantity - qty / 1000.0 where id = pid;
  end if;

  insert into inventory_movements (business_id, product_id, type, quantity, unit_cost, ref_type, ref_id, occurred_at, notes, created_by)
  values (
    bid, pid, mv_type,
    case when mv_type = 'adjust'
      then (abs(coalesce(counted, 0) - current_qty) / 1000.0)
      else qty / 1000.0 end,
    (nullif(p->>'unitCostMinor',''))::bigint / 100.0,
    p->>'refType',
    (p->>'refId')::uuid,
    (p->>'occurredAt')::timestamptz,
    coalesce(p->>'notes',''),
    uid
  );

  perform op_audit(bid, 'create', 'inventory_movement', pid,
    jsonb_build_object('type', mv_type, 'quantityMilli', qty, 'productId', pid));
  result := jsonb_build_object('productId', pid, 'type', mv_type);
  return result;
end $$;

-- ====================== سطور البيع + خصم المخزون داخل apply_sale ======================
create or replace function apply_sale(bid uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  sale_payload jsonb := p->'sale';
  debt_payload jsonb := nullif(p->'debt', 'null'::jsonb);
  items jsonb := sale_payload->'items';
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
  item jsonb;
  item_qty numeric(14,3);
  item_price numeric(14,2);
  item_total numeric(14,2);
  items_sum numeric(14,2) := 0;
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

  if jsonb_typeof(items) = 'array' then
    if jsonb_array_length(items) = 0 then
      raise exception 'VALIDATION: سطور الفاتورة فارغة';
    end if;
    for item in select * from jsonb_array_elements(items) loop
      if ((item->>'quantityMilli')::bigint) <= 0 then
        raise exception 'VALIDATION: كمية سطر غير صالحة';
      end if;
      item_qty := ((item->>'quantityMilli')::bigint) / 1000.0;
      item_price := ((item->>'unitPriceMinor')::bigint) / 100.0;
      item_total := ((item->>'totalMinor')::bigint) / 100.0;
      if item_total <> round(item_qty * item_price, 2) then
        raise exception 'VALIDATION: مجموع السطر لا يطابق الكمية × السعر';
      end if;
      if length(trim(coalesce(item->>'name',''))) = 0 then
        raise exception 'VALIDATION: اسم الصنف مطلوب';
      end if;
      items_sum := items_sum + item_total;
    end loop;
    if items_sum <> total then
      raise exception 'VALIDATION: مجموع السطور لا يطابق إجمالي الفاتورة';
    end if;
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

  if jsonb_typeof(items) = 'array' then
    for item in select * from jsonb_array_elements(items) loop
      item_qty := ((item->>'quantityMilli')::bigint) / 1000.0;
      item_price := ((item->>'unitPriceMinor')::bigint) / 100.0;
      item_total := ((item->>'totalMinor')::bigint) / 100.0;

      insert into sale_items (id, business_id, sale_id, product_id, name, quantity, unit_price, total, line_note)
      values ((item->>'id')::uuid, bid, sid, (item->>'productId')::uuid,
        item->>'name', item_qty, item_price, item_total, nullif(item->>'lineNote',''));

      if (item->>'productId')::uuid is not null then
        update products set quantity = quantity - item_qty
        where id = (item->>'productId')::uuid and business_id = bid and deleted_at is null;

        insert into inventory_movements (business_id, product_id, type, quantity, ref_type, ref_id, occurred_at, created_by)
        values (bid, (item->>'productId')::uuid, 'out', item_qty, 'sale', sid, occurred, uid);
      end if;
    end loop;
  end if;

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

  perform op_audit(bid, 'create', 'sale', sid, jsonb_build_object('sale_number', sale_no, 'net', net, 'paid', paid, 'remaining', rem, 'items', coalesce(jsonb_array_length(items), 0)));

  result := jsonb_build_object(
    'doc', jsonb_build_object('id', sid, 'saleNumber', sale_no, 'netAmountMinor', (net*100)::bigint,
      'paidAmountMinor', (paid*100)::bigint, 'remainingAmountMinor', (rem*100)::bigint, 'debtId', debt_id),
    'entryId', entry_id
  );
  return result;
end $$;

-- ====================== الموزّع الرئيسي: العمليات الجديدة ======================
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
    when 'product.upsert' then
      result := apply_product_upsert(bid, op);
    when 'product.soft_delete' then
      result := apply_product_soft_delete(bid, op);
    when 'inventory.adjust' then
      result := apply_inventory_adjust(bid, op);
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
