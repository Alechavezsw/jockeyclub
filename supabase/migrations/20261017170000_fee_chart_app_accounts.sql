-- Plan de cuotas de la app: una cuenta por categoría con tarifa.
-- Familiar e Individual ya existen (fca-31 / fca-33).

insert into public.fee_ledger_accounts (
  id, accessin_id, name, description, fee_categories, balance, detail_account_label, is_active, source
)
values
  ('fca-abono_tenis', null, 'ABONO TENIS', 'ABONO TENIS', array['ABONO TENIS'], 0, 'ABONO TENIS', true, 'app'),
  ('fca-socio_familiar_amet', null, 'SOCIO FAMILIAR (AMET)', 'SOCIO FAMILIAR (AMET)', array['SOCIO FAMILIAR (AMET)'], 0, 'SOCIO FAMILIAR (AMET)', true, 'app'),
  ('fca-socio_individual_amet', null, 'SOCIO INDIVIDUAL (AMET)', 'SOCIO INDIVIDUAL (AMET)', array['SOCIO INDIVIDUAL (AMET)'], 0, 'SOCIO INDIVIDUAL (AMET)', true, 'app'),
  (
    'fca-interes_por_transaccion_25_grupo_familiar_amet',
    null,
    'INTERES POR TRANSACCIÓN 2,5% GRUPO FAMILIAR (AMET)',
    'INTERES POR TRANSACCIÓN 2,5% GRUPO FAMILIAR (AMET)',
    array['INTERES POR TRANSACCIÓN 2,5% GRUPO FAMILIAR (AMET)'],
    0,
    'INTERES POR TRANSACCIÓN 2,5% GRUPO FAMILIAR (AMET)',
    true,
    'app'
  ),
  (
    'fca-interes_por_transaccion_25_socio_individual_amet',
    null,
    'INTERES POR TRANSACCIÓN 2,5% SOCIO INDIVIDUAL (AMET)',
    'INTERES POR TRANSACCIÓN 2,5% SOCIO INDIVIDUAL (AMET)',
    array['INTERES POR TRANSACCIÓN 2,5% SOCIO INDIVIDUAL (AMET)'],
    0,
    'INTERES POR TRANSACCIÓN 2,5% SOCIO INDIVIDUAL (AMET)',
    true,
    'app'
  )
on conflict (id) do nothing;
