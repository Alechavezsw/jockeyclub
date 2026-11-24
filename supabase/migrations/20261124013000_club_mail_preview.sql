-- Revisión de un comunicado y el resultado que Resend aceptó.
-- No se aplica en producción con este PR.
-- accepted_count es la aceptación del proveedor, no la entrega en la bandeja.

create table if not exists public.club_mail_previews (
  id uuid primary key default gen_random_uuid(),
  audience text not null,
  member_number text,
  subject text not null,
  body_sha256 text not null,
  audience_sha256 text not null,
  counts jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  campaign_id uuid,
  constraint club_mail_previews_audience_chk check (audience in ('all', 'one'))
);

create table if not exists public.club_mail_campaigns (
  id uuid primary key,
  preview_id uuid not null unique references public.club_mail_previews (id),
  subject text not null,
  audience_sha256 text not null,
  confirmed_count integer not null,
  accepted_count integer not null default 0,
  error_count integer not null default 0,
  attempt_count integer not null default 0,
  sender_id uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'sending',
  constraint club_mail_campaigns_status_chk check (status in ('sending', 'accepted', 'partial', 'failed'))
);

comment on column public.club_mail_campaigns.accepted_count is
  'Lotes que Resend aceptó. No confirma que el correo haya llegado.';

alter table public.club_mail_previews enable row level security;
alter table public.club_mail_campaigns enable row level security;

revoke all on table public.club_mail_previews from public, anon;
revoke all on table public.club_mail_campaigns from public, anon;
grant select on table public.club_mail_previews to authenticated;
grant select on table public.club_mail_campaigns to authenticated;
grant select, insert, update on table public.club_mail_previews to service_role;
grant select, insert, update on table public.club_mail_campaigns to service_role;

drop policy if exists club_mail_previews_staff_read on public.club_mail_previews;
create policy club_mail_previews_staff_read
  on public.club_mail_previews
  for select
  to authenticated
  using ((select public.has_staff_access()));

drop policy if exists club_mail_campaigns_staff_read on public.club_mail_campaigns;
create policy club_mail_campaigns_staff_read
  on public.club_mail_campaigns
  for select
  to authenticated
  using ((select public.has_staff_access()));
