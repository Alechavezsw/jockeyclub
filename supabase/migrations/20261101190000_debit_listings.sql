-- Listados mensuales de débitos (planilla Argencard / Visa / Visa Débito).
-- Fuente: docs/Debitos/Listados de Debitos 2026.xlsx

create table if not exists public.debit_listings (
  id text primary key,
  year integer not null check (year between 2000 and 2100),
  month integer not null check (month between 1 and 12),
  sheet_kind text not null check (sheet_kind in ('credito', 'debito')),
  brand text not null default '',
  section text not null default 'padron'
    check (section in ('padron', 'altas', 'bajas', 'cambios', 'debitos_aplicacion')),
  sort_order integer not null default 0,
  card_number text,
  receipt text,
  due_date date,
  dues_amount numeric not null default 0,
  abono_amount numeric not null default 0,
  total_amount numeric not null default 0,
  member_id text,
  status_code text,
  holder_name text not null default '',
  note text not null default '',
  source_sheet text,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists debit_listings_period_idx
  on public.debit_listings (year, month, sheet_kind, sort_order);

create index if not exists debit_listings_member_idx
  on public.debit_listings (member_id);

alter table public.debit_listings enable row level security;

drop policy if exists debit_listings_select on public.debit_listings;
create policy debit_listings_select
  on public.debit_listings for select
  to authenticated
  using (public.has_staff_access());

drop policy if exists debit_listings_insert on public.debit_listings;
create policy debit_listings_insert
  on public.debit_listings for insert
  to authenticated
  with check (public.has_staff_access());

drop policy if exists debit_listings_update on public.debit_listings;
create policy debit_listings_update
  on public.debit_listings for update
  to authenticated
  using (public.has_staff_access())
  with check (public.has_staff_access());

drop policy if exists debit_listings_delete on public.debit_listings;
create policy debit_listings_delete
  on public.debit_listings for delete
  to authenticated
  using (public.has_staff_access());

grant select, insert, update, delete on public.debit_listings to authenticated;

drop trigger if exists debit_listings_updated_at on public.debit_listings;
create trigger debit_listings_updated_at
  before update on public.debit_listings
  for each row execute function public.set_updated_at();

comment on table public.debit_listings is
  'Listados mensuales de débitos automáticos (planilla club: Argencard/Visa/Visa Débito, altas, bajas y cambios).';
