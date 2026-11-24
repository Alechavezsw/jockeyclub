-- Propuesta de lectura. No modifica saldos, pagos ni líneas.
-- Los ajustes sin mes quedan visibles para conciliar. No se aplican solos.

create or replace view public.dues_historical_reconciliation_proposal
with (security_invoker = true) as
select
  member_number,
  count(*)::integer as lines,
  coalesce(sum(pending), 0)::numeric as pending_without_period
from public.fee_ledger_lines
where source = 'connect_admin_reconciliation_20261123'
  and line_date is null
  and pending > 0
group by member_number;

comment on view public.dues_historical_reconciliation_proposal is
  'Ajustes históricos sin mes. No es deuda cobrable ni modifica el saldo.';
