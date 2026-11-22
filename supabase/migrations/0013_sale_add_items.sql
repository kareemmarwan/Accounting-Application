-- 0013: تعديل فاتورة بيع موجودة بإضافة أصناف (sale.add_items)
-- القاعدة: الفاتورة المرحّلة لا تُعدَّل قيودها — الإضافة تنشئ قيد دلتا جديد متوازن
-- + إصلاح إلغاء البيع: عكس كل قيود الفاتورة (الأصل والإضافات) واستعادة المخزون

create or replace function apply_sale_add_items(bid uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  sale_row sales%rowtype;
  sid uuid := (p->>'saleId')::uuid;
  items jsonb := p->'items';
  delta numeric(14,2) := (p->>'totalMinor')::bigint / 100.0;
  paid numeric(14,2) := (p->>'paidAmountMinor')::bigint / 100.0;
  rem numeric(14,2);
  cust_id uuid := (p->>'customerId');
  acc_id uuid := (p->>'accountId');
  method payment_method := (p->>'paymentMethod')::payment_method;
  occurred timestamptz := (p->>'occurredAt')::timestamptz;
  acc record;
  item jsonb;
  item_qty numeric(14,3);
  item_price numeric(14,2);
  item_total numeric(14,2);
  items_sum numeric(14,2) := 0;
  entry_id uuid;
  new_debt_id uuid;
  result jsonb;
begin
  perform op_assert_role(bid, array['owner','manager','accountant','employee']::user_role[]);

  if delta <= 0 then
    raise exception 'VALIDATION: قيمة الإضافة يجب أن تكون أكبر من صفر';
  end if;

  select * into sale_row from sales
    where id = sid and business_id = bid and deleted_at is null;
  if not found then
    raise exception 'VALIDATION: الفاتورة غير موجودة';
  end if;
  if sale_row.status = 'void' then
    raise exception 'VALIDATION: لا إضافة على فاتورة ملغاة';
  end if;

  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then
    raise exception 'VALIDATION: سطور الإضافة فارغة';
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
  if items_sum <> delta then
    raise exception 'VALIDATION: مجموع السطور لا يطابق قيمة الإضافة';
  end if;

  if paid < 0 or paid > delta then
    raise exception 'VALIDATION: المدفوع خارج حدود الإضافة';
  end if;
  if method = 'credit' and paid <> 0 then
    raise exception 'VALIDATION: طريقة آجل لا تقبل مدفوعاً';
  end if;

  rem := delta - paid;
  cust_id := coalesce(cust_id, sale_row.customer_id);
  if rem > 0 and cust_id is null then
    raise exception 'VALIDATION: الجزء الآجل يتطلب عميلاً';
  end if;

  if paid > 0 then
    if acc_id is null then
      raise exception 'VALIDATION: حساب الاستلام مطلوب عند وجود مدفوع';
    end if;
    select * into acc from financial_accounts
      where id = acc_id and business_id = bid and deleted_at is null;
    if not found then
      raise exception 'VALIDATION: حساب الاستلام غير موجود';
    end if;
  end if;

  insert into sale_items (id, business_id, sale_id, product_id, name, quantity, unit_price, total, line_note)
  select (item->>'id')::uuid, bid, sid, (item->>'productId')::uuid,
    item->>'name',
    ((item->>'quantityMilli')::bigint) / 1000.0,
    ((item->>'unitPriceMinor')::bigint) / 100.0,
    ((item->>'totalMinor')::bigint) / 100.0,
    nullif(item->>'lineNote','')
  from jsonb_array_elements(items) as item;

  for item in select * from jsonb_array_elements(items) loop
    if (item->>'productId')::uuid is not null then
      update products set quantity = quantity - ((item->>'quantityMilli')::bigint) / 1000.0
      where id = (item->>'productId')::uuid and business_id = bid and deleted_at is null;

      insert into inventory_movements (business_id, product_id, type, quantity, ref_type, ref_id, occurred_at, created_by)
      values (bid, (item->>'productId')::uuid, 'out',
        ((item->>'quantityMilli')::bigint) / 1000.0, 'sale', sid, occurred, uid);
    end if;
  end loop;

  update sales set
    total_amount = total_amount + delta,
    net_amount = net_amount + delta,
    paid_amount = paid_amount + paid,
    remaining_amount = remaining_amount + rem
  where id = sid;

  insert into journal_entries (business_id, entry_number, occurred_at, description, source_type, source_id, status, created_by)
  values (bid, next_doc_number(bid, 'journal', occurred),
    occurred,
    'إضافة إلى فاتورة بيع ' || sale_row.sale_number,
    'sale', sid, 'posted', uid)
  returning id into entry_id;

  insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit)
  values (bid, entry_id, '4100', 0, delta);

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

    if sale_row.debt_id is not null then
      update debts set
        amount = amount + rem,
        remaining_amount = remaining_amount + rem,
        status = case when remaining_amount + rem > 0 then
          case when paid_amount > 0 then 'partial' else 'open' end
        else 'settled' end
      where id = sale_row.debt_id and business_id = bid;
      new_debt_id := sale_row.debt_id;
    else
      new_debt_id := coalesce((p->>'debtId')::uuid, gen_random_uuid());
      insert into debts (id, business_id, direction, customer_id, source_type, source_id,
        amount, paid_amount, remaining_amount, status)
      values (new_debt_id, bid, 'receivable', cust_id, 'sale', sid, rem, 0, rem, 'open');
      update sales set debt_id = new_debt_id where id = sid;
    end if;

    update customers set
      current_balance = current_balance + rem,
      total_transactions = total_transactions + delta,
      last_transaction_at = occurred
    where id = cust_id;
  else
    update customers set
      total_transactions = total_transactions + delta,
      last_transaction_at = occurred
    where id = cust_id;
  end if;

  perform op_audit(bid, 'update', 'sale', sid, jsonb_build_object(
    'action', 'add_items', 'added', delta, 'paid', paid, 'remaining', rem,
    'items', jsonb_array_length(items), 'entry', entry_id));

  result := jsonb_build_object(
    'doc', jsonb_build_object(
      'saleId', sid,
      'addedMinor', (delta*100)::bigint,
      'paidMinor', (paid*100)::bigint,
      'remainingMinor', (rem*100)::bigint,
      'debtId', new_debt_id
    ),
    'entryId', entry_id
  );
  return result;
end $$;

-- إلغاء البيع: عكس كل قيود الفاتورة (الأصل + كل الإضافات) واستعادة المخزون
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

    for entry in
      select e.* from journal_entries e
      where e.source_id = doc_id and e.source_type = 'sale' and e.status = 'posted'
      order by e.occurred_at, e.created_at
    loop
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
    end loop;
    perform assert_account_balance_ok(doc.account_id);

    update products pr set quantity = pr.quantity + si.quantity
    from sale_items si
    where si.sale_id = doc_id and si.product_id = pr.id and pr.business_id = bid;

    insert into inventory_movements (business_id, product_id, type, quantity, ref_type, ref_id, occurred_at, notes, created_by)
    select bid, si.product_id, 'in', si.quantity, 'void_sale', doc_id, now(), 'استعادة مخزون عند إلغاء الفاتورة', uid
    from sale_items si
    where si.sale_id = doc_id and si.product_id is not null;

    if doc.debt_id is not null then
      update debts set deleted_at = now() where id = doc.debt_id;
      update customers set current_balance = current_balance - doc.remaining_amount where id = doc.customer_id;
    end if;
    update customers set total_transactions = total_transactions - doc.net_amount where id = doc.customer_id;
    update sales set status = 'void', voided_at = now(), voided_by = uid, void_reason = reason where id = doc_id;

    perform op_audit(bid, 'void', 'sale', doc_id, jsonb_build_object('reason', reason, 'restored_stock', true));
    result := jsonb_build_object('voided', doc_id);

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
    when 'sale.add_items' then
      result := apply_sale_add_items(bid, op);
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
