-- Conciliación demostrable socio 9751 (Calderón Luna).
-- outstanding_balance 7000 = opening 77000 − pago octubre 70000.
-- No toca el saldo operativo; solo alinea unpaidCapital stale.

update public.members
set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
  'unpaidCapital', 7000,
  'unpaidCapitalReconciledAt', '2026-11-20',
  'unpaidCapitalReconciledNote',
    'Alineado a outstanding_balance tras apertura 77000 (03/11) − pago octubre 70000 (01/11, cpr 03656347). Los 7000 restantes son el remanente de la apertura (no crédito). unpaidCapital 70000 estaba stale.'
),
updated_at = now()
where member_number = '9751'
  and round(coalesce(outstanding_balance, 0), 2) = 7000;
