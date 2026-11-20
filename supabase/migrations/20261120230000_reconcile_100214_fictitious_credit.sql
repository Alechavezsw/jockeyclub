-- Socio 100214 Daiana Noel Rodríguez
-- Cobro 20/11/2026 $154.000 (oct+nov a tarifa 2×70k + 2×7k).
-- La ficha tenía solo $135.000 de capital → noviembre se imputó $65k+$6.5k
-- y el resto ($5.500) se grabó como adelanto ficticio.
-- El asiento 356 ya acredita $154.000 a Cuotas Sociales (correcto).
-- Reasignar a obligaciones; saldo operativo $0; sin inventar diciembre.

do $$
declare
  v_member uuid;
  v_pay uuid := '4f5aa63d-9426-4b7c-8bf0-aca71a22286f';
  v_bal numeric;
begin
  select id into v_member from public.members where member_number = '100214' for update;
  if v_member is null then
    raise notice '100214 no encontrado; skip';
    return;
  end if;

  -- Respaldo auditável en meta (una sola vez).
  update public.members
  set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
    'creditReconcile100214', jsonb_build_object(
      'at', to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD"T"HH24:MI:SS'),
      'paymentId', v_pay,
      'beforeOutstanding', outstanding_balance,
      'beforeOpenPeriods', meta->'duesOpenPeriods',
      'note', 'Reasignación adelanto ficticio $5500 → capital/recargo noviembre a tarifa $70000+$7000'
    )
  )
  where id = v_member
    and meta->>'creditReconcile100214' is null;

  -- Imputación noviembre a tarifa entera.
  update public.dues_imputations
  set capital = 70000,
      surcharge = 7000,
      late_base_taken = 70000,
      capital_open = 0,
      surcharge_open = 0
  where payment_id = v_pay
    and member_id = v_member
    and due_on = date '2026-11-10'
    and voided_at is null
    and round(capital, 2) = 65000;

  update public.member_dues_periods
  set capital = 70000,
      capital_open = 0,
      late_base = 0
  where member_id = v_member
    and due_on = date '2026-11-10'
    and round(capital, 2) = 65000;

  -- Quitar adelanto ficticio (idempotente por source).
  delete from public.member_dues_entries
  where member_id = v_member
    and kind = 'adelanto'
    and source = 'adelanto:' || v_pay::text;

  -- Meta del cobro: sin adelanto; cuota/recargo alineados al comprobante.
  update public.member_payments
  set meta = coalesce(meta, '{}'::jsonb)
    || jsonb_build_object(
      'quota', 140000,
      'surcharge', 14000,
      'adelanto', false,
      'advanceDueOn', null,
      'creditLeftover', null,
      'creditReconciledAt', '2026-11-20',
      'creditReconciledNote',
        'Adelanto $5500 reasignado a noviembre $70000+$7000 (tarifa). Asiento 356 intacto $154000.'
    )
    - 'creditLeftover'
  where id = v_pay;

  update public.members
  set next_due_date = date '2026-12-10',
      overdue_since = null,
      meta = (coalesce(meta, '{}'::jsonb)
        - 'duesOpenPeriods'
        - 'creditBalance'
        - 'creditBalanceSource'
        - 'creditBalanceAsOf')
        || jsonb_build_object(
          'unpaidCapital', 0,
          'unpaidSurcharges', 0,
          'unpaidInterest', 0,
          'unallocatedBalance', 0,
          'duesCoveredThrough', '2026-11',
          'duesCoveredThroughSource', 'reconcile:100214:oct-nov-2026'
        ),
      outstanding_balance = (
        select round(coalesce(sum(e.amount), 0), 2)
        from public.member_dues_entries e
        where e.member_id = v_member
      ),
      updated_at = now()
  where id = v_member
  returning outstanding_balance into v_bal;

  if abs(coalesce(v_bal, 0)) > 0.01 then
    raise exception '100214: saldo esperado 0 tras conciliación, quedó %', v_bal;
  end if;
end $$;
