-- Anticipos: una sola imputación válida por peso.
--
-- Causa raíz (pre-fix): el sobrante se imputaba a un período futuro (adelanto)
-- Y además se insertaba member_dues_entries negativos → el mismo dinero figuraba
-- como cuota cubierta y como saldo a favor.
--
-- En prod ya corrió 20261123002137 (reconciliación histórica de créditos).
-- Este archivo NO reaplica esos ajustes de socios. Solo endurece registrar_cobro:
-- 1) Cuotas enteras del sobrante → solo dues_imputations kind=adelanto.
-- 2) Residual (< 1 tarifa) → solo crédito libre en member_dues_entries.
-- 3) Descuento administrativo no puede inflar el sobrante.
--
-- Idempotente: si el bloque nuevo ya está, no toca la función.
-- Revisar efectos antes de apply_migration en producción.

do $patch$
declare
  v_fn text := 'public.registrar_cobro(uuid, numeric, jsonb, text)';
  v_sql text;
  v_old text;
  v_new text;
begin
  v_sql := pg_get_functiondef(v_fn::regprocedure);

  if position('allocate_advance_cash_chunks' in v_sql) > 0
     or position('v_tariff numeric := 0;' in v_sql) > 0 then
    raise notice 'registrar_cobro ya reparte adelantos sin doble crédito.';
    return;
  end if;

  if position('v_discount numeric := 0;' in v_sql) = 0 then
    raise exception 'Ancla v_discount no encontrada en registrar_cobro; abortando.';
  end if;

  v_sql := replace(
    v_sql,
    'v_discount numeric := 0;',
    'v_discount numeric := 0;' || E'\n'
    || '  v_tariff numeric := 0;' || E'\n'
    || '  v_last_advance_due date;' || E'\n'
    || '  v_advance_take numeric := 0;'
  );

  v_old := $old$
  -- Un descuento administrativo no es efectivo ni puede generar saldo a favor.
  if v_discount > 0 then
    v_cash := least(v_cash, greatest(0, round(p_importe - v_capital_paid - greatest(0, v_surcharge_paid - v_discount), 2)));
  end if;

  if round(v_cash, 2) > 0.01 then

    v_adelanto := true;
    select max(due_on) into v_last_due
    from public.member_dues_periods
    where member_id = p_member_id
      and due_on > date '1900-01-10';
    if v_last_due is null then
      if extract(day from v_paid) <= 10 then
        v_advance_due := (date_trunc('month', v_paid))::date + 9;
      else
        v_advance_due := (date_trunc('month', v_paid) + interval '1 month')::date + 9;
      end if;
    else
      v_advance_due := (date_trunc('month', v_last_due) + interval '1 month')::date + 9;
    end if;
    if v_advance_due > public.cobro_current_month_due(v_today) then
      v_advance_due := null;
    else
      insert into public.dues_imputations (
        payment_id, member_id, due_on, capital, surcharge,
        capital_open, surcharge_open, late_base_taken, kind
      ) values (
        v_payment.id, p_member_id, v_advance_due,
        round(v_cash, 2), 0, 0, 0, 0, 'adelanto'
      );
    end if;
    -- Si se imputó el anticipo a un período, no registrar un segundo crédito libre.
    if v_advance_due is null then
      insert into public.member_dues_entries (member_id, amount, kind, source)
      values (p_member_id, round(-v_cash, 2), 'adelanto', 'adelanto:' || v_payment.id::text);
    end if;
    update public.member_payments
    set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
      'adelanto', true,
      'advanceDueOn', v_advance_due
    )
    where id = v_payment.id;
    v_cash := 0;
  end if;
$old$;

  v_new := $new$
  -- Un descuento administrativo no es efectivo ni puede generar saldo a favor.
  if v_discount > 0 then
    v_cash := least(v_cash, greatest(0, round(p_importe - v_capital_paid - greatest(0, v_surcharge_paid - v_discount), 2)));
  end if;

  -- allocate_advance_cash_chunks: cuotas enteras → imputación; residual → crédito libre.
  if round(v_cash, 2) > 0.01 then
    v_adelanto := true;
    select max(due_on) into v_last_due
    from public.member_dues_periods
    where member_id = p_member_id
      and due_on > date '1900-01-10';
    if v_last_due is null then
      if extract(day from v_paid) <= 10 then
        v_advance_due := (date_trunc('month', v_paid))::date + 9;
      else
        v_advance_due := (date_trunc('month', v_paid) + interval '1 month')::date + 9;
      end if;
    else
      v_advance_due := (date_trunc('month', v_last_due) + interval '1 month')::date + 9;
    end if;

    v_tariff := case
      when lower(coalesce(v_member.tier, '')) like '%individual%' then 40000
      when lower(coalesce(v_member.tier, '')) like '%familiar%' then 70000
      when lower(coalesce(v_member.tier, '')) like '%grupo%' then 70000
      else coalesce(
        (
          select round(p.capital, 2)
          from public.member_dues_periods p
          where p.member_id = p_member_id
            and p.due_on > date '1900-01-10'
          order by p.due_on desc
          limit 1
        ),
        70000
      )
    end;

    v_last_advance_due := null;
    while v_tariff > 0.01
      and v_advance_due is not null
      and round(v_cash, 2) + 0.01 >= v_tariff
    loop
      select coalesce(sum(i.capital), 0)
        into v_advance_take
      from public.dues_imputations i
      where i.member_id = p_member_id
        and i.due_on = v_advance_due
        and i.voided_at is null
        and coalesce(i.kind, 'cobro') in ('cobro', 'adelanto');

      if v_advance_take + 0.01 >= v_tariff then
        v_advance_due := (date_trunc('month', v_advance_due) + interval '1 month')::date + 9;
        continue;
      end if;

      v_advance_take := round(least(v_cash, v_tariff - v_advance_take), 2);
      if v_advance_take <= 0.01 then
        exit;
      end if;

      insert into public.dues_imputations (
        payment_id, member_id, due_on, capital, surcharge,
        capital_open, surcharge_open, late_base_taken, kind
      ) values (
        v_payment.id, p_member_id, v_advance_due,
        v_advance_take, 0, 0, 0, 0, 'adelanto'
      );
      v_last_advance_due := v_advance_due;
      v_cash := round(v_cash - v_advance_take, 2);
      v_advance_due := (date_trunc('month', v_advance_due) + interval '1 month')::date + 9;
    end loop;

    -- Solo el excedente real (menor a una cuota) queda como crédito libre.
    if round(v_cash, 2) > 0.01 then
      insert into public.member_dues_entries (member_id, amount, kind, source)
      values (
        p_member_id,
        round(-v_cash, 2),
        'adelanto',
        'adelanto:' || v_payment.id::text
      );
    end if;

    update public.member_payments
    set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
      'adelanto', true,
      'advanceDueOn', v_last_advance_due
    )
    where id = v_payment.id;
    v_cash := 0;
    v_advance_due := v_last_advance_due;
  end if;
$new$;

  -- Ancla alternativa: versión previa que insertaba imputación Y crédito libre juntos.
  if position(v_old in v_sql) = 0 then
    v_old := $old2$
  if round(v_cash, 2) > 0.01 then
    if not v_adelanto then
      raise exception 'El cobro supera la deuda. Para adelantar una cuota hay que marcarlo como adelanto.';
    end if;
    select max(due_on) into v_last_due
    from public.member_dues_periods
    where member_id = p_member_id
      and due_on > date '1900-01-10';
    if v_last_due is null then
      if extract(day from v_paid) <= 10 then
        v_advance_due := (date_trunc('month', v_paid))::date + 9;
      else
        v_advance_due := (date_trunc('month', v_paid) + interval '1 month')::date + 9;
      end if;
    else
      v_advance_due := (date_trunc('month', v_last_due) + interval '1 month')::date + 9;
    end if;
    insert into public.dues_imputations (
      payment_id, member_id, due_on, capital, surcharge,
      capital_open, surcharge_open, late_base_taken, kind
    ) values (
      v_payment.id, p_member_id, v_advance_due,
      round(v_cash, 2), 0, 0, 0, 0, 'adelanto'
    );
    insert into public.member_dues_entries (member_id, amount, kind, source)
    values (
      p_member_id,
      round(-v_cash, 2),
      'adelanto',
      'adelanto:' || v_payment.id::text
    );
    update public.member_payments
    set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
      'adelanto', true,
      'advanceDueOn', v_advance_due
    )
    where id = v_payment.id;
    v_cash := 0;
  end if;
$old2$;
  end if;

  if position(v_old in v_sql) = 0 then
    raise exception
      'Bloque de adelanto/descuento no coincide con el ancla esperado; abortando sin cambios.';
  end if;

  v_sql := replace(v_sql, v_old, v_new);
  execute v_sql;

  if position('allocate_advance_cash_chunks' in pg_get_functiondef(v_fn::regprocedure)) = 0 then
    raise exception 'No quedó el marcador allocate_advance_cash_chunks en registrar_cobro.';
  end if;
end;
$patch$;

revoke all on function public.registrar_cobro(uuid, numeric, jsonb, text) from public;
grant execute on function public.registrar_cobro(uuid, numeric, jsonb, text)
  to authenticated, service_role;
