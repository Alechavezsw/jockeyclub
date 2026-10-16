-- Avisos reales: saldo > 0, mail entregable, mensaje aunque no haya mail.
-- Reloj pg_cron cada 10 minutos (token propio, no el service_role).

create table if not exists public.dues_cron_config (
  id int primary key default 1 check (id = 1),
  token text not null
);

alter table public.dues_cron_config enable row level security;
revoke all on table public.dues_cron_config from public, anon, authenticated;
grant select on table public.dues_cron_config to service_role;

insert into public.dues_cron_config (id, token)
values (1, replace(gen_random_uuid()::text, '-', ''))
on conflict (id) do nothing;

create or replace function public.member_dues_notice_email(memail text, contact text)
returns text
language sql
immutable
as $$
  select coalesce(
    case
      when memail ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       and memail !~* '@jockeyclubsj\.com$'
       and memail not ilike '%@lila-jockey%'
      then memail
    end,
    case
      when coalesce(contact, '') ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       and contact !~* '@jockeyclubsj\.com$'
       and contact not ilike '%@lila-jockey%'
      then contact
    end
  );
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
revoke all on function public.member_dues_notice_email(text, text) from public, anon, authenticated;
grant execute on function public.member_dues_notice_email(text, text) to service_role;

do $$
begin
  if to_regclass('cron.job') is null then
    return;
  end if;
  if not exists (select 1 from public.dues_cron_config where id = 1) then
    return;
  end if;
  perform cron.unschedule(j.jobid)
  from cron.job j
  where j.jobname = 'dues-due-notices';
  perform cron.schedule(
    'dues-due-notices',
    '*/10 * * * *',
    $job$
    select net.http_post(
      url := 'https://papdsxgcvyncdxdvbdaa.supabase.co/functions/v1/send-due-notices',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select token from public.dues_cron_config where id = 1)
      ),
      body := '{"scope":"batch"}'::jsonb,
      timeout_milliseconds := 120000
    );
    $job$
  );
end $$;
