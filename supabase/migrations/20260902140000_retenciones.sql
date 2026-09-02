-- Retenciones Accessin (resumen CC proveedores)
create table if not exists public.retenciones (
  id uuid primary key default gen_random_uuid(),
  line_number integer,
  client_name text,
  supplier_name text,
  payment_order_number text,
  payment_order_amount numeric(14, 2) not null default 0,
  retention_type text,
  retention_date date,
  retention_amount numeric(14, 2) not null default 0,
  status text not null default 'recorded',
  notes text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists retenciones_date_idx on public.retenciones (retention_date desc);
create index if not exists retenciones_supplier_idx on public.retenciones (supplier_name);
create index if not exists retenciones_type_idx on public.retenciones (retention_type);

alter table public.retenciones enable row level security;

drop policy if exists retenciones_access on public.retenciones;
create policy retenciones_access on public.retenciones
  for all
  using (public.has_accounting_access())
  with check (public.has_accounting_access());

grant select, insert, update, delete on public.retenciones to authenticated;
