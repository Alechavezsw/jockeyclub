-- Ingresos de pileta compartidos (quién entró, canon, caja).
create table if not exists public.pool_accesses (
  id uuid primary key default gen_random_uuid(),
  access_date date not null default current_date,
  kind text not null check (kind in ('member', 'guest')),
  member_id uuid references public.members (id) on delete set null,
  member_number text,
  member_name text,
  guest_name text,
  host_member_number text,
  payment_amount numeric(14, 2) not null default 0 check (payment_amount >= 0),
  payment_method text,
  payment_concept text,
  medical_expires_at date,
  status text not null default 'active' check (status in ('active', 'revoked')),
  source text,
  enabled_by text,
  enabled_at timestamptz not null default now(),
  revoked_at timestamptz,
  journal_entry_id uuid references public.journal_entries (id) on delete set null,
  cash_movement_id uuid references public.cash_movements (id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists pool_accesses_date_idx
  on public.pool_accesses (access_date desc, enabled_at desc);

create index if not exists pool_accesses_member_idx
  on public.pool_accesses (member_number, access_date desc);

alter table public.pool_accesses enable row level security;

drop policy if exists pool_accesses_access on public.pool_accesses;
create policy pool_accesses_access on public.pool_accesses
  for all
  using ((select public.has_staff_access()))
  with check ((select public.has_staff_access()));

grant select, insert, update on public.pool_accesses to authenticated;
