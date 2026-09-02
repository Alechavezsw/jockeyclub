-- Historial de importaciones de pagos a proveedores
create table if not exists public.supplier_payment_imports (
  id uuid primary key default gen_random_uuid(),
  imported_at timestamptz not null default now(),
  module text not null default 'excel_manual',
  status text not null default 'completed',
  imported_count integer not null default 0,
  total_amount numeric(14, 2) not null default 0,
  file_name text,
  error_count integer not null default 0,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists supplier_payment_imports_date_idx
  on public.supplier_payment_imports (imported_at desc);

alter table public.supplier_payment_imports enable row level security;

drop policy if exists supplier_payment_imports_access on public.supplier_payment_imports;
create policy supplier_payment_imports_access on public.supplier_payment_imports
  for all
  using (public.has_accounting_access())
  with check (public.has_accounting_access());

grant select, insert, update, delete on public.supplier_payment_imports to authenticated;
