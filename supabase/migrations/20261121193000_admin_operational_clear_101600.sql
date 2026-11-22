-- Excepción administrativa persistente: 101600 Ramírez Pericas.
-- Remanente octubre 2026 ($ 6.363,64) autorizado en cero operativo, pendiente de conciliación.
-- No inventa pagos, no cierra member_dues_periods ni asientos contables.
-- Idempotente: no pisa una autorización existente.

update public.members m
set meta = coalesce(m.meta, '{}'::jsonb) || jsonb_build_object(
  'adminOperationalClear', jsonb_build_object(
    'id', 'admin-clear-101600-2026-10-10',
    'memberNumber', '101600',
    'periodDueOns', jsonb_build_array('2026-10-10'),
    'dueOn', '2026-10-10',
    'amount', 6363.64,
    'reason', 'Remanente octubre 2026 autorizado en cero operativo · pendiente de conciliación',
    'authorizedBy', 'Administración · Tesorería',
    'authorizedAt', '2026-11-21'
  )
)
where regexp_replace(coalesce(m.member_number, ''), '\D', '', 'g') = '101600'
  and coalesce(m.meta->'adminOperationalClear', 'null'::jsonb) = 'null'::jsonb;
