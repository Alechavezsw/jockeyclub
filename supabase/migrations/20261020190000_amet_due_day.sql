-- AMET vence el 18. El resto, el 10. El 2,5 % es tarifa, no mora.

create or replace function public.member_is_amet_dues(m public.members)
returns boolean
language sql
stable
as $$
  select
    coalesce(m.tier::text, '') ~* '(socio_familiar_amet|socio_individual_amet)'
    or coalesce(m.meta::text, '') ~* '(socio_familiar_amet|socio_individual_amet|socio familiar \(amet\)|socio individual \(amet\))';
$$;

create or replace function public.members_pending_due_notice(
  due_on date,
  stage text,
  lim int default 80,
  profile_filter uuid default null
)
returns table (
  id uuid,
  member_number text,
  full_name text,
  email text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id,
    m.member_number,
    m.full_name,
    public.member_dues_notice_email(m.email, m.meta->>'contactEmail') as email
  from public.members m
  where m.status = 'active'
    and coalesce(m.outstanding_balance, 0) > 0
    and coalesce(m.meta->>'notifyDues', 'true') <> 'false'
    and not public.member_is_dues_exempt(m)
    and (profile_filter is null or m.profile_id = profile_filter)
    and stage in ('upcoming', 'due', 'mora')
    and (
      (
        m.next_due_date is not null
        and make_date(
          extract(year from m.next_due_date)::int,
          extract(month from m.next_due_date)::int,
          extract(day from due_on)::int
        ) = due_on
      )
      or (
        m.next_due_date is null
        and extract(day from due_on) in (10, 18)
      )
    )
    and (
      (extract(day from due_on) = 18 and public.member_is_amet_dues(m))
      or (extract(day from due_on) <> 18 and not public.member_is_amet_dues(m))
    )
    and not exists (
      select 1
      from public.dues_notice_sends s
      where s.member_id = m.id
        and s.due_on = due_on
        and s.stage = members_pending_due_notice.stage
        and s.resend_id is not null
    )
  limit lim;
$$;

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
  due_day int := 10;
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
    update public.members
    set
      outstanding_balance = 0,
      overdue_since = null,
      updated_at = now()
    where id = m.id;

    return jsonb_build_object(
      'outstanding', 0,
      'monthsBehind', 0,
      'nextDue', null,
      'overdueSince', null,
      'lastPaymentDate', m.meta->>'lastPaymentDate',
      'monthly', 0
    );
  end if;

  if public.member_is_amet_dues(m) then
    due_day := 18;
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
    first_unpaid := make_date(extract(year from due_month)::int, extract(month from due_month)::int, due_day);
  elsif m.next_due_date is not null then
    first_unpaid := make_date(
      extract(year from m.next_due_date)::int,
      extract(month from m.next_due_date)::int,
      due_day
    );
  elsif extract(day from today_d) <= due_day then
    first_unpaid := make_date(extract(year from today_d)::int, extract(month from today_d)::int, due_day);
  else
    due_month := (date_trunc('month', today_d) + interval '1 month')::date;
    first_unpaid := make_date(extract(year from due_month)::int, extract(month from due_month)::int, due_day);
  end if;

  cursor_d := first_unpaid;
  while cursor_d < today_d loop
    months := months + 1;
    due_month := (date_trunc('month', cursor_d) + interval '1 month')::date;
    cursor_d := make_date(extract(year from due_month)::int, extract(month from due_month)::int, due_day);
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

comment on function public.member_is_amet_dues(public.members) is
  'SOCIO FAMILIAR (AMET) y SOCIO INDIVIDUAL (AMET): vencen el 18.';
comment on function public.members_pending_due_notice(date, text, int, uuid) is
  'Candidatos a aviso de cuota. AMET entra el 18; el resto, el 10.';
