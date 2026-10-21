-- El operario de pileta NO comparte el mostrador de administración.
-- Cobra canon, carga apto y abre la caja del día en /pileta y /entrada-pileta.
-- No lee snapshots de LILA ni cuentas de cuotas: eso es saldos / liquidación.
-- La caja del día (is_pool_day_cash_open) y record_pool_canon van en
-- 20261021130000_permissions_hardening.sql.

do $$
begin
  null;
end $$;
