-- Tests SQL PR #13 — cobro_assert + registrar_cobro (seguridad contable)
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
    40000,
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

-- 6) Pago parcial auténtico: cuota 70k, imputado 30k, open 40k → 40k ok, 70k no
do $$
declare
  v_id uuid := 'a1111111-b222-c333-d444-e55555555555';
  v_pay uuid := 'c1111111-b222-c333-d444-e55555555555';
begin
  delete from public.dues_imputations where member_id = v_id and due_on = '2026-09-10';
  delete from public.member_payments where id = v_pay;
  delete from public.member_dues_periods where member_id = v_id and due_on = '2026-09-10';

  insert into public.member_dues_periods (member_id, due_on, capital, capital_open, late_base)
  values (v_id, '2026-09-10', 70000, 40000, 40000);

  insert into public.member_payments (
    id, member_id, amount, paid_at, method, concept, meta
  ) values (
    v_pay, v_id, 30000, '2026-09-15', 'efectivo',
    'Cuota social · Septiembre de 2026 (parcial)',
    jsonb_build_object('periodDueOns', jsonb_build_array('2026-09-10'), 'status', 'paid')
  );

  insert into public.dues_imputations (
    member_id, payment_id, due_on, capital, surcharge
  ) values (
    v_id, v_pay, '2026-09-10', 30000, 0
  )
  on conflict (payment_id, due_on) do update
    set capital = excluded.capital, surcharge = excluded.surcharge;

  if public.cobro_due_already_paid(v_id, '2026-09-10') then
    raise exception 'FAIL: parcial con open 40k no debe marcar already_paid';
  end if;
  if not public.cobro_due_has_payment_evidence(v_id, '2026-09-10') then
    raise exception 'FAIL: parcial debe tener evidencia de pago';
  end if;

  begin
    perform public.cobro_assert_due_ons_collectable(
      v_id,
      jsonb_build_array(jsonb_build_object('dueOn', '2026-09-10')),
      jsonb_build_object(
        'schedule', jsonb_build_array(jsonb_build_object('dueOn', '2026-09-10', 'capital', 70000))
      ),
      70000
    );
    raise exception 'FAIL: debió rechazar cobrar 70000 tras parcial 30000';
  exception
    when others then
      if SQLERRM ~* 'supera|remanente|exigible|importe|capital pedido' then
        raise notice 'OK rechazo cuota entera tras parcial: %', SQLERRM;
      else
        raise;
      end if;
  end;

  perform public.cobro_assert_due_ons_collectable(
    v_id,
    jsonb_build_array(jsonb_build_object('dueOn', '2026-09-10')),
    jsonb_build_object(
      'schedule', jsonb_build_array(jsonb_build_object('dueOn', '2026-09-10', 'capital', 40000))
    ),
    40000
  );
  raise notice 'OK remanente parcial 40000';
end $$;

-- 7) dueOns=[] + adelanto sin schedule → rechazo (sin bypass)
do $$
declare
  v_id uuid := 'a1111111-b222-c333-d444-e55555555555';
begin
  -- quitar opens para forzar rama “sin períodos efectivos”
  delete from public.member_dues_periods where member_id = v_id;

  begin
    perform public.cobro_assert_due_ons_collectable(
      v_id,
      '[]'::jsonb,
      jsonb_build_object('adelanto', true),
      70000
    );
    raise exception 'FAIL: adelanto con dueOns=[] debió rechazarse';
  exception
    when others then
      if SQLERRM ~* 'ambiguo|dueOns|schedule|adelantar' then
        raise notice 'OK adelanto dueOns vacío: %', SQLERRM;
      else
        raise;
      end if;
  end;
end $$;

-- 8) dueOns=[] deriva schedule modificado con período ya regularizado → rechazo
do $$
declare
  v_id uuid := 'a1111111-b222-c333-d444-e55555555555';
begin
  insert into public.member_dues_periods (member_id, due_on, capital, capital_open, late_base)
  values (v_id, '2026-10-10', 70000, 6363.64, 6363.64);

  begin
    perform public.cobro_assert_due_ons_collectable(
      v_id,
      '[]'::jsonb,
      jsonb_build_object(
        'schedule', jsonb_build_array(
          jsonb_build_object('dueOn', '2026-10-10', 'capital', 6363.64)
        )
      ),
      6363.64
    );
    raise exception 'FAIL: dueOns=[] + schedule octubre clear debió rechazar';
  exception
    when others then
      if SQLERRM ~* 'cero operativo|autorizado|no se puede cobrar' then
        raise notice 'OK dueOns vacío deriva schedule clear: %', SQLERRM;
      else
        raise;
      end if;
  end;
end $$;

-- 8b) dueOns=[] + schedule=[] + concepto descriptivo de cuota + $70k → rechazo
do $$
declare
  v_id uuid := 'a1111111-b222-c333-d444-e55555555555';
begin
  -- con octubre clear abierto: no puede saltear vía concept
  delete from public.member_dues_periods where member_id = v_id;
  insert into public.member_dues_periods (member_id, due_on, capital, capital_open, late_base)
  values (v_id, '2026-10-10', 70000, 6363.64, 6363.64);

  begin
    perform public.cobro_assert_due_ons_collectable(
      v_id,
      '[]'::jsonb,
      jsonb_build_object(
        'concept', 'Cuota social · Noviembre de 2026',
        'concepto', 'Cuota social · Noviembre de 2026'
      ),
      70000
    );
    raise exception 'FAIL: concept cuota descriptivo no debió saltear';
  exception
    when others then
      if SQLERRM ~* 'cero operativo|autorizado|no se puede cobrar|ambiguo|dueOns|schedule|exigible' then
        raise notice 'OK concept cuota no bypass: %', SQLERRM;
      else
        raise;
      end if;
  end;
end $$;

-- 8c) concepto falso de evento para eludir → rechazo
do $$
declare
  v_id uuid := 'a1111111-b222-c333-d444-e55555555555';
begin
  begin
    perform public.cobro_assert_due_ons_collectable(
      v_id,
      '[]'::jsonb,
      jsonb_build_object(
        'concept', 'Evento salón Anhelo',
        'chargeScope', 'evento'
      ),
      70000
    );
    raise exception 'FAIL: concept evento no debió saltear';
  exception
    when others then
      if SQLERRM ~* 'cero operativo|autorizado|no se puede cobrar|ambiguo|dueOns|schedule|exigible' then
        raise notice 'OK concept evento no bypass: %', SQLERRM;
      else
        raise;
      end if;
  end;
end $$;

-- 8d) pago a cuenta explícito sin deuda exigible → permitido
do $$
declare
  v_id uuid := 'a1111111-b222-c333-d444-e55555555555';
begin
  delete from public.member_dues_periods where member_id = v_id;
  perform public.cobro_assert_due_ons_collectable(
    v_id,
    '[]'::jsonb,
    jsonb_build_object('method', 'a_cuenta', 'kind', 'pago_a_cuenta'),
    10000
  );
  raise notice 'OK pago a cuenta sin deuda abierta';
end $$;

-- 9) Permisos: authenticated no ejecuta helpers (sondeo capital ajeno)
do $$
declare
  v_ok boolean := false;
begin
  begin
    execute 'set local role authenticated';
    perform public.cobro_due_uncovered_capital(
      'a1111111-b222-c333-d444-e55555555555'::uuid,
      '2026-10-10'::date,
      '{}'::jsonb
    );
    execute 'reset role';
    raise exception 'FAIL: authenticated no debió ejecutar cobro_due_uncovered_capital';
  exception
    when insufficient_privilege then
      execute 'reset role';
      v_ok := true;
      raise notice 'OK deny uncovered_capital a authenticated';
    when others then
      execute 'reset role';
      if SQLERRM ~* 'permission denied|must be owner|not granted' then
        v_ok := true;
        raise notice 'OK deny uncovered_capital: %', SQLERRM;
      else
        raise;
      end if;
  end;
  if not v_ok then
    raise exception 'FAIL: se esperaba acceso denegado a helper';
  end if;
end $$;

-- Sesión staff real (JWT claims); sin reemplazar has_capability ni auth.uid.
do $$
declare
  v_uid uuid;
begin
  select p.id into v_uid
  from public.profiles p
  where p.is_active is distinct from false
    and exists (
      select 1
      from public.role_capabilities rc
      where rc.capability = 'payments.collect'
        and (
          lower(p.role::text) = rc.role_key
          or exists (
            select 1 from public.profile_roles pr
            where pr.profile_id = p.id
              and pr.revoked_at is null
              and lower(pr.role_key) = rc.role_key
          )
        )
    )
  limit 1;

  if v_uid is null then
    raise exception 'No hay perfil staff con payments.collect para stub JWT';
  end if;

  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text,
    true
  );
end $$;

-- 10) RPC registrar_cobro completo — rechazo sin escritura
do $$
declare
  v_id uuid := 'a1111111-b222-c333-d444-e55555555555';
  v_pay_before int;
  v_imp_before int;
  v_bal_before numeric;
  v_pay_after int;
  v_imp_after int;
  v_bal_after numeric;
begin
  select count(*) into v_pay_before from public.member_payments where member_id = v_id;
  select count(*) into v_imp_before from public.dues_imputations where member_id = v_id;
  select outstanding_balance into v_bal_before from public.members where id = v_id;

  begin
    perform public.registrar_cobro(
      v_id,
      6363.64,
      jsonb_build_object(
        'dueOns', jsonb_build_array('2026-10-10'),
        'schedule', jsonb_build_array(
          jsonb_build_object('dueOn', '2026-10-10', 'capital', 6363.64)
        )
      ),
      'pr13-rpc-reject-oct-' || gen_random_uuid()::text
    );
    raise exception 'FAIL: registrar_cobro debió rechazar octubre clear';
  exception
    when others then
      if SQLERRM ~* 'cero operativo|autorizado|no se puede cobrar|ya está pago' then
        raise notice 'OK registrar_cobro rechazo octubre: %', SQLERRM;
      else
        raise;
      end if;
  end;

  select count(*) into v_pay_after from public.member_payments where member_id = v_id;
  select count(*) into v_imp_after from public.dues_imputations where member_id = v_id;
  select outstanding_balance into v_bal_after from public.members where id = v_id;

  if v_pay_after <> v_pay_before
     or v_imp_after <> v_imp_before
     or round(coalesce(v_bal_after, 0), 2) <> round(coalesce(v_bal_before, 0), 2) then
    raise exception
      'FAIL: rechazo escribió pagos/imputaciones/saldo (pay %→%, imp %→%, bal %→%)',
      v_pay_before, v_pay_after, v_imp_before, v_imp_after, v_bal_before, v_bal_after;
  end if;
  raise notice 'OK rechazo sin escrituras';
end $$;

-- 11) RPC: remanente parcial permitido; cuota entera no
do $$
declare
  v_id uuid := 'a1111111-b222-c333-d444-e55555555555';
  v_result jsonb;
  v_open numeric;
begin
  update public.members
  set meta = coalesce(meta, '{}'::jsonb) - 'adminOperationalClear' - 'adminOperationalClears',
      outstanding_balance = 40000
  where id = v_id;

  delete from public.dues_imputations where member_id = v_id and due_on = '2026-09-10';
  delete from public.member_dues_periods where member_id = v_id and due_on = '2026-09-10';
  insert into public.member_dues_periods (member_id, due_on, capital, capital_open, late_base)
  values (v_id, '2026-09-10', 70000, 40000, 40000);

  -- evidencia de parcial previo (no already_paid total)
  insert into public.member_payments (
    id, member_id, amount, paid_at, method, concept, meta
  ) values (
    'c2222222-b222-c333-d444-e55555555555',
    v_id, 30000, '2026-09-15', 'efectivo',
    'Cuota social · Septiembre de 2026 (parcial)',
    jsonb_build_object('periodDueOns', jsonb_build_array('2026-09-10'), 'status', 'paid')
  )
  on conflict (id) do nothing;

  insert into public.dues_imputations (
    member_id, payment_id, due_on, capital, surcharge
  )
  select v_id, 'c2222222-b222-c333-d444-e55555555555', '2026-09-10', 30000, 0
  where not exists (
    select 1 from public.dues_imputations
    where payment_id = 'c2222222-b222-c333-d444-e55555555555' and due_on = '2026-09-10'
  );

  begin
    perform public.registrar_cobro(
      v_id,
      70000,
      jsonb_build_object(
        'dueOns', jsonb_build_array('2026-09-10'),
        'schedule', jsonb_build_array(
          jsonb_build_object('dueOn', '2026-09-10', 'capital', 70000)
        )
      ),
      'pr13-rpc-reject-full-' || gen_random_uuid()::text
    );
    raise exception 'FAIL: registrar_cobro no debió aceptar 70000 sobre remanente 40000';
  exception
    when others then
      if SQLERRM ~* 'supera|remanente|exigible|importe|capital pedido' then
        raise notice 'OK RPC rechazo 70000 sobre parcial: %', SQLERRM;
      else
        raise;
      end if;
  end;

  v_result := public.registrar_cobro(
    v_id,
    40000,
    jsonb_build_object(
      'dueOns', jsonb_build_array('2026-09-10'),
      'schedule', jsonb_build_array(
        jsonb_build_object('dueOn', '2026-09-10', 'capital', 40000)
      ),
      'method', 'efectivo'
    ),
    'pr13-rpc-ok-rem-' || gen_random_uuid()::text
  );

  select capital_open into v_open
  from public.member_dues_periods
  where member_id = v_id and due_on = '2026-09-10';

  if coalesce(v_open, 0) > 0.01 then
    raise exception 'FAIL: tras remanente capital_open=%', v_open;
  end if;
  if v_result is null then
    raise exception 'FAIL: registrar_cobro remanente sin resultado';
  end if;
  raise notice 'OK RPC remanente 40000 aplicado';
end $$;

-- 12) RPC: dueOns=[] schedule=[] + concept cuota/$70k → rechazo sin escrituras
do $$
declare
  v_id uuid := 'a1111111-b222-c333-d444-e55555555555';
  v_pay_before int;
  v_imp_before int;
  v_bal_before numeric;
  v_pay_after int;
  v_imp_after int;
  v_bal_after numeric;
begin
  update public.members
  set meta = jsonb_build_object(
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
      ),
      outstanding_balance = 0
  where id = v_id;

  delete from public.member_dues_periods where member_id = v_id;
  insert into public.member_dues_periods (member_id, due_on, capital, capital_open, late_base)
  values (v_id, '2026-10-10', 70000, 6363.64, 6363.64);

  select count(*) into v_pay_before from public.member_payments where member_id = v_id;
  select count(*) into v_imp_before from public.dues_imputations where member_id = v_id;
  select outstanding_balance into v_bal_before from public.members where id = v_id;

  begin
    perform public.registrar_cobro(
      v_id,
      70000,
      jsonb_build_object(
        'dueOns', '[]'::jsonb,
        'schedule', '[]'::jsonb,
        'concept', 'Cuota social · Noviembre de 2026'
      ),
      'pr13-rpc-concept-bypass-' || gen_random_uuid()::text
    );
    raise exception 'FAIL: RPC no debió aceptar concept bypass $70k';
  exception
    when others then
      if SQLERRM ~* 'cero operativo|autorizado|no se puede cobrar|ambiguo|dueOns|schedule|exigible|ya está pago' then
        raise notice 'OK RPC concept bypass rechazo: %', SQLERRM;
      else
        raise;
      end if;
  end;

  begin
    perform public.registrar_cobro(
      v_id,
      70000,
      jsonb_build_object(
        'dueOns', '[]'::jsonb,
        'schedule', '[]'::jsonb,
        'concept', 'Evento salón Anhelo',
        'chargeScope', 'evento'
      ),
      'pr13-rpc-event-bypass-' || gen_random_uuid()::text
    );
    raise exception 'FAIL: RPC no debió aceptar concept evento';
  exception
    when others then
      if SQLERRM ~* 'cero operativo|autorizado|no se puede cobrar|ambiguo|dueOns|schedule|exigible|ya está pago' then
        raise notice 'OK RPC event bypass rechazo: %', SQLERRM;
      else
        raise;
      end if;
  end;

  select count(*) into v_pay_after from public.member_payments where member_id = v_id;
  select count(*) into v_imp_after from public.dues_imputations where member_id = v_id;
  select outstanding_balance into v_bal_after from public.members where id = v_id;
  if v_pay_after <> v_pay_before
     or v_imp_after <> v_imp_before
     or round(coalesce(v_bal_after, 0), 2) <> round(coalesce(v_bal_before, 0), 2) then
    raise exception 'FAIL: concept bypass escribió filas';
  end if;
  raise notice 'OK RPC concept bypass sin escrituras';
end $$;

-- 13) RPC: adelanto legítimo con dueOn explícito → permitido (si no hay otra deuda)
do $$
declare
  v_id uuid := 'a1111111-b222-c333-d444-e55555555555';
begin
  update public.members
  set meta = '{}'::jsonb, outstanding_balance = 0
  where id = v_id;
  delete from public.member_dues_periods where member_id = v_id;

  perform public.cobro_assert_due_ons_collectable(
    v_id,
    jsonb_build_array(jsonb_build_object('dueOn', '2026-12-10')),
    jsonb_build_object('adelanto', true),
    70000
  );
  raise notice 'OK adelanto legítimo identificado';
end $$;

-- Limpieza + rollback (sin persistir nada)
delete from public.dues_imputations where member_id = 'a1111111-b222-c333-d444-e55555555555';
delete from public.member_payments where member_id = 'a1111111-b222-c333-d444-e55555555555';
delete from public.member_dues_periods where member_id = 'a1111111-b222-c333-d444-e55555555555';
delete from public.members where id = 'a1111111-b222-c333-d444-e55555555555';

rollback;
