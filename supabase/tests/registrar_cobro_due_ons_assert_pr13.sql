-- Tests SQL PR #13 — cobro_assert_due_ons_collectable
-- Ejecutar en branch / entorno NO productivo (BEGIN…ROLLBACK).
-- NO aplicar en producción.

\set ON_ERROR_STOP on

begin;

-- Socio sintético aislado
do $$
declare
  v_id uuid := 'a1111111-b222-c333-d444-e55555555555';
begin
  delete from public.dues_imputations where member_id = v_id;
  delete from public.member_payments where member_id = v_id;
  delete from public.member_dues_periods where member_id = v_id;
  delete from public.members where id = v_id;

  insert into public.members (
    id, member_number, full_name, status, outstanding_balance, next_due_date, meta
  ) values (
    v_id,
    '9901600',
    'Test Assert DueOns PR13',
    'active',
    0,
    '2026-10-10',
    jsonb_build_object(
      'adminOperationalClear', jsonb_build_object(
        'id', 'admin-clear-test-2026-10-10',
        'memberNumber', '9901600',
        'periodDueOns', jsonb_build_array('2026-10-10'),
        'dueOn', '2026-10-10',
        'amount', 6363.64,
        'reason', 'test clear',
        'authorizedBy', 'test',
        'authorizedAt', '2026-11-21'
      )
    )
  );

  insert into public.member_dues_periods (member_id, due_on, capital, capital_open, late_base)
  values (v_id, '2026-10-10', 70000, 6363.64, 6363.64);

  insert into public.member_payments (
    id, member_id, amount, paid_at, method, concept, meta
  ) values (
    'b1111111-b222-c333-d444-e55555555555',
    v_id,
    70000,
    '2026-11-09',
    'transferencia',
    'Cuota social · Noviembre de 2026',
    jsonb_build_object('periodDueOns', jsonb_build_array('2026-11-10'), 'status', 'paid')
  );
end $$;

-- 1) 101600-like: octubre con clear total → rechazado
do $$
declare
  v_id uuid := 'a1111111-b222-c333-d444-e55555555555';
begin
  perform public.cobro_assert_due_ons_collectable(
    v_id,
    jsonb_build_array(jsonb_build_object('dueOn', '2026-10-10')),
    '{}'::jsonb,
    6363.64
  );
  raise exception 'FAIL: debió rechazar octubre cubierto por clear';
exception
  when others then
    if SQLERRM ~* 'cero operativo|autorizado|no se puede cobrar' then
      raise notice 'OK octubre clear total: %', SQLERRM;
    else
      raise;
    end if;
end $$;

-- 2) noviembre ya pago → rechazado (también con adelanto=true)
do $$
declare
  v_id uuid := 'a1111111-b222-c333-d444-e55555555555';
begin
  perform public.cobro_assert_due_ons_collectable(
    v_id,
    jsonb_build_array(jsonb_build_object('dueOn', '2026-11-10')),
    jsonb_build_object('adelanto', true),
    70000
  );
  raise exception 'FAIL: debió rechazar noviembre pago con adelanto=true';
exception
  when others then
    if SQLERRM ~* 'ya está pago' then
      raise notice 'OK noviembre pago + adelanto: %', SQLERRM;
    else
      raise;
    end if;
end $$;

-- 3) diciembre sin fila / sin clear / sin pago → permitido (adelanto legítimo)
do $$
declare
  v_id uuid := 'a1111111-b222-c333-d444-e55555555555';
begin
  perform public.cobro_assert_due_ons_collectable(
    v_id,
    jsonb_build_array(jsonb_build_object('dueOn', '2026-12-10')),
    jsonb_build_object('adelanto', true),
    70000
  );
  raise notice 'OK diciembre adelanto legítimo';
end $$;

-- 4) clear parcial: open 10000 / clear 6363.64 → máx 3636.36
do $$
declare
  v_id uuid := 'a1111111-b222-c333-d444-e55555555555';
  v_unc jsonb;
begin
  update public.member_dues_periods
  set capital = 10000, capital_open = 10000, late_base = 10000
  where member_id = v_id and due_on = '2026-10-10';

  v_unc := public.cobro_due_uncovered_capital(v_id, '2026-10-10', '{}'::jsonb);
  if round((v_unc->>'uncovered')::numeric, 2) <> 3636.36 then
    raise exception 'FAIL uncovered parcial=%', v_unc->>'uncovered';
  end if;

  begin
    perform public.cobro_assert_due_ons_collectable(
      v_id,
      jsonb_build_array(jsonb_build_object('dueOn', '2026-10-10')),
      jsonb_build_object(
        'schedule', jsonb_build_array(jsonb_build_object('dueOn', '2026-10-10', 'capital', 10000))
      ),
      10000
    );
    raise exception 'FAIL: debió rechazar schedule 10000 > exigible 3636.36';
  exception
    when others then
      if SQLERRM ~* 'supera el exigible|capital pedido' then
        raise notice 'OK tope parcial schedule: %', SQLERRM;
      else
        raise;
      end if;
  end;

  perform public.cobro_assert_due_ons_collectable(
    v_id,
    jsonb_build_array(jsonb_build_object('dueOn', '2026-10-10')),
    jsonb_build_object(
      'schedule', jsonb_build_array(jsonb_build_object('dueOn', '2026-10-10', 'capital', 3636.36))
    ),
    3636.36
  );
  raise notice 'OK cobro parcial legítimo 3636.36';
end $$;

-- 5) diciembre con deuda legítima abierta → permitido
do $$
declare
  v_id uuid := 'a1111111-b222-c333-d444-e55555555555';
begin
  delete from public.member_dues_periods
  where member_id = v_id and due_on = '2026-12-10';
  insert into public.member_dues_periods (member_id, due_on, capital, capital_open, late_base)
  values (v_id, '2026-12-10', 70000, 70000, 70000);

  -- reset oct to full clear again so no “otra deuda” confunda
  update public.member_dues_periods
  set capital = 70000, capital_open = 6363.64, late_base = 6363.64
  where member_id = v_id and due_on = '2026-10-10';

  perform public.cobro_assert_due_ons_collectable(
    v_id,
    jsonb_build_array(jsonb_build_object('dueOn', '2026-12-10')),
    jsonb_build_object(
      'schedule', jsonb_build_array(jsonb_build_object('dueOn', '2026-12-10', 'capital', 70000))
    ),
    70000
  );
  raise notice 'OK diciembre deuda legítima';
end $$;

-- Sin pagos/imputaciones fantasma: limpiar y rollback
delete from public.dues_imputations where member_id = 'a1111111-b222-c333-d444-e55555555555';
delete from public.member_payments where member_id = 'a1111111-b222-c333-d444-e55555555555';
delete from public.member_dues_periods where member_id = 'a1111111-b222-c333-d444-e55555555555';
delete from public.members where id = 'a1111111-b222-c333-d444-e55555555555';

rollback;
