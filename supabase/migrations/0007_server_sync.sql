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
