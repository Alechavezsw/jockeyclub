-- Generadores de intereses y las corridas que suman deuda al socio.

create table if not exists public.interest_generators (
  id text primary key,
  identifier text not null,
  dues_description text not null default '',
  period text not null default 'manual',
  separate_entries boolean not null default false,
  percentage numeric(8, 3) not null default 0,
  include_members text[] not null default '{}',
  exclude_members text[] not null default '{}',
  tolerance numeric(14, 2) not null default 0,
  dues_from date,
  dues_to date,
  settlement_date date,
  is_active boolean not null default true,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.interest_runs (
  id text primary key,
  generator_id text not null references public.interest_generators (id),
  generator_label text not null,
  imputation_date date not null,
  status text not null check (status in ('completed', 'draft', 'cancelled')),
  entries_created integer not null default 0,
  total_amount numeric(14, 2) not null default 0,
  percentage numeric(8, 3) not null default 0,
  separate_entries boolean not null default false,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create table if not exists public.interest_run_entries (
  id text primary key,
  run_id text not null references public.interest_runs (id) on delete cascade,
  member_number text not null,
  member_name text not null default '',
  amount numeric(14, 2) not null,
  description text not null default '',
  balance_base numeric(14, 2) not null default 0
);

create index if not exists interest_run_entries_run_idx
  on public.interest_run_entries (run_id);

alter table public.interest_generators enable row level security;
alter table public.interest_runs enable row level security;
alter table public.interest_run_entries enable row level security;

drop policy if exists interest_generators_access on public.interest_generators;
create policy interest_generators_access
  on public.interest_generators for all
  to authenticated
  using (public.has_accounting_access() or public.has_admin_access())
  with check (public.has_accounting_access() or public.has_admin_access());

drop policy if exists interest_runs_access on public.interest_runs;
create policy interest_runs_access
  on public.interest_runs for all
  to authenticated
  using (public.has_accounting_access() or public.has_admin_access())
  with check (public.has_accounting_access() or public.has_admin_access());

drop policy if exists interest_run_entries_access on public.interest_run_entries;
create policy interest_run_entries_access
  on public.interest_run_entries for all
  to authenticated
  using (public.has_accounting_access() or public.has_admin_access())
  with check (public.has_accounting_access() or public.has_admin_access());

grant select, insert, update, delete on public.interest_generators to authenticated;
grant select, insert, update, delete on public.interest_runs to authenticated;
grant select, insert, update, delete on public.interest_run_entries to authenticated;

drop trigger if exists interest_generators_updated_at on public.interest_generators;
create trigger interest_generators_updated_at
  before update on public.interest_generators
  for each row execute function public.set_updated_at();

create or replace function public.save_interest_run(p_run jsonb, p_entries jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id text;
begin
  if not (public.has_accounting_access() or public.has_admin_access()) then
    raise exception 'Sin permiso para generar intereses';
  end if;

  v_id := p_run->>'id';
  if v_id is null or v_id = '' then
    raise exception 'Falta el identificador de la generación';
  end if;

  insert into public.interest_runs (
    id, generator_id, generator_label, imputation_date, status,
    entries_created, total_amount, percentage, separate_entries, created_at
  ) values (
    v_id,
    p_run->>'generatorId',
    coalesce(p_run->>'generatorLabel', ''),
    coalesce((p_run->>'imputationDate')::date, current_date),
    coalesce(p_run->>'status', 'completed'),
    coalesce((p_run->>'entriesCreated')::integer, 0),
    coalesce((p_run->>'totalAmount')::numeric, 0),
    coalesce((p_run->>'percentage')::numeric, 0),
    coalesce((p_run->>'separateEntries')::boolean, false),
    coalesce((p_run->>'createdAt')::timestamptz, now())
  );

  insert into public.interest_run_entries (
    id, run_id, member_number, member_name, amount, description, balance_base
  )
  select
    e->>'id',
    v_id,
    e->>'memberId',
    coalesce(e->>'memberName', ''),
    coalesce((e->>'amount')::numeric, 0),
    coalesce(e->>'description', ''),
    coalesce((e->>'balanceBase')::numeric, 0)
  from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) e
  where coalesce((e->>'amount')::numeric, 0) > 0
    and coalesce(e->>'memberId', '') <> '';

  update public.members m
  set outstanding_balance = coalesce(m.outstanding_balance, 0) + e.amount
  from (
    select member_number, sum(amount) as amount
    from public.interest_run_entries
    where run_id = v_id
    group by member_number
  ) e
  where m.member_number = e.member_number;
end;
$$;

create or replace function public.cancel_interest_run(p_run_id text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  st text;
begin
  if not (public.has_accounting_access() or public.has_admin_access()) then
    raise exception 'Sin permiso para anular intereses';
  end if;

  select status into st
  from public.interest_runs
  where id = p_run_id
  for update;

  if st is null then
    raise exception 'Generación inexistente';
  end if;
  if st <> 'completed' then
    return;
  end if;

  update public.members m
  set outstanding_balance = greatest(0, coalesce(m.outstanding_balance, 0) - e.amount)
  from (
    select member_number, sum(amount) as amount
    from public.interest_run_entries
    where run_id = p_run_id
    group by member_number
  ) e
  where m.member_number = e.member_number;

  update public.interest_runs
  set status = 'cancelled', cancelled_at = now()
  where id = p_run_id;
end;
$$;

revoke all on function public.save_interest_run(jsonb, jsonb) from public;
revoke all on function public.cancel_interest_run(text) from public;
grant execute on function public.save_interest_run(jsonb, jsonb) to authenticated;
grant execute on function public.cancel_interest_run(text) to authenticated;
