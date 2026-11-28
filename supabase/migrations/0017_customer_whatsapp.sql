-- 0017: رقم واتساب للجهات (العملاء والموردون)
-- يُخزَّن دولياً بأرقام فقط (مثل 966599123456) ليُستخدم في روابط wa.me
-- لإرسال الفواتير مباشرة وتذكيرات الديون. العمود اختياري، والتمرير عبر
-- entity.upsert يتطلب إعادة تعريف apply_entity_upsert لإدراجه.

alter table customers
  add column if not exists whatsapp text;
alter table suppliers
  add column if not exists whatsapp text;

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
        whatsapp = nullif(row->>'whatsapp',''),
        address = nullif(row->>'address',''), notes = nullif(row->>'notes','')
      where id = rid and business_id = bid;
      perform op_audit(bid, 'update', 'customer', rid, row);
    else
      insert into customers (id, business_id, name, phone, whatsapp, address, notes)
      values (rid, bid, row->>'name', nullif(row->>'phone',''), nullif(row->>'whatsapp',''),
        nullif(row->>'address',''), nullif(row->>'notes',''));
      perform op_audit(bid, 'create', 'customer', rid, row);
    end if;
  elsif entity_type = 'suppliers' then
    select version into current_version from suppliers where id = rid and business_id = bid;
    if found then
      if expected is not null and current_version <> expected then
        raise exception 'CONFLICT: نسخة المورد تغيّرت على الخادم';
      end if;
      update suppliers set name = row->>'name', phone = nullif(row->>'phone',''),
        whatsapp = nullif(row->>'whatsapp',''),
        address = nullif(row->>'address',''), notes = nullif(row->>'notes','')
      where id = rid and business_id = bid;
      perform op_audit(bid, 'update', 'supplier', rid, row);
    else
      insert into suppliers (id, business_id, name, phone, whatsapp, address, notes)
      values (rid, bid, row->>'name', nullif(row->>'phone',''), nullif(row->>'whatsapp',''),
        nullif(row->>'address',''), nullif(row->>'notes',''));
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
