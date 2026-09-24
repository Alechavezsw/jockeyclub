-- Aviso automático el día del vencimiento: campanita (mensaje directo) y mail.
-- Una fila por socio y fecha. resend_id vacío = el mail todavía no salió.

create table if not exists public.dues_notice_sends (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  due_on date not null,
  email text,
  message_id uuid references public.messages (id) on delete set null,
  resend_id text,
  email_error text,
  created_at timestamptz not null default now(),
  unique (member_id, due_on)
);

alter table public.dues_notice_sends enable row level security;

create or replace function public.members_pending_due_notice(
  due_on date,
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
    and coalesce(m.meta->>'notifyDues', 'true') <> 'false'
    and (profile_filter is null or m.profile_id = profile_filter)
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
        and s.resend_id is not null
    )
  limit lim;
$$;

revoke all on function public.members_pending_due_notice(date, int, uuid) from public, anon, authenticated;
grant execute on function public.members_pending_due_notice(date, int, uuid) to service_role;
