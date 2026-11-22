-- 0011: تقوية حارس توازن القيود
-- المشكلة: التريغر المؤجَّل (deferrable) يُنفَّذ لحظة COMMIT خارج سياق دالة
-- setup_new_business security definer، أي بصلاحيات المستخدم المتصل — فيتعثر
-- على RLS/منح الجدول برسالة 42501 رغم أن الفحص مشروع.
-- الحل: جعل دالة الحارس security definer مع تثبيت search_path — تعمل دائماً
-- بملكها (postgres) وتقرأ سطور القيد بغضّ النظر عن سياق الإطلاق.

drop trigger if exists journal_lines_balance_guard on journal_entry_lines;
drop function if exists assert_balanced_entry();
drop function if exists assert_balanced_entry_row();

create or replace function assert_balanced_entry_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  total_debit numeric(14,2);
  total_credit numeric(14,2);
  bad_lines int;
begin
  if new.debit < 0 or new.credit < 0
    or (new.debit > 0 and new.credit > 0)
    or (new.debit = 0 and new.credit = 0) then
    raise exception 'سطر قيد فاسد: مدين=% دائن=%', new.debit, new.credit;
  end if;

  select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into total_debit, total_credit
    from journal_entry_lines
    where entry_id = new.entry_id;

  if total_debit <> total_credit then
    raise exception 'قيد غير متوازن: مدين=% دائن=% (entry=%)', total_debit, total_credit, new.entry_id;
  end if;
  if total_debit = 0 then
    raise exception 'قيد بقيمة صفر (entry=%)', new.entry_id;
  end if;

  select count(*) into bad_lines
    from journal_entry_lines
    where entry_id = new.entry_id
      and ((debit > 0 and credit > 0) or (debit = 0 and credit = 0) or debit < 0 or credit < 0);
  if bad_lines > 0 then
    raise exception 'سطور قيد فاسدة (entry=%)', new.entry_id;
  end if;

  return null;
end $$;

create constraint trigger journal_lines_balance_guard
after insert on journal_entry_lines
deferrable initially deferred
for each row execute function assert_balanced_entry_row();

drop trigger if exists journal_line_shape_guard on journal_entry_lines;
drop function if exists assert_line_shape();

create or replace function assert_line_shape()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.debit < 0 or new.credit < 0
    or (new.debit > 0 and new.credit > 0)
    or (new.debit = 0 and new.credit = 0) then
    raise exception 'سطر قيد فاسد: مدين=% دائن=%', new.debit, new.credit;
  end if;
  return new;
end $$;

create trigger journal_line_shape_guard
before insert on journal_entry_lines
for each row execute function assert_line_shape();
