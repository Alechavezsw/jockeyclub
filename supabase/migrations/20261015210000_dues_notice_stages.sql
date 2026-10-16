-- Tres avisos reales por ciclo de cuota: 5 días antes, el 10 y el 15.

alter table public.dues_notice_sends
  add column if not exists stage text not null default 'due';

update public.dues_notice_sends
set stage = 'due'
where stage is null or stage = '';

alter table public.dues_notice_sends
  drop constraint if exists dues_notice_sends_member_id_due_on_key;

drop index if exists dues_notice_sends_member_id_due_on_key;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dues_notice_sends_stage_check'
      and conrelid = 'public.dues_notice_sends'::regclass
  ) then
    alter table public.dues_notice_sends
      add constraint dues_notice_sends_stage_check
      check (stage in ('upcoming', 'due', 'mora'));
  end if;
end $$;

create unique index if not exists dues_notice_sends_member_due_stage
  on public.dues_notice_sends (member_id, due_on, stage);

drop function if exists public.members_pending_due_notice(date, int, uuid);

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
  select m.id, m.member_number, m.full_name, m.email
  from public.members m
  where m.status = 'active'
    and m.email is not null
    and position('@' in m.email) > 1
    and m.email not ilike '%@lila-jockey%'
    and coalesce(m.meta->>'notifyDues', 'true') <> 'false'
    and coalesce(m.tier, '') not ilike '%vitalicio%'
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

revoke all on function public.members_pending_due_notice(date, text, int, uuid) from public, anon, authenticated;
grant execute on function public.members_pending_due_notice(date, text, int, uuid) to service_role;
