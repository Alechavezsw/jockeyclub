-- Historial trazable de altas/bajas de débito-crédito automático.
create table if not exists public.debit_move_events (
  id uuid primary key default gen_random_uuid(),
  year integer not null check (year between 2000 and 2100),
  month integer not null check (month between 1 and 12),
  move_type text not null check (move_type in ('alta', 'baja')),
  card_kind text not null default 'credito' check (card_kind in ('credito', 'debito')),
  brand text not null default '',
  member_id text,
  member_db_id uuid references public.members(id) on delete set null,
  holder_name text not null default '',
  card_number text,
  receipt text,
  due_date date,
  dues_amount numeric not null default 0,
  abono_amount numeric not null default 0,
  total_amount numeric not null default 0,
  status_code text,
  note text not null default '',
  listing_id text references public.debit_listings(id) on delete set null,
  actor_id uuid,
  actor_name text,
  actor_email text,
  created_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create index if not exists debit_move_events_period_idx
  on public.debit_move_events (year, month, created_at desc);

create index if not exists debit_move_events_member_idx
  on public.debit_move_events (member_id);

alter table public.debit_move_events enable row level security;

drop policy if exists debit_move_events_select on public.debit_move_events;
create policy debit_move_events_select
  on public.debit_move_events for select
  to authenticated
  using (public.has_staff_access());

drop policy if exists debit_move_events_insert on public.debit_move_events;
create policy debit_move_events_insert
  on public.debit_move_events for insert
  to authenticated
  with check (public.has_staff_access());

drop policy if exists debit_move_events_update on public.debit_move_events;
create policy debit_move_events_update
  on public.debit_move_events for update
  to authenticated
  using (public.has_staff_access())
  with check (public.has_staff_access());

grant select, insert, update on public.debit_move_events to authenticated;

comment on table public.debit_move_events is
  'Historial de altas/bajas de débito-crédito automático (quién, cuándo, datos de planilla).';
