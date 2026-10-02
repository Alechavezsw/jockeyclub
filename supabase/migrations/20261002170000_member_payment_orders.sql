-- Órdenes de pago de Lila: cobros de socios (no pagos a proveedores).
-- El borrado es lógico: la fila queda para poder recuperarla.

alter table public.payment_orders
  add column if not exists order_kind text not null default 'supplier',
  add column if not exists lila_number text,
  add column if not exists member_number text,
  add column if not exists responsible text,
  add column if not exists payment_method text,
  add column if not exists ordered_on date,
  add column if not exists deleted_at timestamptz,
  add column if not exists balance_applied boolean not null default false;

alter table public.payment_orders
  drop constraint if exists payment_orders_order_kind_check;
alter table public.payment_orders
  add constraint payment_orders_order_kind_check
  check (order_kind in ('member', 'supplier'));

create unique index if not exists payment_orders_lila_number_key
  on public.payment_orders (lila_number);

create index if not exists payment_orders_member_open_idx
  on public.payment_orders (ordered_on desc, lila_number desc)
  where order_kind = 'member' and deleted_at is null;

create table if not exists public.payment_order_payments (
  id uuid primary key default gen_random_uuid(),
  payment_order_id uuid not null references public.payment_orders (id) on delete cascade,
  lila_payment_id text not null,
  member_number text not null default '',
  member_name text not null default '',
  imputed_amount numeric(14, 2) not null default 0,
  group_account_id text,
  created_at timestamptz not null default now(),
  unique (payment_order_id, lila_payment_id)
);

create table if not exists public.payment_order_lines (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payment_order_payments (id) on delete cascade,
  position integer not null default 0,
  line_type text not null default '',
  debt_label text not null default '',
  concept text not null default '',
  amount numeric(14, 2) not null default 0
);

create index if not exists payment_order_lines_payment_idx
  on public.payment_order_lines (payment_id, position);

alter table public.payment_order_payments enable row level security;
alter table public.payment_order_lines enable row level security;

drop policy if exists payment_order_payments_access on public.payment_order_payments;
create policy payment_order_payments_access on public.payment_order_payments
  for all
  using (public.has_accounting_access())
  with check (public.has_accounting_access());

drop policy if exists payment_order_lines_access on public.payment_order_lines;
create policy payment_order_lines_access on public.payment_order_lines
  for all
  using (public.has_accounting_access())
  with check (public.has_accounting_access());

grant select, insert, update, delete on public.payment_order_payments to authenticated;
grant select, insert, update, delete on public.payment_order_lines to authenticated;
