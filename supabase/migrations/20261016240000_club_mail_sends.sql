create table if not exists public.club_mail_sends (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  email text not null,
  member_number text,
  subject text not null,
  resend_id text,
  email_error text,
  sender_id uuid,
  created_at timestamptz not null default now(),
  unique (campaign_id, email)
);

create index if not exists club_mail_sends_campaign_idx
  on public.club_mail_sends (campaign_id, created_at desc);

alter table public.club_mail_sends enable row level security;

revoke all on table public.club_mail_sends from public, anon;
grant select on table public.club_mail_sends to authenticated;
grant select, insert, update on table public.club_mail_sends to service_role;

drop policy if exists club_mail_sends_staff_read on public.club_mail_sends;
create policy club_mail_sends_staff_read
  on public.club_mail_sends
  for select
  to authenticated
  using ((select public.has_staff_access()));

comment on table public.club_mail_sends is
  'Envíos de comunicados por mail desde Comunicación → Mensajería.';
