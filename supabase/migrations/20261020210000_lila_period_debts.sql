-- Lila period-level debt tracking: deudas mes a mes.
-- Stores DEUDA POR MES data: per-period per-socio breakdown (capital, recargos, intereses, deuda acumulada).

create table if not exists public.lila_member_period_debts (
  id uuid primary key default gen_random_uuid(),
  member_number text not null,
  period_key text not null,
  period_label text not null,
  nombre text,
  apellido text,
  dni text,
  cuota_social text,
  categoria_division text,
  capital numeric(14, 2) not null default 0,
  recargos numeric(14, 2) not null default 0,
  intereses numeric(14, 2) not null default 0,
  deuda_acumulada numeric(14, 2) not null default 0,
  as_of_date date not null,
  imported_at timestamptz not null default now(),
  unique (member_number, period_key, as_of_date)
);

create index if not exists lila_member_period_debts_member_idx
  on public.lila_member_period_debts (member_number);

create index if not exists lila_member_period_debts_period_idx
  on public.lila_member_period_debts (period_key);

create index if not exists lila_member_period_debts_deuda_idx
  on public.lila_member_period_debts (deuda_acumulada)
  where deuda_acumulada > 0;

-- Lila movement-level debt detail: DEUDA POR SOCIO.
-- Stores individual movements (Cuota, Recargo de Cuota, etc.) per socio.

create table if not exists public.lila_member_debt_movements (
  id uuid primary key default gen_random_uuid(),
  member_number text not null,
  lila_row_id text,
  nombre text,
  apellido text,
  dni text,
  cuota_social text,
  categoria_division text,
  type_label text not null,
  description text not null default '',
  movement_date date,
  monto numeric(14, 2) not null default 0,
  adeudado numeric(14, 2) not null default 0,
  as_of_date date not null,
  imported_at timestamptz not null default now(),
  unique (member_number, lila_row_id, as_of_date)
);

create index if not exists lila_member_debt_movements_member_idx
  on public.lila_member_debt_movements (member_number);

create index if not exists lila_member_debt_movements_type_idx
  on public.lila_member_debt_movements (type_label);

-- Lila debt totals: TOTALES sheet summary per socio.
-- Stores: periodos adeudados, capital, recargos, intereses, saldo sin imputar, total deuda.

create table if not exists public.lila_member_debt_totals (
  id uuid primary key default gen_random_uuid(),
  member_number text not null,
  lila_row_id text,
  nombre text,
  apellido text,
  dni text,
  cuota_social text,
  categoria_division text,
  periodos_adeudados integer not null default 0,
  capital numeric(14, 2) not null default 0,
  recargos numeric(14, 2) not null default 0,
  intereses numeric(14, 2) not null default 0,
  saldo_sin_imputar numeric(14, 2) not null default 0,
  total_deuda numeric(14, 2) not null default 0,
  as_of_date date not null,
  imported_at timestamptz not null default now(),
  unique (member_number, as_of_date)
);

create index if not exists lila_member_debt_totals_member_idx
  on public.lila_member_debt_totals (member_number);

create index if not exists lila_member_debt_totals_deuda_idx
  on public.lila_member_debt_totals (total_deuda)
  where total_deuda > 0;

-- Lila cuotas lotes (fee batches): monthly liquidación totals.

create table if not exists public.lila_fee_batches (
  id uuid primary key default gen_random_uuid(),
  lila_batch_id integer,
  period_key text not null,
  period_label text not null,
  monto numeric(14, 2) not null default 0,
  fecha_generacion date,
  estado text not null default 'Procesada',
  imported_at timestamptz not null default now(),
  unique (period_key)
);

create index if not exists lila_fee_batches_period_idx
  on public.lila_fee_batches (period_key);

-- Lila October liquidación detail: per-socio breakdown.

create table if not exists public.lila_liquidacion_detail (
  id uuid primary key default gen_random_uuid(),
  member_number text not null,
  nombre text,
  apellido text,
  dni text,
  saldo_anterior numeric(14, 2) not null default 0,
  liquidacion numeric(14, 2) not null default 0,
  otros numeric(14, 2) not null default 0,
  intereses numeric(14, 2) not null default 0,
  sin_recargos numeric(14, 2) not null default 0,
  recargo_1 numeric(14, 2) not null default 0,
  recargo_2 numeric(14, 2) not null default 0,
  period_key text not null,
  as_of_date date not null,
  imported_at timestamptz not null default now(),
  unique (member_number, period_key)
);

create index if not exists lila_liquidacion_detail_member_idx
  on public.lila_liquidacion_detail (member_number);

-- Lila family group balances: per-group per-period capital.

create table if not exists public.lila_family_group_balances (
  id uuid primary key default gen_random_uuid(),
  group_name text not null,
  period_key text not null,
  period_label text not null,
  capital numeric(14, 2) not null default 0,
  is_total boolean not null default false,
  as_of_date date not null,
  imported_at timestamptz not null default now(),
  unique (group_name, period_key, is_total)
);

create index if not exists lila_family_group_balances_group_idx
  on public.lila_family_group_balances (group_name);

-- RLS for all new Lila tables
alter table public.lila_member_period_debts enable row level security;
alter table public.lila_member_debt_movements enable row level security;
alter table public.lila_member_debt_totals enable row level security;
alter table public.lila_fee_batches enable row level security;
alter table public.lila_liquidacion_detail enable row level security;
alter table public.lila_family_group_balances enable row level security;

drop policy if exists lila_member_period_debts_access on public.lila_member_period_debts;
create policy lila_member_period_debts_access on public.lila_member_period_debts
  for all
  using ((select public.has_staff_access()))
  with check ((select public.has_staff_access()));

drop policy if exists lila_member_debt_movements_access on public.lila_member_debt_movements;
create policy lila_member_debt_movements_access on public.lila_member_debt_movements
  for all
  using ((select public.has_staff_access()))
  with check ((select public.has_staff_access()));

drop policy if exists lila_member_debt_totals_access on public.lila_member_debt_totals;
create policy lila_member_debt_totals_access on public.lila_member_debt_totals
  for all
  using ((select public.has_staff_access()))
  with check ((select public.has_staff_access()));

drop policy if exists lila_fee_batches_access on public.lila_fee_batches;
create policy lila_fee_batches_access on public.lila_fee_batches
  for all
  using ((select public.has_staff_access()))
  with check ((select public.has_staff_access()));

drop policy if exists lila_liquidacion_detail_access on public.lila_liquidacion_detail;
create policy lila_liquidacion_detail_access on public.lila_liquidacion_detail
  for all
  using ((select public.has_staff_access()))
  with check ((select public.has_staff_access()));

drop policy if exists lila_family_group_balances_access on public.lila_family_group_balances;
create policy lila_family_group_balances_access on public.lila_family_group_balances
  for all
  using ((select public.has_staff_access()))
  with check ((select public.has_staff_access()));

grant select, insert, update, delete on public.lila_member_period_debts to authenticated;
grant select, insert, update, delete on public.lila_member_debt_movements to authenticated;
grant select, insert, update, delete on public.lila_member_debt_totals to authenticated;
grant select, insert, update, delete on public.lila_fee_batches to authenticated;
grant select, insert, update, delete on public.lila_liquidacion_detail to authenticated;
grant select, insert, update, delete on public.lila_family_group_balances to authenticated;

comment on table public.lila_member_period_debts is
  'Lila DEUDA POR MES: per-period per-socio debt breakdown (capital, recargos, intereses, deuda acumulada)';

comment on table public.lila_member_debt_movements is
  'Lila DEUDA POR SOCIO: movement-level debt detail (Cuota, Recargo de Cuota, etc.)';

comment on table public.lila_member_debt_totals is
  'Lila TOTALES: per-socio debt summary (periodos adeudados, capital, recargos, intereses, total deuda)';

comment on table public.lila_fee_batches is
  'Lila cuotas_lotes: monthly fee liquidación batches with totals';

comment on table public.lila_liquidacion_detail is
  'Lila cta_cte_detalle_cuotas_liquidacion: per-socio October liquidación breakdown';

comment on table public.lila_family_group_balances is
  'Lila saldos_grupo_familiar: per-family-group per-period capital balances';
