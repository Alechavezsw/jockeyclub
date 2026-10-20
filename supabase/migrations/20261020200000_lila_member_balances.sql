-- Lila cuenta corriente snapshot: per-socio balance breakdown.
-- Stores the detailed Lila saldos export to reconcile with members.outstanding_balance.
-- One row per member, updated on each import.

create table if not exists public.lila_member_balances (
  id uuid primary key default gen_random_uuid(),
  member_number text not null unique,
  lila_row_id text,
  nombre text,
  apellido text,
  dni text,
  cuota_social text,
  cuota_deportiva text,
  capital_no_pagado numeric(14, 2) not null default 0,
  recargos_no_pagados numeric(14, 2) not null default 0,
  intereses_no_pagados numeric(14, 2) not null default 0,
  saldo_no_imputado numeric(14, 2) not null default 0,
  saldo_resultante numeric(14, 2) not null default 0,
  as_of_date date not null,
  imported_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);

create index if not exists lila_member_balances_saldo_idx
  on public.lila_member_balances (saldo_resultante) where saldo_resultante > 0;

create index if not exists lila_member_balances_member_number_idx
  on public.lila_member_balances (member_number);

-- Lila import logs: track each import run
create table if not exists public.lila_import_logs (
  id uuid primary key default gen_random_uuid(),
  import_type text not null, -- 'saldos', 'reservas', 'deudas_mes_a_mes', etc.
  source_file text,
  as_of_date date,
  rows_processed integer not null default 0,
  rows_matched integer not null default 0,
  rows_unmatched integer not null default 0,
  rows_duplicates integer not null default 0,
  total_capital numeric(14, 2),
  total_recargos numeric(14, 2),
  total_intereses numeric(14, 2),
  total_saldo numeric(14, 2),
  lila_total_saldo numeric(14, 2),
  variance numeric(14, 2),
  unmatched_socios jsonb,
  duplicate_socios jsonb,
  status text not null default 'completed',
  error_message text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Add meta fields to members for Lila balance tracking
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'members' and column_name = 'lila_balance_at'
  ) then
    alter table public.members add column lila_balance_at timestamptz;
  end if;
end$$;

-- RLS for lila tables
alter table public.lila_member_balances enable row level security;
alter table public.lila_import_logs enable row level security;

drop policy if exists lila_member_balances_access on public.lila_member_balances;
create policy lila_member_balances_access on public.lila_member_balances
  for all
  using ((select public.has_staff_access()))
  with check ((select public.has_staff_access()));

drop policy if exists lila_import_logs_access on public.lila_import_logs;
create policy lila_import_logs_access on public.lila_import_logs
  for all
  using ((select public.has_staff_access()))
  with check ((select public.has_staff_access()));

grant select, insert, update, delete on public.lila_member_balances to authenticated;
grant select, insert, update, delete on public.lila_import_logs to authenticated;

-- Add unique constraint for idempotent reservation upserts by external_id
-- Only applicable when external_id is not null
create unique index if not exists reservations_external_id_unique_idx
  on public.reservations ((meta->>'externalId'))
  where meta->>'externalId' is not null and meta->>'externalId' <> '';

comment on table public.lila_member_balances is 
  'Lila saldos snapshot: detailed cuenta corriente breakdown per socio, imported from saldos.xlsx';

comment on table public.lila_import_logs is 
  'Audit log for Lila data imports (saldos, reservas, etc.) with totals and reconciliation info';
