-- Persiste mora y saldo de cuota del socio logueado a partir de sus pagos reales.

create or replace function public.sync_own_dues_standing()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  m public.members%rowtype;
  last_paid date;
  monthly numeric;
  first_unpaid date;
  months integer := 0;
  cursor_d date;
  today_d date := (timezone('America/Argentina/Buenos_Aires', now()))::date;
  outstanding numeric;
  due_month date;
begin
  if auth.uid() is null then
    return null;
  end if;

  select * into m
  from public.members
  where profile_id = auth.uid()
  limit 1;

  if not found then
    return null;
  end if;

  select max(p.paid_at) into last_paid
  from public.member_payments p
  where p.member_id = m.id;

  select p.amount into monthly
  from public.member_payments p
  where p.member_id = m.id
    and p.amount > 0
  order by p.paid_at desc
  limit 1;

  if monthly is null or monthly <= 0 then
    monthly := 32000;
  end if;

  if last_paid is not null then
    due_month := (date_trunc('month', last_paid) + interval '1 month')::date;
    first_unpaid := make_date(extract(year from due_month)::int, extract(month from due_month)::int, 10);
  elsif m.next_due_date is not null then
    first_unpaid := make_date(
      extract(year from m.next_due_date)::int,
      extract(month from m.next_due_date)::int,
      10
    );
  elsif extract(day from today_d) <= 10 then
    first_unpaid := make_date(extract(year from today_d)::int, extract(month from today_d)::int, 10);
  else
    due_month := (date_trunc('month', today_d) + interval '1 month')::date;
    first_unpaid := make_date(extract(year from due_month)::int, extract(month from due_month)::int, 10);
  end if;

  cursor_d := first_unpaid;
  while cursor_d < today_d loop
    months := months + 1;
    due_month := (date_trunc('month', cursor_d) + interval '1 month')::date;
    cursor_d := make_date(extract(year from due_month)::int, extract(month from due_month)::int, 10);
    exit when months > 120;
  end loop;

  outstanding := case when months > 0 then months * monthly else 0 end;

  update public.members
  set
    outstanding_balance = outstanding,
    next_due_date = first_unpaid,
    overdue_since = case when months > 0 then first_unpaid else null end,
    meta = coalesce(meta, '{}'::jsonb)
      || case
           when last_paid is not null
             then jsonb_build_object('lastPaymentDate', to_char(last_paid, 'YYYY-MM-DD'))
           else '{}'::jsonb
         end,
    updated_at = now()
  where id = m.id;

  return jsonb_build_object(
    'outstanding', outstanding,
    'monthsBehind', months,
    'nextDue', first_unpaid,
    'overdueSince', case when months > 0 then first_unpaid else null end,
    'lastPaymentDate', last_paid,
    'monthly', monthly
  );
end;
$$;

revoke all on function public.sync_own_dues_standing() from public;
grant execute on function public.sync_own_dues_standing() to authenticated;

comment on function public.sync_own_dues_standing() is
  'Recalcula y guarda saldo / mora del socio autenticado desde member_payments.';
