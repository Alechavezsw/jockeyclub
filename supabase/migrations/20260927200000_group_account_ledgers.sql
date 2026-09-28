-- Extracto de la cuenta familiar de Lila (summary_group_pack):
-- saldo inicial, movimientos y saldo final. Una fila por grupo.
create table if not exists public.group_accounts (
  id uuid primary key default gen_random_uuid(),
  lila_group_id text not null unique,
  titular_number text not null,
  opening_on date,
  opening_balance numeric(14, 2) not null default 0,
  closing_on date,
  closing_balance numeric(14, 2) not null default 0,
  loaded_at timestamptz not null default now()
);

create index if not exists group_accounts_titular_idx
  on public.group_accounts (titular_number);

create table if not exists public.group_account_lines (
  id uuid primary key default gen_random_uuid(),
  group_account_id uuid not null references public.group_accounts (id) on delete cascade,
  lila_line_id text not null,
  member_number text not null,
  member_name text not null default '',
  line_date date not null,
  type_label text not null,
  description text not null default '',
  amount numeric(14, 2) not null,
  unique (group_account_id, lila_line_id)
);

create index if not exists group_account_lines_account_date_idx
  on public.group_account_lines (group_account_id, line_date, lila_line_id);

alter table public.group_accounts enable row level security;
alter table public.group_account_lines enable row level security;

drop policy if exists group_accounts_access on public.group_accounts;
create policy group_accounts_access on public.group_accounts
  for all
  using ((select public.has_staff_access()))
  with check ((select public.has_staff_access()));

drop policy if exists group_account_lines_access on public.group_account_lines;
create policy group_account_lines_access on public.group_account_lines
  for all
  using ((select public.has_staff_access()))
  with check ((select public.has_staff_access()));

grant select, insert, update, delete on public.group_accounts to authenticated;
grant select, insert, update, delete on public.group_account_lines to authenticated;
