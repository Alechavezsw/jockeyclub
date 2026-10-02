-- Cuentas contables de cuotas (Lila) y los movimientos de su cuenta corriente.

create table if not exists public.fee_ledger_accounts (
  id text primary key,
  accessin_id integer unique,
  name text not null,
  description text not null default '',
  fee_categories text[] not null default '{}',
  balance numeric(16, 2) not null default 0,
  detail_account_label text not null default '',
  is_active boolean not null default true,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fee_ledger_lines (
  id text primary key,
  account_id text not null references public.fee_ledger_accounts (id),
  member_number text not null default '',
  member_name text not null default '',
  dni text not null default '',
  line_date date,
  date_label text not null default '',
  collected_at date,
  collected_at_label text not null default '',
  type_label text not null default '',
  description text not null default '',
  amount numeric(16, 2) not null default 0,
  collected numeric(16, 2) not null default 0,
  pending numeric(16, 2) not null default 0,
  source text not null default 'manual',
  created_at timestamptz not null default now()
);

create index if not exists fee_ledger_lines_account_idx
  on public.fee_ledger_lines (account_id, line_date);

alter table public.fee_ledger_accounts enable row level security;
alter table public.fee_ledger_lines enable row level security;

drop policy if exists fee_ledger_accounts_access on public.fee_ledger_accounts;
create policy fee_ledger_accounts_access
  on public.fee_ledger_accounts for all
  to authenticated
  using (
    public.has_accounting_access()
    or public.has_admin_access()
    or public.user_has_role('admin_employee')
  )
  with check (
    public.has_accounting_access()
    or public.has_admin_access()
    or public.user_has_role('admin_employee')
  );

drop policy if exists fee_ledger_lines_access on public.fee_ledger_lines;
create policy fee_ledger_lines_access
  on public.fee_ledger_lines for all
  to authenticated
  using (
    public.has_accounting_access()
    or public.has_admin_access()
    or public.user_has_role('admin_employee')
  )
  with check (
    public.has_accounting_access()
    or public.has_admin_access()
    or public.user_has_role('admin_employee')
  );

grant select, insert, update, delete on public.fee_ledger_accounts to authenticated;
grant select, insert, update, delete on public.fee_ledger_lines to authenticated;

drop trigger if exists fee_ledger_accounts_updated_at on public.fee_ledger_accounts;
create trigger fee_ledger_accounts_updated_at
  before update on public.fee_ledger_accounts
  for each row execute function public.set_updated_at();

insert into public.fee_ledger_accounts (
  id, accessin_id, name, description, fee_categories, balance, detail_account_label, source
) values
  ('fca-31', 31, 'SOCIO FAMILIAR', 'SOCIO FAMILIAR', array['SOCIO FAMILIAR'], 436210358.44, 'SOCIO FAMILIAR', 'lila'),
  ('fca-33', 33, 'SOCIOS INDIVIDUALES', '', array['SOCIO INDIVIDUAL'], 52075510.00, 'SOCIOS INDIVIDUALES', 'lila')
on conflict (id) do nothing;

-- Suma movimientos nuevos (una liquidación) al balance de la cuenta.
create or replace function public.post_fee_ledger_lines(p_lines jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not (
    public.has_accounting_access()
    or public.has_admin_access()
    or public.user_has_role('admin_employee')
  ) then
    raise exception 'Sin permiso para imputar cuentas contables';
  end if;

  with incoming as (
    select
      e->>'id' as id,
      e->>'accountId' as account_id,
      coalesce(e->>'memberNumber', '') as member_number,
      coalesce(e->>'memberName', '') as member_name,
      coalesce(e->>'dni', '') as dni,
      nullif(e->>'date', '')::date as line_date,
      coalesce(e->>'dateLabel', '') as date_label,
      nullif(e->>'collectedAt', '')::date as collected_at,
      coalesce(e->>'collectedAtLabel', '') as collected_at_label,
      coalesce(e->>'type', '') as type_label,
      coalesce(e->>'description', '') as description,
      coalesce((e->>'amount')::numeric, 0) as amount,
      coalesce((e->>'collected')::numeric, 0) as collected,
      coalesce((e->>'pending')::numeric, 0) as pending,
      coalesce(nullif(e->>'source', ''), 'manual') as source
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
    where coalesce(e->>'id', '') <> ''
      and coalesce(e->>'accountId', '') <> ''
  ),
  inserted as (
    insert into public.fee_ledger_lines (
      id, account_id, member_number, member_name, dni,
      line_date, date_label, collected_at, collected_at_label,
      type_label, description, amount, collected, pending, source
    )
    select
      id, account_id, member_number, member_name, dni,
      line_date, date_label, collected_at, collected_at_label,
      type_label, description, amount, collected, pending, source
    from incoming
    on conflict (id) do nothing
    returning account_id, amount
  )
  update public.fee_ledger_accounts a
  set balance = a.balance + d.amount
  from (
    select account_id, sum(amount) as amount
    from inserted
    group by account_id
  ) d
  where a.id = d.account_id
    and d.amount <> 0;
end;
$$;

revoke all on function public.post_fee_ledger_lines(jsonb) from public;
grant execute on function public.post_fee_ledger_lines(jsonb) to authenticated;
