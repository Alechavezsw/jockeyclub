-- Entradas manuales de cuenta corriente de proveedores
create table if not exists public.supplier_entries (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  supplier_name text not null default '',
  entry_date date not null default current_date,
  amount numeric(14, 2) not null default 0,
  concept text not null default '',
  invoice_number text,
  notes text,
  status text not null default 'posted',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists supplier_entries_date_idx
  on public.supplier_entries (entry_date desc, created_at desc);

create index if not exists supplier_entries_supplier_idx
  on public.supplier_entries (supplier_id);

alter table public.supplier_entries enable row level security;

drop policy if exists supplier_entries_access on public.supplier_entries;
create policy supplier_entries_access on public.supplier_entries
  for all
  using (public.has_accounting_access())
  with check (public.has_accounting_access());

grant select, insert, update, delete on public.supplier_entries to authenticated;
