-- Otros ingresos / cobros manuales
create table if not exists public.other_incomes (
  id uuid primary key default gen_random_uuid(),
  income_date date not null default current_date,
  payer_type text not null default 'manual',
  payer_name text not null default '',
  concept text not null default '',
  income_group text not null default 'uncategorized',
  payment_method text not null default 'efectivo',
  amount numeric(14, 2) not null default 0,
  notes text,
  status text not null default 'posted',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists other_incomes_date_idx
  on public.other_incomes (income_date desc, created_at desc);

alter table public.other_incomes enable row level security;

drop policy if exists other_incomes_access on public.other_incomes;
create policy other_incomes_access on public.other_incomes
  for all
  using (public.has_accounting_access())
  with check (public.has_accounting_access());

grant select, insert, update, delete on public.other_incomes to authenticated;
