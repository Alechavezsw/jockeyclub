-- Pruebas SQL de integración POS (B5) — ejecutar en rama/preview aislada, NO en prod.
-- Uso: psql / MCP execute_sql sobre una base con schema equivalente.
-- Idempotencia: se puede correr dos veces.

begin;

-- Helper existe y es puro
select public.cobro_periodos_pos_meta(null) = '{}'::jsonb as meta_null_ok;
select public.cobro_periodos_pos_meta('{"voucherAmount":"77000","cardFinancing":{"mode":"issuer_keeps","financingAmount":7000},"paymentPlanSnapshot":{"id":"visa-3"},"journalAccount":"Tarjetas a cobrar","receiptParse":{"amount":77000}}'::jsonb)
  as meta_sample;

-- Cuenta 4.1.05
select code, name, is_active
from public.chart_of_accounts
where code = '4.1.05';

-- registrar_cobro contiene el merge
select position('cobro_periodos_pos_meta(p_periodos)' in pg_get_functiondef('public.registrar_cobro(uuid, numeric, jsonb, text)'::regprocedure)) > 0
  as registrar_has_pos_meta;

-- Compatibilidad: meta vieja sin POS sigue parseable (keys nuevas null)
select public.cobro_periodos_pos_meta('{"method":"efectivo","paymentPlanLabel":null}'::jsonb) = '{}'::jsonb
  as legacy_meta_ok;

rollback;
