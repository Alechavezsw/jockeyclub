-- Cierres de liquidación hechos en el portal (el corte de Lila sigue en el código).
-- Una fila por período: estado, fecha y total, igual que las liquidaciones ya procesadas.

create table if not exists public.fee_period_closures (
  id text primary key,
  accessin_id integer,
  year integer not null,
  month integer not null check (month between 1 and 12),
  amount numeric not null default 0,
  generated_at date,
  status text not null check (status in ('processed', 'draft', 'pending', 'cancelled')),
  updated_at timestamptz not null default now(),
  unique (year, month)
);

alter table public.fee_period_closures enable row level security;

drop policy if exists fee_period_closures_select on public.fee_period_closures;
create policy fee_period_closures_select
  on public.fee_period_closures for select
  to authenticated
  using (public.has_staff_access());

drop policy if exists fee_period_closures_insert on public.fee_period_closures;
create policy fee_period_closures_insert
  on public.fee_period_closures for insert
  to authenticated
  with check (public.has_staff_access());

drop policy if exists fee_period_closures_update on public.fee_period_closures;
create policy fee_period_closures_update
  on public.fee_period_closures for update
  to authenticated
  using (public.has_staff_access())
  with check (public.has_staff_access());

grant select, insert, update on public.fee_period_closures to authenticated;

drop trigger if exists fee_period_closures_updated_at on public.fee_period_closures;
create trigger fee_period_closures_updated_at
  before update on public.fee_period_closures
  for each row execute function public.set_updated_at();

comment on table public.fee_period_closures is
  'Liquidaciones de cuotas cerradas en el portal. El desglose sigue el pack de Lila del período.';
