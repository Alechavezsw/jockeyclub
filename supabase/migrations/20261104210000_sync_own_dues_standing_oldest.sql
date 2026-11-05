-- Mi cuenta: cuota más vieja impaga, meses atrasados y recargo por mes vencido.
-- No inventa el saldo (queda el de members). Usa club_today() (AR), no UTC.

create or replace function public.sync_own_dues_standing()
returns jsonb
language plpgsql
security definer
set search_path = public
set timezone to 'America/Argentina/Buenos_Aires'
as $$
declare
  m public.members%rowtype;
  today_d date := public.club_today();
  due_day int := 10;
  first_unpaid date;
  months int := 0;
  surcharge numeric := 0;
  outstanding numeric := 0;
  last_paid date;
  cursor_d date;
  due_month date;
  cand date;
  is_amet boolean := false;
  from_periods boolean := false;
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

  if public.member_is_dues_exempt(m) then
    return jsonb_build_object(
      'outstanding', 0,
      'monthsBehind', 0,
      'nextDue', null,
      'overdueSince', null,
      'lastPaymentDate', m.meta->>'lastPaymentDate',
      'monthly', 0,
      'surcharge', 0,
      'payable', 0,
      'dueDay', due_day
    );
  end if;

  is_amet := public.member_is_amet_dues(m);
  if is_amet then
    due_day := 18;
  end if;

  outstanding := coalesce(m.outstanding_balance, 0);

  -- Cuota más vieja abierta en la base (fuente de verdad).
  select min(p.due_on)
    into first_unpaid
  from public.member_dues_periods p
  where p.member_id = m.id
    and p.capital_open > 0
    and p.due_on > date '1900-01-10';

  if first_unpaid is not null then
    from_periods := true;
    select count(*)::int
      into months
    from public.member_dues_periods p
    where p.member_id = m.id
      and p.capital_open > 0
      and p.due_on > date '1900-01-10'
      and p.due_on < today_d;

    if not is_amet then
      select coalesce(sum(round(p.late_base * 0.10, 2)), 0)
        into surcharge
      from public.member_dues_periods p
      where p.member_id = m.id
        and p.capital_open > 0
        and p.due_on > date '1900-01-10'
        and p.due_on < today_d;
    end if;
  end if;

  select max(p.paid_at)::date into last_paid
  from public.member_payments p
  where p.member_id = m.id
    and coalesce(p.meta->>'status', '') <> 'void';

  -- Sin períodos: anclar a la fecha más vieja entre último cobro, overdue_since y next_due.
  if not from_periods then
    first_unpaid := null;

    if last_paid is not null then
      due_month := (date_trunc('month', last_paid) + interval '1 month')::date;
      first_unpaid := make_date(
        extract(year from due_month)::int,
        extract(month from due_month)::int,
        due_day
      );
    end if;

    if m.overdue_since is not null then
      cand := make_date(
        extract(year from m.overdue_since)::int,
        extract(month from m.overdue_since)::int,
        due_day
      );
      if first_unpaid is null or cand < first_unpaid then
        first_unpaid := cand;
      end if;
    end if;

    if m.next_due_date is not null then
      cand := make_date(
        extract(year from m.next_due_date)::int,
        extract(month from m.next_due_date)::int,
        due_day
      );
      if first_unpaid is null or cand < first_unpaid then
        first_unpaid := cand;
      end if;
    end if;

    if first_unpaid is null then
      if extract(day from today_d) <= due_day then
        first_unpaid := make_date(
          extract(year from today_d)::int,
          extract(month from today_d)::int,
          due_day
        );
      else
        due_month := (date_trunc('month', today_d) + interval '1 month')::date;
        first_unpaid := make_date(
          extract(year from due_month)::int,
          extract(month from due_month)::int,
          due_day
        );
      end if;
    end if;

    months := 0;
    if first_unpaid is not null then
      cursor_d := first_unpaid;
      while cursor_d < today_d loop
        months := months + 1;
        due_month := (date_trunc('month', cursor_d) + interval '1 month')::date;
        cursor_d := make_date(
          extract(year from due_month)::int,
          extract(month from due_month)::int,
          due_day
        );
        exit when months > 120;
      end loop;
    end if;

    if not is_amet and months > 0 and outstanding > 0 then
      -- 10 % de cada mes vencido ≈ 10 % del capital cuando las cuotas son iguales.
      surcharge := round(outstanding * 0.10, 2);
    end if;
  elsif outstanding > 0 and first_unpaid >= today_d and months = 0 then
    -- Solo período del mes corriente, pero el saldo sugiere deuda vieja.
    if last_paid is not null then
      due_month := (date_trunc('month', last_paid) + interval '1 month')::date;
      cand := make_date(
        extract(year from due_month)::int,
        extract(month from due_month)::int,
        due_day
      );
      if cand < first_unpaid then
        first_unpaid := cand;
      end if;
    elsif m.overdue_since is not null then
      cand := make_date(
        extract(year from m.overdue_since)::int,
        extract(month from m.overdue_since)::int,
        due_day
      );
      if cand < first_unpaid then
        first_unpaid := cand;
      end if;
    end if;
    if first_unpaid < today_d then
      months := 0;
      cursor_d := first_unpaid;
      while cursor_d < today_d loop
        months := months + 1;
        due_month := (date_trunc('month', cursor_d) + interval '1 month')::date;
        cursor_d := make_date(
          extract(year from due_month)::int,
          extract(month from due_month)::int,
          due_day
        );
        exit when months > 120;
      end loop;
      if not is_amet and months > 0 and surcharge = 0 and outstanding > 0 then
        surcharge := round(outstanding * 0.10, 2);
      end if;
    end if;
  end if;

  update public.members
  set
    next_due_date = coalesce(first_unpaid, next_due_date),
    overdue_since = case when months > 0 then first_unpaid else null end,
    updated_at = now()
  where id = m.id
    and (
      next_due_date is distinct from coalesce(first_unpaid, next_due_date)
      or overdue_since is distinct from (case when months > 0 then first_unpaid else null end)
    );

  return jsonb_build_object(
    'outstanding', outstanding,
    'monthsBehind', months,
    'nextDue', first_unpaid,
    'overdueSince', case when months > 0 then first_unpaid else null end,
    'lastPaymentDate', coalesce(m.meta->>'lastPaymentDate', last_paid::text),
    'monthly', 0,
    'surcharge', coalesce(surcharge, 0),
    'payable', round(outstanding + coalesce(surcharge, 0), 2),
    'dueDay', due_day
  );
end;
$$;

revoke all on function public.sync_own_dues_standing() from public, anon;
grant execute on function public.sync_own_dues_standing() to authenticated;

comment on function public.sync_own_dues_standing() is
  'Estado de cuota del socio: cuota más vieja impaga, meses atrasados y recargo. No inventa el saldo.';
