-- Si el recibo trae intereses y el schedule no manda lateBase,
-- el tope ignoraba esos $ y rechazaba el cobro como adelanto.

do $patch$
declare
  v_sql text;
  v_late text := 'round(coalesce((v_item->>''lateBase'')::numeric, 0), 2)';
  v_late_fixed text := 'round(coalesce(nullif(v_item->>''lateBase'', '''')::numeric, case when coalesce(nullif(p_periodos->>''surcharge'', '''')::numeric, 0) > 0 then coalesce((v_item->>''capital'')::numeric, 0) else 0 end), 2)';
begin
  v_sql := pg_get_functiondef('public.registrar_cobro(uuid, numeric, jsonb, text)'::regprocedure);
  if strpos(v_sql, 'nullif(v_item->>''lateBase''') > 0 then
    return;
  end if;
  if strpos(v_sql, v_late) = 0 then
    raise exception 'No se encontró el lateBase de registrar_cobro';
  end if;
  v_sql := replace(v_sql, v_late, v_late_fixed);
  v_sql := replace(
    v_sql,
    'v_payable := round(greatest(v_old, 0) + v_surcharge_due + v_schedule_surcharge, 2);',
    'v_payable := round(greatest(v_old, 0) + v_surcharge_due + greatest(v_schedule_surcharge, coalesce(nullif(p_periodos->>''surcharge'', '''')::numeric, 0)), 2);'
  );
  if strpos(v_sql, 'nullif(v_item->>''lateBase''') = 0
     or strpos(v_sql, 'greatest(v_schedule_surcharge, coalesce(nullif(p_periodos->>''surcharge''') = 0 then
    raise exception 'No se pudo aceptar el recargo del recibo';
  end if;
  execute v_sql;
end
$patch$;

-- El 10 % que no entró en el mes no es un adelanto. Se suma al mes vencido.
do $patch2$
declare
  v_sql text;
  v_mark text := 'v_late <= 0 and v_today > v_due::date';
  v_late_line text := '      v_late := round(coalesce(nullif(v_item->>''lateBase'', '''')::numeric, case when coalesce(nullif(p_periodos->>''surcharge'', '''')::numeric, 0) > 0 then coalesce((v_item->>''capital'')::numeric, 0) else 0 end), 2);';
  v_gate text := '  if round(v_cash, 2) > 0.01 then';
  v_loop text := $l$
  if round(v_cash, 2) > 0.01 then
    for v_item in
      select jsonb_build_object('id', id, 'capital', capital, 'surcharge', surcharge)
      from public.dues_imputations
      where payment_id = v_payment.id
        and voided_at is null
        and due_on > date '1900-01-10'
        and due_on < v_today
      order by due_on
    loop
      exit when v_cash <= 0.01;
      v_cap := round(coalesce((v_item->>'capital')::numeric, 0) * 0.10, 2)
        - round(coalesce((v_item->>'surcharge')::numeric, 0), 2);
      if v_cap > 0.01 then
        v_take := least(v_cash, v_cap);
        update public.dues_imputations
        set surcharge = round(surcharge + v_take, 2)
        where id = (v_item->>'id')::uuid;
        v_surcharge_paid := round(v_surcharge_paid + v_take, 2);
        v_cash := round(v_cash - v_take, 2);
      end if;
    end loop;
  end if;

  if round(v_cash, 2) > 0.01 then
$l$;
begin
  v_sql := pg_get_functiondef('public.registrar_cobro(uuid, numeric, jsonb, text)'::regprocedure);
  if strpos(v_sql, v_mark) > 0 and strpos(v_sql, 'due_on < v_today') > 0 then
    return;
  end if;
  if strpos(v_sql, v_mark) = 0 and strpos(v_sql, v_late_line) > 0 then
    v_sql := replace(
      v_sql,
      v_late_line,
      v_late_line || E'\n      if v_late <= 0 and v_today > v_due::date and coalesce(nullif(p_periodos->>''surcharge'', '''')::numeric, 0) > 0 then\n        v_late := v_cap;\n      end if;'
    );
  end if;
  if strpos(v_sql, 'due_on < v_today') = 0 and strpos(v_sql, v_gate) > 0 then
    v_sql := replace(v_sql, v_gate, v_loop);
  end if;
  if strpos(v_sql, 'El cobro supera la deuda') = 0 then
    raise exception 'Se perdió el control del adelanto';
  end if;
  execute v_sql;
end
$patch2$;
