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
