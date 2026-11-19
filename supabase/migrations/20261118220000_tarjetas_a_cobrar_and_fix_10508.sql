-- Tarjetas a cobrar (POS pendiente de liquidación) + corrección cobro RC-10508-20261118.
-- No duplica ingresos: solo reclasifica Caja → Tarjetas y enlaza el pago al asiento 322.

insert into public.chart_of_accounts (
  id, code, name, account_type, level, is_postable, is_cash_account, description, parent_id
)
select
  'aaaaaaaa-0001-0001-0001-000000000119',
  '1.1.09',
  'Tarjetas a cobrar',
  'asset',
  3,
  true,
  false,
  'Cupones POS / Visa pendientes de liquidación bancaria',
  'aaaaaaaa-0001-0001-0001-000000000011'
where not exists (
  select 1 from public.chart_of_accounts where code = '1.1.09' or name = 'Tarjetas a cobrar'
);

-- Enlazar cobro 10508 al asiento 322 y completar meta (adelanto + cuenta tarjeta).
update public.member_payments p
set
  journal_entry_id = coalesce(p.journal_entry_id, 'fe1abc76-802e-4290-b8ae-7f7ea895b2b4'::uuid),
  meta = jsonb_set(
    jsonb_set(
      coalesce(p.meta, '{}'::jsonb) || jsonb_build_object('creditLeftover', 11000),
      '{paymentSplits}',
      (
        select coalesce(jsonb_agg(
          case
            when lower(coalesce(elem->>'method', '')) = 'tarjeta'
              then elem || jsonb_build_object('journalAccount', 'Tarjetas a cobrar')
            else elem
          end
          order by ord
        ), '[]'::jsonb)
        from jsonb_array_elements(coalesce(p.meta->'paymentSplits', '[]'::jsonb))
          with ordinality as t(elem, ord)
      )
    ),
    '{rectification}',
    jsonb_build_object(
      'at', now(),
      'reason', 'Auditoría RC-10508-20261118: mixto, adelanto $11000, tarjeta a Tarjetas a cobrar, vínculo asiento 322',
      'source', 'migration_20261118220000'
    )
  )
where p.id = 'e8427990-c6dc-4a9c-abf3-a515d4fccd88';

-- Ajuste contable: sacar $393.000 de Caja General y pasarlos a Tarjetas a cobrar.
-- No toca el haber de Cuotas Sociales ni el total del cobro.
with je as (
  insert into public.journal_entries (
    fiscal_period_id,
    entry_date,
    concept,
    reference,
    status,
    source_module,
    source_id,
    created_by,
    posted_by,
    posted_at
  )
  select
    je.fiscal_period_id,
    current_date,
    'Reclasificación tarjeta RC-10508-20261118 · asiento 322 (Caja → Tarjetas a cobrar)',
    'RC-10508-20261118',
    'posted',
    'cuotas',
    'e8427990-c6dc-4a9c-abf3-a515d4fccd88',
    je.created_by,
    je.created_by,
    now()
  from public.journal_entries je
  where je.id = 'fe1abc76-802e-4290-b8ae-7f7ea895b2b4'
    and not exists (
      select 1
      from public.journal_entries x
      where x.reference = 'RC-10508-20261118'
        and x.concept ilike 'Reclasificación tarjeta RC-10508%'
    )
  returning id
)
insert into public.journal_lines (journal_entry_id, account_id, line_order, debit, credit, memo)
select je.id, 'aaaaaaaa-0001-0001-0001-000000000119'::uuid, 1, 393000, 0, 'Tarjetas a cobrar · Visa 3 cuotas'
from je
union all
select je.id, 'aaaaaaaa-0001-0001-0001-000000000111'::uuid, 2, 0, 393000, 'Sale de Caja General (reclasificación)'
from je;
