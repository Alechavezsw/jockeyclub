-- Cortes LILA/Societas que la app lee en producción.
-- Cada fila es un snapshot (cuotas, deudas, cuentas corrientes, etc.).

create table if not exists public.club_snapshots (
  name text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.club_snapshots enable row level security;

drop policy if exists club_snapshots_select on public.club_snapshots;
create policy club_snapshots_select
  on public.club_snapshots for select
  to authenticated
  using (public.has_club_snapshot_access());

comment on table public.club_snapshots is
  'Cortes LILA/Societas que la app lee en producción. Cada fila es un snapshot (cuotas, deudas, CC, etc.).';
