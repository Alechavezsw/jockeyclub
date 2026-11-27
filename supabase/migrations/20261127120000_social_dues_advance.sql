-- Adelanto de cuota social: uno o varios meses que todavía no empezaron.
-- El capital queda imputado a ese vencimiento, sin recargo y sin bajar otra deuda.
-- La liquidación de ese mes lo ve pago y no suma saldo.

create or replace function public.cobro_next_due_after_advance(
  p_member_id uuid,
  p_due date
)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_due date := p_due;
  v_guard int := 0;
  v_prepaid text[];
begin
  if p_member_id is null or p_due is null then
    return p_due;
  end if;
  select coalesce(array_agg(left(value, 10)), '{}'::text[])
    into v_prepaid
  from jsonb_array_elements_text(
    coalesce(
      (select meta->'prepaidSocialDueOns' from public.members where id = p_member_id),
      '[]'::jsonb
    )
  );
  while v_due is not null
    and v_guard < 24
    and (
      to_char(v_due, 'YYYY-MM-DD') = any (v_prepaid)
      or exists (
        select 1 from public.member_dues_periods
        where member_id = p_member_id
          and due_on = v_due
          and capital_open <= 0.009
      )
      or (
        public.cobro_due_has_payment_evidence(p_member_id, v_due)
        and not exists (
          select 1 from public.member_dues_periods
          where member_id = p_member_id
            and due_on = v_due
            and capital_open > 0.009
        )
      )
    )
  loop
    v_due := (date_trunc('month', v_due) + interval '1 month')::date + 9;
    v_guard := v_guard + 1;
  end loop;
  return v_due;
end;
$$;

create or replace function public.cobro_apply_social_advance(
  p_member_id uuid,
  p_payment_id uuid,
  p_cash numeric,
  p_schedule jsonb,
  p_paid date
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cash numeric := round(coalesce(p_cash, 0), 2);
  v_item jsonb;
  v_due date;
  v_due_text text;
  v_cap numeric;
  v_schedule jsonb := case
    when jsonb_typeof(p_schedule) = 'array' then p_schedule
    else '[]'::jsonb
  end;
begin
  if p_member_id is null or p_payment_id is null or v_cash <= 0.009 then
    return v_cash;
  end if;

  for v_item in
    select value
    from jsonb_array_elements(v_schedule)
    order by left(coalesce(value->>'dueOn', ''), 10)
  loop
    exit when v_cash <= 0.009;
    v_due_text := left(coalesce(v_item->>'dueOn', ''), 10);
    if v_due_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or v_due_text <= '1900-01-10' then
      continue;
    end if;
    if coalesce(v_item->>'capital', '') !~ '^[0-9]+(\.[0-9]+)?$' then
      continue;
    end if;
    v_due := v_due_text::date;
    if date_trunc('month', v_due) <= date_trunc('month', coalesce(p_paid, current_date)) then
      continue;
    end if;
    v_cap := round((v_item->>'capital')::numeric, 2);
    if v_cap <= 0.009 or v_cash + 0.01 < v_cap then
      continue;
    end if;
    if exists (
      select 1
      from public.member_dues_periods
      where member_id = p_member_id
        and due_on = v_due
        and capital_open > 0.009
    ) then
      continue;
    end if;
    if public.cobro_due_has_payment_evidence(p_member_id, v_due) then
      continue;
    end if;

    insert into public.member_dues_periods (member_id, due_on, capital, capital_open, late_base)
    values (p_member_id, v_due, v_cap, 0, 0)
    on conflict (member_id, due_on) do update
      set capital = excluded.capital,
          capital_open = 0,
          late_base = 0
      where public.member_dues_periods.capital_open <= 0;

    insert into public.dues_imputations (
      payment_id, member_id, due_on, capital, surcharge,
      capital_open, surcharge_open, late_base_taken, kind
    ) values (
      p_payment_id, p_member_id, v_due, v_cap, 0, 0, 0, 0, 'payment'
    );

    update public.members
    set meta = jsonb_set(
      coalesce(meta, '{}'::jsonb),
      '{prepaidSocialDueOns}',
      (
        select coalesce(jsonb_agg(to_jsonb(d) order by d), '[]'::jsonb)
        from (
          select distinct left(value, 10) as d
          from jsonb_array_elements_text(coalesce(meta->'prepaidSocialDueOns', '[]'::jsonb))
          where left(value, 10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          union
          select v_due_text
        ) q
      ),
      true
    )
    where id = p_member_id;

    v_cash := round(v_cash - v_cap, 2);
  end loop;

  update public.members
  set next_due_date = public.cobro_next_due_after_advance(id, next_due_date)
  where id = p_member_id;

  return v_cash;
end;
$$;

revoke all on function public.cobro_apply_social_advance(uuid, uuid, numeric, jsonb, date) from public;
revoke all on function public.cobro_next_due_after_advance(uuid, date) from public;
grant execute on function public.cobro_apply_social_advance(uuid, uuid, numeric, jsonb, date) to service_role;
grant execute on function public.cobro_next_due_after_advance(uuid, date) to service_role;

-- El imputer de la app reserva primero los meses futuros del schedule.
do $$
declare
  v_sql text;
  v_next text;
begin
  v_sql := replace(pg_get_functiondef('public.impute_dues_account_payment(uuid, uuid, numeric, jsonb, date, boolean)'::regprocedure), E'\r\n', E'\n');
  if position('cobro_apply_social_advance' in v_sql) > 0 then
    return;
  end if;
  v_next := replace(
    v_sql,
    $old$v_due := v_due_text::date;
      v_cap := least(round((v_item->>'capital')::numeric, 2), v_left);$old$,
    $new$v_due := v_due_text::date;
      if date_trunc('month', v_due) > date_trunc('month', coalesce(p_paid, current_date)) then
        continue;
      end if;
      v_cap := least(round((v_item->>'capital')::numeric, 2), v_left);$new$
  );
  if v_next = v_sql then
    raise exception 'No se encontró el alta de períodos del imputer.';
  end if;
  v_sql := v_next;
  v_next := replace(
    v_sql,
    $old$for v_period in
    select *
    from public.member_dues_periods$old$,
    $new$v_cash := public.cobro_apply_social_advance(
    p_member_id, p_payment_id, v_cash, v_schedule, p_paid
  );

  for v_period in
    select *
    from public.member_dues_periods$new$
  );
  if v_next = v_sql then
    raise exception 'No se encontró el ciclo de períodos abiertos del imputer.';
  end if;
  v_sql := v_next;
  if position('cobro_next_due_after_advance' in v_sql) = 0 then
    v_next := replace(
      v_sql,
      $old$return v_applied;$old$,
      $new$update public.members
  set next_due_date = public.cobro_next_due_after_advance(id, next_due_date)
  where id = p_member_id;

  return v_applied;$new$
    );
    if v_next = v_sql then
      raise exception 'No se encontró el retorno del imputer.';
    end if;
  end if;
  execute v_next;
end;
$$;

-- La app manda el importe completo: la parte exigible baja el saldo y el adelanto no.
do $$
declare
  v_sql text;
  v_next text;
begin
  v_sql := replace(pg_get_functiondef('public.member_payment_posts_dues()'::regprocedure), E'\r\n', E'\n');
  if position('least(new.amount, greatest(v_old, 0))' in v_sql) = 0 then
    return;
  end if;
  v_next := replace(
    v_sql,
    'case when v_scope = ''cuota_social'' then least(new.amount, greatest(v_old, 0)) else new.amount end',
    'new.amount'
  );
  if v_next = v_sql then
    raise exception 'No se encontró el tope de efectivo del trigger de cuotas.';
  end if;
  execute v_next;
end;
$$;

-- Un mes futuro explícito se puede cobrar junto con la deuda abierta. No lleva el 10 %.
do $$
declare
  v_sql text;
  v_next text;
begin
  v_sql := replace(pg_get_functiondef('public.cobro_assert_due_ons_collectable(uuid, jsonb, jsonb, numeric)'::regprocedure), E'\r\n', E'\n');
  if position('v_sum_advance' in v_sql) > 0 then
    return;
  end if;
  v_next := replace(
    v_sql,
    'v_sum_sched numeric := 0;',
    E'v_sum_sched numeric := 0;\n  v_sum_advance numeric := 0;'
  );
  if v_next = v_sql then
    raise exception 'No se encontró el acumulador del assert de cobro.';
  end if;
  v_sql := v_next;
  v_next := replace(
    v_sql,
    $old$if coalesce(v_other_open, 0) > 0 and not v_adelanto then
        raise exception
          'Ese período no es cobrable en este momento. No se sustituye por otro mes.';
      end if;
      if coalesce(v_other_open, 0) > 0 and v_adelanto then
        raise exception
          'Hay deuda exigible abierta; no se registra adelanto de otro período.';
      end if;$old$,
    $new$v_sched_cap := round(coalesce((
        select sum(round(coalesce(nullif(s.value->>'capital', '')::numeric, 0), 2))
        from jsonb_array_elements(coalesce(p_periodos->'schedule', '[]'::jsonb)) s
        where left(coalesce(s.value->>'dueOn', ''), 10) = v_due_text
      ), 0), 2);
      if date_trunc('month', v_due) > date_trunc('month', (timezone('America/Argentina/San_Juan', now()))::date) then
        if v_sched_cap <= 0.01 then
          raise exception 'Adelanto de cuota social: indique el capital del mes.';
        end if;
        v_sum_advance := round(v_sum_advance + v_sched_cap, 2);
      elsif coalesce(v_other_open, 0) > 0 and not v_adelanto then
        raise exception
          'Ese período no es cobrable en este momento. No se sustituye por otro mes.';
      elsif coalesce(v_other_open, 0) > 0 and v_adelanto then
        raise exception
          'Hay deuda exigible abierta; no se registra adelanto de otro período.';
      end if;$new$
  );
  if v_next = v_sql then
    raise exception 'No se encontró el rechazo de adelanto del assert de cobro.';
  end if;
  v_sql := v_next;
  v_next := replace(
    v_sql,
    $old$if v_sum_uncovered > 0.01 and p_importe is not null then
    declare
      v_allowed numeric;
    begin
      v_allowed := case
        when v_sum_sched > 0.01 then least(v_sum_sched, v_sum_uncovered)
        else v_sum_uncovered
      end;
      if round(p_importe, 2) > round(v_allowed * 1.10, 2) + 0.01 then$old$,
    $new$if (v_sum_uncovered > 0.01 or v_sum_advance > 0.01) and p_importe is not null then
    declare
      v_allowed numeric;
    begin
      v_allowed := case
        when v_sum_sched > 0.01 then least(v_sum_sched, v_sum_uncovered)
        else v_sum_uncovered
      end;
      v_allowed := round(v_allowed * 1.10, 2) + v_sum_advance;
      if round(p_importe, 2) > v_allowed + 0.01 then$new$
  );
  if v_next = v_sql then
    raise exception 'No se encontró el tope de importe del assert de cobro.';
  end if;
  -- El tope viejo multiplicaba al final. Ahora v_allowed ya incluye el 10 % y el adelanto.
  v_sql := replace(
    v_next,
    'if round(p_importe, 2) > v_allowed + 0.01 then
        raise exception
          ''El importe supera el capital exigible de los períodos solicitados.'';
      end if;',
    'if round(p_importe, 2) > v_allowed + 0.01 then
        raise exception
          ''El importe supera el capital exigible de los períodos solicitados.'';
      end if;'
  );
  execute v_next;
end;
$$;

-- Caja: el sobrante de un mes futuro del schedule queda pago en ese mes, no como crédito genérico.
do $$
declare
  v_sql text;
  v_next text;
begin
  v_sql := replace(pg_get_functiondef('public.registrar_cobro(uuid, numeric, jsonb, text)'::regprocedure), E'\r\n', E'\n');
  if position('cobro_apply_social_advance' in v_sql) > 0 then
    return;
  end if;
  v_next := replace(
    v_sql,
    $old$if round(v_cash, 2) > 0.01 then

    v_adelanto := true;$old$,
    $new$v_cash := public.cobro_apply_social_advance(
    p_member_id,
    v_payment.id,
    v_cash,
    coalesce(p_periodos->'schedule', '[]'::jsonb),
    v_paid
  );

  if round(v_cash, 2) > 0.01 then

    v_adelanto := true;$new$
  );
  if v_next = v_sql then
    raise exception 'No se encontró el sobrante de registrar_cobro.';
  end if;
  v_sql := v_next;
  v_next := replace(
    v_sql,
    'set next_due_date = coalesce(v_open_due, case when v_advance_due is not null and v_advance_due <= public.cobro_current_month_due(v_today) then v_advance_due else null end, v_next_due, next_due_date),',
    'set next_due_date = public.cobro_next_due_after_advance(p_member_id, coalesce(v_open_due, case when v_advance_due is not null and v_advance_due <= public.cobro_current_month_due(v_today) then v_advance_due else null end, v_next_due, next_due_date)),'
  );
  if v_next = v_sql then
    raise exception 'No se encontró el próximo vencimiento de registrar_cobro.';
  end if;
  v_sql := v_next;
  v_next := replace(
    v_sql,
    '''nextDueDate'', coalesce(v_open_due, v_next_due, v_member.next_due_date),',
    '''nextDueDate'', public.cobro_next_due_after_advance(p_member_id, coalesce(v_open_due, v_next_due, v_member.next_due_date)),'
  );
  if v_next = v_sql then
    raise exception 'No se encontró el vencimiento devuelto por registrar_cobro.';
  end if;
  execute v_next;
end;
$$;
