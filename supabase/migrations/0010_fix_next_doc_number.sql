-- 0010: إصلاح تعارض الأسماء في دالة الترقيم
-- المشكلة: المُعامل doc_type يحمل اسم عمود business_sequences.doc_type
-- فيرفع Postgres خطأ 42702 «column reference doc_type is ambiguous»
-- عند إنشاء القيد الافتتاحي (رصيد افتتاحي > 0)، فتفشل العملية كلها.
-- الحل: إعادة تسمية المعاملات إلى p_doc_type/p_at — الاستدعاءات موضعية
-- فلا تأثر على أي مستدعي، وcreate or replace يستبدل النسخة القديمة المطبقة.

-- الملف مرفوع للمستودع — نفّذه من SQL Editor في لوحة Supabase.

drop function if exists next_doc_number(uuid, text, timestamptz);

create or replace function next_doc_number(bid uuid, p_doc_type text, p_at timestamptz default now())
returns text
language plpgsql security definer set search_path = public as $$
declare
  prefix text;
  y int;
  n int;
begin
  if p_doc_type = 'sale' then prefix := 'S';
  elsif p_doc_type = 'purchase' then prefix := 'P';
  elsif p_doc_type = 'journal' then prefix := 'JE';
  else raise exception 'نوع مستند غير مدعوم: %', p_doc_type;
  end if;
  y := extract(year from p_at)::int;
  insert into business_sequences (business_id, doc_type, prefix, last_number, year)
  values (bid, p_doc_type, prefix, 1, y)
  on conflict (business_id, doc_type, year)
  do update set last_number = business_sequences.last_number + 1
  returning last_number into n;
  return prefix || '-' || y || '-' || lpad(n::text, 4, '0');
end $$;
