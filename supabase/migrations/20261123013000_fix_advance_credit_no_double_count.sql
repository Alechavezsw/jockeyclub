-- Anticipos: una sola imputación válida por peso.
--
-- Causa raíz: el sobrante se imputaba a un período futuro Y además entraba
-- como crédito libre en member_dues_entries.
--
-- Prod ya reconcilió históricos (20261123002137). Este archivo NO toca
-- filas de auditoría ni vuelve a aplicar ajustes de socios.
--
-- Corrección permanente en registrar_cobro:
-- 1) Cuotas enteras del sobrante → solo dues_imputations kind=adelanto (sin 10%).
-- 2) Residual (< 1 tarifa efectiva) → solo crédito libre.
-- 3) Descuento administrativo no infla el sobrante.
-- 4) WHILE acotado (máx. 24), fechas válidas, períodos ya cubiertos se saltan.
-- 5) Tarifa = cobro_social_advance_tariff (exentos / AMET / schedule / período).
--
-- Idempotente. Revisar antes de apply en producción.

create or replace function public.cobro_social_advance_tariff(
  p_member public.members,
  p_due date default null,
  p_schedule jsonb default '[]'::jsonb
)
returns numeric
language plpgsql
stable
set search_path = public
as $fn$
declare
  v_due date := coalesce(p_due, public.cobro_current_month_due(coalesce(public.club_today(), current_date)));
  v_from_sched numeric := 0;
  v_from_period numeric := 0;
  v_tier text := lower(coalesce(p_member.tier::text, ''));
begin
  if public.member_is_dues_exempt(p_member) then
    return 0;
  end if;

  -- Capital del schedule para ese dueOn, sin tenis.
  select round(coalesce(sum((value->>'capital')::numeric), 0), 2)
    into v_from_sched
  from jsonb_array_elements(
    case
      when jsonb_typeof(coalesce(p_schedule, '[]'::jsonb)) = 'array' then p_schedule
      else '[]'::jsonb
    end
  ) as t(value)
  where left(coalesce(value->>'dueOn', ''), 10) = to_char(v_due, 'YYYY-MM-DD')
    and coalesce((value->>'capital')::numeric, 0) > 0
    and coalesce(value->>'tierId', value->>'tier', value->>'chargeScope', '')
      !~* 'abono_tenis|tenis|addon';

  if coalesce(v_from_sched, 0) > 0.01 then
    return v_from_sched;
  end if;

  select round(p.capital, 2)
    into v_from_period
  from public.member_dues_periods p
  where p.member_id = p_member.id
    and p.due_on > date '1900-01-10'
  order by p.due_on desc
  limit 1;

  if coalesce(v_from_period, 0) > 0.01 then
    return v_from_period;
  end if;

  -- Meta de ficha: cuota social efectiva (convenio / override), nunca tenis.
  if coalesce((p_member.meta->>'duesAmount')::numeric, 0) > 0.01 then
    return round((p_member.meta->>'duesAmount')::numeric, 2);
  end if;
  if coalesce((p_member.meta->>'monthlyDues')::numeric, 0) > 0.01 then
    return round((p_member.meta->>'monthlyDues')::numeric, 2);
  end if;
  if coalesce((p_member.meta->>'socialQuota')::numeric, 0) > 0.01 then
    return round((p_member.meta->>'socialQuota')::numeric, 2);
  end if;

  -- AMET: tarifa neta (base − 2,5 %). Sin mora.
  if public.member_is_amet_dues(p_member) then
    if v_tier like '%individual%' then
      return 39000;
    end if;
    return 68250;
  end if;

  -- Fallback de categoría social (sin tenis). Exentos ya salieron arriba.
  if v_tier like '%individual%' then
    return 40000;
  end if;
  if v_tier ~ '(familiar|grupo)' then
    return 70000;
  end if;

  return 70000;
end;
$fn$;

revoke all on function public.cobro_social_advance_tariff(public.members, date, jsonb) from public;
grant execute on function public.cobro_social_advance_tariff(public.members, date, jsonb)
  to authenticated, service_role;

do $patch$
declare
  v_fn text := 'public.registrar_cobro(uuid, numeric, jsonb, text)';
  v_sql text;
  v_old text;
  v_new text;
begin
  v_sql := pg_get_functiondef(v_fn::regprocedure);

  if position('allocate_advance_cash_chunks_v2' in v_sql) > 0 then
    raise notice 'registrar_cobro ya reparte adelantos (v2).';
    return;
  end if;

  if position('v_discount numeric := 0;' in v_sql) = 0 then
    raise exception 'Ancla v_discount no encontrada en registrar_cobro; abortando.';
  end if;

  -- Quitar declare viejo incompleto si un patch previo lo dejó a medias.
  if position('v_tariff numeric := 0;' in v_sql) = 0 then
    v_sql := replace(
      v_sql,
      'v_discount numeric := 0;',
      'v_discount numeric := 0;' || E'\n'
      || '  v_tariff numeric := 0;' || E'\n'
      || '  v_last_advance_due date;' || E'\n'
      || '  v_advance_take numeric := 0;' || E'\n'
      || '  v_advance_loops int := 0;' || E'\n'
      || '  v_due_day int := 10;'
    );
  elsif position('v_advance_loops int := 0;' in v_sql) = 0 then
    v_sql := replace(
      v_sql,
      'v_tariff numeric := 0;',
      'v_tariff numeric := 0;' || E'\n'
      || '  v_last_advance_due date;' || E'\n'
      || '  v_advance_take numeric := 0;' || E'\n'
      || '  v_advance_loops int := 0;' || E'\n'
      || '  v_due_day int := 10;'
    );
  end if;

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

  -- allocate_advance_cash_chunks_v2: cuotas enteras → imputación (sin 10%); residual → crédito libre.
  if round(v_cash, 2) > 0.01 then
    v_adelanto := true;
    v_due_day := case when public.member_is_amet_dues(v_member) then 18 else 10 end;
    select max(due_on) into v_last_due
    from public.member_dues_periods
    where member_id = p_member_id
      and due_on > date '1900-01-10';
    if v_last_due is null then
      if extract(day from v_paid) <= v_due_day then
        v_advance_due := (date_trunc('month', v_paid))::date + (v_due_day - 1);
      else
        v_advance_due := (date_trunc('month', v_paid) + interval '1 month')::date + (v_due_day - 1);
      end if;
    else
      v_advance_due := (date_trunc('month', v_last_due) + interval '1 month')::date + (v_due_day - 1);
    end if;

    if v_advance_due is null or v_advance_due <= date '1900-01-10' then
      insert into public.member_dues_entries (member_id, amount, kind, source)
      values (p_member_id, round(-v_cash, 2), 'adelanto', 'adelanto:' || v_payment.id::text);
      v_cash := 0;
    else
      v_last_advance_due := null;
      v_advance_loops := 0;
      while round(v_cash, 2) > 0.01 and v_advance_loops < 24 loop
        v_advance_loops := v_advance_loops + 1;
        if v_advance_due is null or v_advance_due <= date '1900-01-10' then
          exit;
        end if;

        v_tariff := public.cobro_social_advance_tariff(
          v_member,
          v_advance_due,
          coalesce(p_periodos->'schedule', '[]'::jsonb)
        );
        if v_tariff <= 0.01 then
          exit;
        end if;

        select coalesce(sum(i.capital), 0)
          into v_advance_take
        from public.dues_imputations i
        where i.member_id = p_member_id
          and i.due_on = v_advance_due
          and i.voided_at is null
          and coalesce(i.kind, 'cobro') in ('cobro', 'adelanto');

        if v_advance_take + 0.01 >= v_tariff then
          v_advance_due := (date_trunc('month', v_advance_due) + interval '1 month')::date + (v_due_day - 1);
          continue;
        end if;

        -- Solo cuota entera (sin recargo). Residual < tarifa → crédito libre.
        if round(v_cash, 2) + 0.01 < round(v_tariff - v_advance_take, 2) then
          exit;
        end if;

        v_advance_take := round(v_tariff - v_advance_take, 2);
        insert into public.dues_imputations (
          payment_id, member_id, due_on, capital, surcharge,
          capital_open, surcharge_open, late_base_taken, kind
        ) values (
          v_payment.id, p_member_id, v_advance_due,
          v_advance_take, 0, 0, 0, 0, 'adelanto'
        );
        v_last_advance_due := v_advance_due;
        v_cash := round(v_cash - v_advance_take, 2);
        v_advance_due := (date_trunc('month', v_advance_due) + interval '1 month')::date + (v_due_day - 1);
      end loop;

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
  end if;
$new$;

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

  if position('allocate_advance_cash_chunks_v2' in pg_get_functiondef(v_fn::regprocedure)) = 0 then
    raise exception 'No quedó el marcador allocate_advance_cash_chunks_v2 en registrar_cobro.';
  end if;
end;
$patch$;

revoke all on function public.registrar_cobro(uuid, numeric, jsonb, text) from public;
grant execute on function public.registrar_cobro(uuid, numeric, jsonb, text)
  to authenticated, service_role;
