-- 0008: إصلاح حارس توازن القيود
-- المشكلة: التريغر القديم على مستوى الجملة (FOR EACH STATEMENT) يفحص التوازن بعد كل
-- عبارة إدراج منفصلة، ودوال RPC تدرج سطور القيد في عبارات متعاقبة (مدين ثم دائن)
-- فيفشل الفحص الوسيط «مدين=100 دائن=0» رغم أن القيد النهائي متوازن.
-- الحل: Constraint Trigger مؤجّل (DEFERRABLE INITIALLY DEFERRED) على مستوى الصف
-- يُنفّذ عند نهاية المعاملة بعد اكتمال كل السطور.

drop trigger if exists journal_lines_balance_guard on journal_entry_lines;
drop function if exists assert_balanced_entry();

create or replace function assert_balanced_entry_row()
returns trigger
language plpgsql as $$
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

-- تحقق فوري إضافي (غير مؤجل) على صحة السطر نفسه فقط، بلا فحص مجموع
create or replace function assert_line_shape()
returns trigger
language plpgsql as $$
begin
  if new.debit < 0 or new.credit < 0
    or (new.debit > 0 and new.credit > 0)
    or (new.debit = 0 and new.credit = 0) then
    raise exception 'سطر قيد فاسد: مدين=% دائن=%', new.debit, new.credit;
  end if;
  return new;
end $$;

drop trigger if exists journal_line_shape_guard on journal_entry_lines;
create trigger journal_line_shape_guard
before insert on journal_entry_lines
for each row execute function assert_line_shape();
