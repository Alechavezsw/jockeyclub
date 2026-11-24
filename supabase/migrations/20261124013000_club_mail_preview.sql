-- Revisión de un comunicado y el resultado que Resend aceptó.
-- accepted_count es la aceptación del proveedor, no la entrega en la bandeja.
-- No toca pagos, cuotas, saldos, asientos ni ajustes.

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
  constraint club_mail_campaigns_status_chk check (status in ('sending', 'accepted', 'partial', 'failed', 'uncertain'))
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

-- Reserva el correo antes de llamar a Resend. La segunda transacción no recibe la fila.
create or replace function public.claim_club_mail_batch(
  p_campaign_id uuid,
  p_subject text,
  p_sender uuid,
  p_rows jsonb
) returns table (email text, member_number text)
language sql
security definer
set search_path = public
as $$
  insert into public.club_mail_sends (
    campaign_id, email, member_number, subject, resend_id, email_error, sender_id
  )
  select
    p_campaign_id,
    lower(item->>'email'),
    nullif(item->>'memberNumber', ''),
    p_subject,
    null,
    'reservado',
    p_sender
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) item
  where coalesce(item->>'email', '') <> ''
  on conflict (campaign_id, email) do nothing
  returning club_mail_sends.email, club_mail_sends.member_number;
$$;

create or replace function public.record_club_mail_progress(
  p_campaign_id uuid,
  p_accepted integer,
  p_failed integer,
  p_more boolean
) returns void
language sql
security definer
set search_path = public
as $$
  update public.club_mail_campaigns
  set accepted_count = accepted_count + greatest(p_accepted, 0),
      error_count = error_count + greatest(p_failed, 0),
      attempt_count = attempt_count + 1,
      status = case
        when status = 'uncertain' then status
        when p_more then 'sending'
        when (error_count + greatest(p_failed, 0)) > 0
          and (accepted_count + greatest(p_accepted, 0)) > 0 then 'partial'
        when (error_count + greatest(p_failed, 0)) > 0 then 'failed'
        else 'accepted'
      end,
      finished_at = case
        when status = 'uncertain' or p_more then finished_at
        else now()
      end
  where id = p_campaign_id;
$$;

revoke all on function public.claim_club_mail_batch(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.record_club_mail_progress(uuid, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.claim_club_mail_batch(uuid, text, uuid, jsonb) to service_role;
grant execute on function public.record_club_mail_progress(uuid, integer, integer, boolean) to service_role;
