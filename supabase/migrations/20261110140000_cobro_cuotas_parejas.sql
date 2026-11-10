-- Un saldo sin meses abiertos puede traer recargos de Lila adentro.
-- Esas cuotas se arman con el schedule del cobro. El sobrante no es otra
-- cuota, y el 10 % de los meses vencidos de ese schedule entra en el tope
-- para que el cobro no se rechace como adelanto.

do $patch$
declare
  v_sql text;
begin
  v_sql := pg_get_functiondef('public.registrar_cobro(uuid, numeric, jsonb, text)'::regprocedure);

  if position('v_baked numeric' in v_sql) > 0 then
    raise exception 'registrar_cobro ya contempla el recargo embebido';
  end if;

  v_sql := replace(
    v_sql,
    'v_paid_reason text;',
    'v_paid_reason text;' || E'\n  v_baked numeric := 0;'
      || E'\n  v_schedule_surcharge numeric := 0;'
      || E'\n  v_sched_due text;'
      || E'\n  v_sched_late numeric;'
  );

  v_sql := replace(
    v_sql,
    'v_payable := round(greatest(v_old, 0) + v_surcharge_due, 2);',
    $ins$
  v_baked := coalesce(nullif(p_periodos->>'bakedSurcharge', '')::numeric, 0);
  if v_baked < 0 then
    v_baked := 0;
  end if;
  v_schedule_surcharge := 0;
  if not exists (
    select 1 from public.member_dues_periods
    where member_id = p_member_id and capital_open > 0
  ) then
    for v_item in
      select value
      from jsonb_array_elements(coalesce(p_periodos->'schedule', '[]'::jsonb))
    loop
      v_sched_due := left(coalesce(v_item->>'dueOn', ''), 10);
      v_sched_late := round(coalesce((v_item->>'lateBase')::numeric, 0), 2);
      if v_sched_due ~ '^\d{4}-\d{2}-\d{2}$'
         and v_sched_due::date > date '1900-01-10'
         and v_today > v_sched_due::date
         and v_sched_late > 0 then
        v_schedule_surcharge := round(
          v_schedule_surcharge + round(v_sched_late * 0.10, 2),
          2
        );
      end if;
    end loop;
  end if;

  v_payable := round(greatest(v_old, 0) + v_surcharge_due + v_schedule_surcharge, 2);
$ins$
  );

  v_sql := replace(
    v_sql,
    'if v_left > 0 then
      insert into public.member_dues_periods (member_id, due_on, capital, capital_open, late_base)
      values (p_member_id, date ''1900-01-10'', v_left, v_left, 0)',
    'if v_left > 0 and abs(v_left - v_baked) > 0.01 then
      insert into public.member_dues_periods (member_id, due_on, capital, capital_open, late_base)
      values (p_member_id, date ''1900-01-10'', v_left, v_left, 0)'
  );

  v_sql := replace(
    v_sql,
    'if v_old > 0 then
    v_should := round(v_old - v_capital_paid, 2);
  else',
    'if v_old > 0 then
    v_should := round(v_old - v_capital_paid, 2);
    if v_baked > 0.01 and v_capital_paid + 0.01 >= round(v_old - v_baked, 2) then
      v_should := round(v_should - least(v_baked, greatest(v_should, 0)), 2);
    end if;
  else'
  );

  v_sql := replace(
    v_sql,
    'jsonb_build_object(''lastPaymentDate'', to_char(v_paid, ''YYYY-MM-DD''))',
    'jsonb_build_object(''lastPaymentDate'', to_char(v_paid, ''YYYY-MM-DD''))'
      || ' || case when v_baked > 0.01 and coalesce(v_should, 0) <= 0.01 then '
      || 'jsonb_build_object(''unpaidCapital'', 0, ''unpaidSurcharges'', 0, ''unpaidInterest'', 0, ''unallocatedBalance'', 0) '
      || 'else ''{}''::jsonb end'
  );

  if position('v_schedule_surcharge' in v_sql) = 0
     or position('abs(v_left - v_baked)' in v_sql) = 0
     or position('unpaidCapital' in v_sql) = 0 then
    raise exception 'No se pudo actualizar registrar_cobro';
  end if;

  execute v_sql;
end
$patch$;
