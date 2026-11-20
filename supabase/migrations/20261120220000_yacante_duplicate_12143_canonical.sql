-- Rut Tamara Yacante Jaled: 12143 canónica, 10698 histórico.
-- No mueve deuda ni familiares de 10698 (GF Bassi queda para revisión).

-- 1) Marcar 10698 como antecedente histórico de 12143 (sin tocar saldo).
update public.members
set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
  'historicalDuplicate', true,
  'canonicalMemberNumber', '12143',
  'duplicateOfMemberNumber', '12143',
  'duplicateReviewedAt', '2026-11-20',
  'duplicateReviewNote',
    'Misma persona que 12143 (DNI 3859356 truncado de 38593056). No está en socios legado. Deuda $376100.78 y GF Bassi se conservan aquí; no transferir.',
  'documentNumberCorrectedNote', 'DNI almacenado 3859356; canónico 38593056 en ficha 12143'
),
updated_at = now()
where member_number = '10698'
  and status = 'inactive';

-- 2) Grupo familiar visible en 12143 + Yashira 12144 (sin tocar Bassi).
update public.members
set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
  'familyPrincipalNumber', '12143',
  'familyGroupName', 'Familia Yacante Jaled',
  'verifiedTenureYears', 3,
  'verifiedTenureAsOf', '2026-11-20',
  'verifiedTenureSource', 'confirmacion administrativa: 3 años',
  'duesCoveredThrough', '2026-10',
  'duesCoveredThroughSource', 'Macro Clic octubre 2026 confirmado por administración'
),
years_active = greatest(coalesce(years_active, 0), 3),
updated_at = now()
where member_number = '12143';

update public.members
set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
  'familyPrincipalNumber', '12143',
  'familyGroupName', 'Familia Yacante Jaled'
),
updated_at = now()
where member_number = '12144';

-- 3) Registrar cobro octubre Macro Clic en 12143 sin dejar saldo en 0:
--    el opening actual ($70.000) es la cuota de noviembre.
do $$
declare
  v_member uuid;
  v_payment uuid := gen_random_uuid();
  v_bal numeric;
begin
  select id into v_member from public.members where member_number = '12143';
  if v_member is null then
    return;
  end if;

  if exists (
    select 1 from public.member_payments
    where member_id = v_member
      and (
        idempotency_key = 'admin:12143:octubre-2026:macro-clic:70000'
        or receipt_number = 'MACRO-CLIC-12143-202610'
      )
  ) then
    return;
  end if;

  insert into public.member_payments (
    id, member_id, amount, paid_at, method, concept, period_label, receipt_number, idempotency_key, meta
  ) values (
    v_payment,
    v_member,
    70000,
    '2026-10-10',
    'debito',
    'Octubre de 2026 - SOCIO FAMILIAR · Macro Clic',
    '2026-10',
    'MACRO-CLIC-12143-202610',
    'admin:12143:octubre-2026:macro-clic:70000',
    jsonb_build_object(
      'bank', 'Macro Clic',
      'quota', 70000,
      'surcharge', 0,
      'periodDueOns', jsonb_build_array(jsonb_build_object('dueOn', '2026-10-10')),
      'paidAtReason', 'Confirmación administrativa: débito Macro Clic octubre 2026',
      'importSource', 'admin-reconcile-2026-11-20'
    )
  );

  -- El trigger descuenta el payment del saldo; reponer noviembre como cargo liquidado.
  insert into public.member_dues_entries (member_id, amount, kind, source)
  values (
    v_member,
    70000,
    'charge',
    'liquidacion:12143:2026-11:post-macro-clic-oct'
  )
  on conflict (source) where source <> '' do nothing;

  update public.members
  set outstanding_balance = (
    select round(coalesce(sum(e.amount), 0), 2)
    from public.member_dues_entries e
    where e.member_id = v_member
  ),
  next_due_date = '2026-11-10',
  meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
    'unpaidCapital', 70000,
    'lastPaymentDate', '2026-10-10',
    'duesCoveredThrough', '2026-10'
  ),
  updated_at = now()
  where id = v_member
  returning outstanding_balance into v_bal;
end $$;
