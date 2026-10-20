-- No avisar cuota a vitalicio, fundador ni comisión. El link de Mi cuenta es www.

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
        and (date_trunc('month', m.next_due_date)::date + 9) = due_on
      )
      or (
        m.next_due_date is null
        and extract(day from due_on) = 10
      )
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

comment on function public.members_pending_due_notice(date, text, int, uuid) is
  'Candidatos a aviso de cuota. Vitalicio, fundador y comisión no entran.';
