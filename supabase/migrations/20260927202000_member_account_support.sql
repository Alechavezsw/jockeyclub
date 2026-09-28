-- Resumen de soporte de Lila: pendiente de cada entrada y el pago que la imputa.
create table if not exists public.member_support_accounts (
  titular_number text primary key,
  opening_on date,
  opening_balance numeric(14, 2) not null default 0,
  closing_on date,
  closing_balance numeric(14, 2) not null default 0,
  month_balances jsonb not null default '[]'::jsonb,
  loaded_at timestamptz not null default now()
);

create table if not exists public.member_support_lines (
  id uuid primary key default gen_random_uuid(),
  titular_number text not null references public.member_support_accounts (titular_number) on delete cascade,
  lila_line_id text not null,
  line_date date not null,
  type_label text not null,
  description text not null default '',
  pending_amount numeric(14, 2) not null default 0,
  amount numeric(14, 2) not null,
  links jsonb not null default '[]'::jsonb,
  unique (titular_number, lila_line_id)
);

create index if not exists member_support_lines_member_date_idx
  on public.member_support_lines (titular_number, line_date, lila_line_id);

alter table public.member_support_accounts enable row level security;
alter table public.member_support_lines enable row level security;

drop policy if exists member_support_accounts_access on public.member_support_accounts;
create policy member_support_accounts_access on public.member_support_accounts
  for all
  using ((select public.has_staff_access()))
  with check ((select public.has_staff_access()));

drop policy if exists member_support_lines_access on public.member_support_lines;
create policy member_support_lines_access on public.member_support_lines
  for all
  using ((select public.has_staff_access()))
  with check ((select public.has_staff_access()));

grant select, insert, update, delete on public.member_support_accounts to authenticated;
grant select, insert, update, delete on public.member_support_lines to authenticated;
