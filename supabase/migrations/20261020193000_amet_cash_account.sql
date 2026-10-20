-- Caja AMET: tesorería la mira junto a efectivo, Nación y Mercado Pago.
insert into public.chart_of_accounts (
  id, code, name, account_type, level, is_postable, is_cash_account, description, parent_id
)
select
  'aaaaaaaa-0001-0001-0001-000000000117',
  '1.1.07',
  'AMET',
  'asset',
  3,
  true,
  true,
  'Caja AMET',
  'aaaaaaaa-0001-0001-0001-000000000011'
where not exists (
  select 1 from public.chart_of_accounts where code = '1.1.07' or name = 'AMET'
);

insert into public.cash_registers (id, code, name, location, account_id)
select
  'bbbbbbbb-0001-0001-0001-000000000007',
  'CAJA-AMET',
  'AMET',
  'Tesorería',
  coalesce(
    (select id from public.chart_of_accounts where code = '1.1.07' limit 1),
    'aaaaaaaa-0001-0001-0001-000000000117'
  )
where not exists (
  select 1 from public.cash_registers where code = 'CAJA-AMET'
);
