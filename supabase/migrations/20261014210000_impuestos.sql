-- Impuestos: plan fiscal, comprobantes y perfil. Los gastos pueden guardar la alícuota.

insert into public.chart_of_accounts (id, code, name, account_type, level, is_postable, is_cash_account, description)
select v.id, v.code, v.name, v.account_type::public.account_type, 3, true, false, v.description
from (values
  ('aaaaaaaa-0001-0001-0001-000000000114'::uuid, '1.1.04', 'IVA Crédito Fiscal', 'asset', 'Crédito fiscal IVA'),
  ('aaaaaaaa-0001-0001-0001-000000000115'::uuid, '1.1.05', 'Percepciones a Favor', 'asset', 'Percepciones y créditos fiscales'),
  ('aaaaaaaa-0001-0001-0001-000000000116'::uuid, '1.1.06', 'Cuentas a Cobrar', 'asset', 'Deudores por ventas'),
  ('aaaaaaaa-0002-0002-0002-000000000114'::uuid, '2.1.04', 'IVA Débito Fiscal', 'liability', 'Débito fiscal IVA'),
  ('aaaaaaaa-0002-0002-0002-000000000115'::uuid, '2.1.05', 'IVA a Pagar', 'liability', 'Saldo de IVA del período'),
  ('aaaaaaaa-0002-0002-0002-000000000116'::uuid, '2.1.06', 'IIBB a Pagar', 'liability', 'Saldo de ingresos brutos'),
  ('aaaaaaaa-0002-0002-0002-000000000117'::uuid, '2.1.07', 'Percepciones a Depositar', 'liability', 'Percepciones cobradas'),
  ('aaaaaaaa-0005-0005-0005-000000000116'::uuid, '5.1.06', 'Impuestos y Tasas', 'expense', 'Impuestos que no son crédito fiscal')
) as v(id, code, name, account_type, description)
where not exists (
  select 1 from public.chart_of_accounts existing where existing.code = v.code
);

update public.chart_of_accounts child
set parent_id = parent.id
from public.chart_of_accounts parent
where child.code in ('1.1.04', '1.1.05', '1.1.06')
  and parent.code = '1.1'
  and child.parent_id is null;

update public.chart_of_accounts child
set parent_id = parent.id
from public.chart_of_accounts parent
where child.code in ('2.1.04', '2.1.05', '2.1.06', '2.1.07')
  and parent.code = '2'
  and child.parent_id is null;

update public.chart_of_accounts child
set parent_id = parent.id
from public.chart_of_accounts parent
where child.code = '5.1.06'
  and parent.code = '5'
  and child.parent_id is null;

alter table public.expenses
  add column if not exists meta jsonb not null default '{}'::jsonb;

create table if not exists public.fiscal_documents (
  id uuid primary key default gen_random_uuid(),
  client_key text not null unique,
  doc_kind text not null,
  status text not null default 'recorded',
  doc_date date,
  period text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fiscal_documents_kind_idx on public.fiscal_documents (doc_kind, doc_date desc);
create index if not exists fiscal_documents_period_idx on public.fiscal_documents (period);

alter table public.fiscal_documents enable row level security;

drop policy if exists fiscal_documents_access on public.fiscal_documents;
create policy fiscal_documents_access on public.fiscal_documents
  for all
  using (public.has_accounting_access())
  with check (public.has_accounting_access());

grant select, insert, update, delete on public.fiscal_documents to authenticated;
