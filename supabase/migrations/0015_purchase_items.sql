-- 0015: مشتريات بأصناف ترفع المخزون
-- فاتورة مشتريات قد تحمل مصفوفة items اختيارية: كل صنف بمنتج يرفع كميته
-- ويسجل حركة مخزون 'in' مع مرجع الفاتورة. الأصناف تخزن في purchase_items.
-- الإلغاء يستعيد المخزون من سطور الشراء مثل إلغاء البيع.

create or replace function apply_purchase(bid uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  purchase_payload jsonb := p->'purchase';
  debt_payload jsonb := nullif(p->'debt', 'null'::jsonb);
  items jsonb := purchase_payload->'items';
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
  item jsonb;
  item_qty numeric(14,3);
  item_price numeric(14,2);
  item_total numeric(14,2);
  items_sum numeric(14,2) := 0;
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

  if items is not null and jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0 then
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
      raise exception 'VALIDATION: مجموع الأصناف لا يطابق إجمالي الفاتورة';
    end if;
  else
    items := null;
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

  if items is not null then
    for item in select * from jsonb_array_elements(items) loop
      insert into purchase_items (id, business_id, purchase_id, product_id, name, quantity, unit_price, total)
      values ((item->>'id')::uuid, bid, pid, (item->>'productId')::uuid,
        item->>'name',
        ((item->>'quantityMilli')::bigint) / 1000.0,
        ((item->>'unitPriceMinor')::bigint) / 100.0,
        ((item->>'totalMinor')::bigint) / 100.0);

      if (item->>'productId')::uuid is not null then
        update products set quantity = quantity + ((item->>'quantityMilli')::bigint) / 1000.0
        where id = (item->>'productId')::uuid and business_id = bid and deleted_at is null;

        insert into inventory_movements (business_id, product_id, type, quantity, ref_type, ref_id, occurred_at, created_by)
        values (bid, (item->>'productId')::uuid, 'in',
          ((item->>'quantityMilli')::bigint) / 1000.0, 'purchase', pid, occurred, uid);
      end if;
    end loop;
  end if;

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

  perform op_audit(bid, 'create', 'purchase', pid, jsonb_build_object('purchase_number', purchase_no, 'net', net, 'paid', paid, 'remaining', rem,
    'items', coalesce(jsonb_array_length(items), 0)));

  result := jsonb_build_object(
    'doc', jsonb_build_object('id', pid, 'purchaseNumber', purchase_no, 'netAmountMinor', (net*100)::bigint,
      'paidAmountMinor', (paid*100)::bigint, 'remainingAmountMinor', (rem*100)::bigint, 'debtId', debt_id),
    'entryId', entry_id
  );
  return result;
end $$;

-- إلغاء الشراء: يستعيد المخزون من سطور الشراء (إضافة على نسخة 0013)
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

    update products pr set quantity = pr.quantity - pi.quantity
    from purchase_items pi
    where pi.purchase_id = doc_id and pi.product_id = pr.id and pr.business_id = bid;

    insert into inventory_movements (business_id, product_id, type, quantity, ref_type, ref_id, occurred_at, notes, created_by)
    select bid, pi.product_id, 'out', pi.quantity, 'void_purchase', doc_id, now(), 'سحب مخزون عند إلغاء الشراء', uid
    from purchase_items pi
    where pi.purchase_id = doc_id and pi.product_id is not null;

    if doc.debt_id is not null then
      update debts set deleted_at = now() where id = doc.debt_id;
      update suppliers set current_balance = current_balance - doc.remaining_amount where id = doc.supplier_id;
    end if;
    update suppliers set total_transactions = total_transactions - doc.net_amount where id = doc.supplier_id;
    update purchases set status = 'void', voided_at = now(), voided_by = uid, void_reason = reason where id = doc_id;

    perform op_audit(bid, 'void', 'purchase', doc_id, jsonb_build_object('reason', reason, 'restored_stock', true));
    result := jsonb_build_object('voided', doc_id, 'reversalEntryId', rev_entry_id);

  elsif doc_type = 'expense' then
    select * into doc from expenses where id = doc_id and business_id = bid and deleted_at is null;
    if not found then raise exception 'VALIDATION: المصروف غير موجود'; end if;
    if doc.status = 'void' then raise exception 'VALIDATION: المصروف ملغى مسبقاً'; end if;

    select e.* into entry from journal_entries e where e.source_id = doc_id and e.source_type = 'expense' and e.status = 'posted' limit 1;
    insert into journal_entries (business_id, entry_number, occurred_at, description, source_type, source_id, status, reversal_of_entry_id, created_by)
    values (bid, next_doc_number(bid, 'journal'), now(), 'قيد عكسي: إلغاء مصروف ' || doc.title, 'reversal', doc_id, 'posted', entry.id, uid)
    returning id into rev_entry_id;
    insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit, financial_account_id, party_type, party_id)
    select bid, rev_entry_id, l.gl_account_code, l.credit, l.debit, l.financial_account_id, l.party_type, l.party_id
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
