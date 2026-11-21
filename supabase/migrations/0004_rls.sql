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
