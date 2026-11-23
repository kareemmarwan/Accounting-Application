-- 0016: مرتجعات البيع (جزئية أو كاملة)
-- القاعدة الذهبية: الفاتورة المرحّلة لا تُعدَّل — الإرجاع ينشئ قيد دلتا سالباً متوازناً:
-- مدين 4100 بقيمة المرتجع / دائن 1300 الجزء المسدد من دين العميل / دائن الحساب المالي الجزء المُرَدّد نقداً.
-- المخزون يعود للمنتجات، وreturned على sale_items يمنع الإرجاع فوق المبيع.

alter table sale_items
  add column if not exists returned numeric(14,3) not null default 0;

alter table sales
  add column if not exists returned_amount numeric(14,2) not null default 0;

create or replace function apply_sale_return(bid uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  sale_row sales%rowtype;
  return_items jsonb := p->'items';
  ret jsonb;
  return_entry_id uuid;
  return_qty numeric(14,3);
  item_row sale_items%rowtype;
  return_value numeric(14,2) := 0;
  debt_reduce numeric(14,2) := 0;
  refund numeric(14,2);
  acc_id uuid := (p->>'refundAccountId');
  acc record;
  reason text := coalesce(nullif(trim(p->>'reason'),''), 'إرجاع بضاعة');
  cust_id uuid;
  result jsonb;
begin
  perform op_assert_role(bid, array['owner','manager','accountant']::user_role[]);

  select * into sale_row from sales
    where id = (p->>'saleId')::uuid and business_id = bid and deleted_at is null;
  if not found then
    raise exception 'VALIDATION: الفاتورة غير موجودة';
  end if;
  if sale_row.status = 'void' then
    raise exception 'VALIDATION: لا إرجاع على فاتورة ملغاة — استخدم الإلغاء';
  end if;

  if jsonb_typeof(return_items) <> 'array' or jsonb_array_length(return_items) = 0 then
    raise exception 'VALIDATION: حدد أصنافاً للإرجاع';
  end if;

  -- التحقق من الكميات المرجعة قبل أي كتابة
  for ret in select * from jsonb_array_elements(return_items) loop
    select * into item_row from sale_items
      where id = (ret->>'saleItemId')::uuid and sale_id = sale_row.id and business_id = bid;
    if not found then
      raise exception 'VALIDATION: سطر إرجاع غير موجود في الفاتورة';
    end if;
    return_qty := ((ret->>'quantityMilli')::bigint) / 1000.0;
    if return_qty <= 0 then
      raise exception 'VALIDATION: كمية الإرجاع يجب أن تكون أكبر من صفر';
    end if;
    if return_qty > item_row.quantity - item_row.returned then
      raise exception 'VALIDATION: كمية الإرجاع تتجاوز المتبقي من الصنف %', item_row.name;
    end if;
    return_value := return_value + round(return_qty * item_row.unit_price, 2);
  end loop;

  if return_value <= 0 then
    raise exception 'VALIDATION: قيمة الإرجاع يجب أن تكون أكبر من صفر';
  end if;

  -- التوزيع: أولوية تسديد دين العميل ثم المبلغ المُرَدّد نقداً
  if sale_row.debt_id is not null then
    select * into acc from debts
      where id = sale_row.debt_id and business_id = bid and deleted_at is null;
    if found then
      debt_reduce := least(return_value, acc.remaining_amount);
    end if;
  end if;
  refund := return_value - debt_reduce;

  if refund > 0 then
    if acc_id is null then
      raise exception 'VALIDATION: حساب الاسترداد النقدي مطلوب';
    end if;
    select * into acc from financial_accounts
      where id = acc_id and business_id = bid and deleted_at is null;
    if not found then
      raise exception 'VALIDATION: حساب الاسترداد غير موجود';
    end if;
  end if;

  cust_id := sale_row.customer_id;

  insert into journal_entries (business_id, entry_number, occurred_at, description, source_type, source_id, status, created_by)
  values (bid, next_doc_number(bid, 'journal'), now(),
    'مرتجع بيع — ' || sale_row.sale_number || ' — ' || reason,
    'reversal', sale_row.id, 'posted', uid)
  returning id into return_entry_id;

  insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit)
  values (bid, return_entry_id, '4100', return_value, 0);

  if debt_reduce > 0 then
    insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit, party_type, party_id)
    values (bid, return_entry_id, '1300', 0, debt_reduce, 'customer', cust_id);

    update debts set
      amount = amount - debt_reduce,
      remaining_amount = remaining_amount - debt_reduce,
      status = case when remaining_amount - debt_reduce <= 0 then 'settled'
               else case when paid_amount > 0 then 'partial' else 'open' end end
    where id = sale_row.debt_id and business_id = bid;

    if cust_id is not null then
      update customers set current_balance = current_balance - debt_reduce where id = cust_id;
    end if;
  end if;

  if refund > 0 and acc_id is not null then
    insert into journal_entry_lines (business_id, entry_id, gl_account_code, debit, credit, financial_account_id)
    values (bid, return_entry_id, gl_code_for_account(acc.type), 0, refund, acc_id);

    update financial_accounts
      set current_balance = current_balance - refund,
          total_withdrawals = total_withdrawals + refund
    where id = acc_id;
    perform assert_account_balance_ok(acc_id);
  end if;

  -- تثبيت الكميات المرجعة على سطور الفاتورة واستعادة المخزون
  for ret in select * from jsonb_array_elements(return_items) loop
    return_qty := ((ret->>'quantityMilli')::bigint) / 1000.0;
    update sale_items set returned = returned + return_qty
      where id = (ret->>'saleItemId')::uuid and sale_id = sale_row.id and business_id = bid;

    select * into item_row from sale_items
      where id = (ret->>'saleItemId')::uuid and sale_id = sale_row.id and business_id = bid;

    if item_row.product_id is not null then
      update products set quantity = quantity + return_qty
      where id = item_row.product_id and business_id = bid and deleted_at is null;

      insert into inventory_movements (business_id, product_id, type, quantity, ref_type, ref_id, occurred_at, notes, created_by)
      values (bid, item_row.product_id, 'in', return_qty, 'sale_return', sale_row.id, now(), 'مرتجع بيع — ' || reason, uid);
    end if;
  end loop;

  update sales set returned_amount = returned_amount + return_value where id = sale_row.id;

  perform op_audit(bid, 'return', 'sale', sale_row.id, jsonb_build_object(
    'reason', reason, 'returned', return_value, 'refunded', refund, 'debt_reduced', debt_reduce,
    'entry', return_entry_id));

  result := jsonb_build_object(
    'returnMinor', (return_value * 100)::bigint,
    'refundedMinor', (refund * 100)::bigint,
    'debtReducedMinor', (debt_reduce * 100)::bigint,
    'entryId', return_entry_id
  );
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
    when 'sale.return' then
      result := apply_sale_return(bid, op);
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
