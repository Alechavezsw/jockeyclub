-- Un cobro de septiembre/octubre no puede inventar diciembre.
-- 1) Si hay meses marcados (dueOns), solo se imputa a esos.
-- 2) El sobrante no abre un mes que todavía no empezó.
-- 3) El period_label del recibo nombra los meses marcados, no el adelanto.

create or replace function public.cobro_current_month_due(p_today date)
returns date
language sql
immutable
as $$
  select (date_trunc('month', coalesce(p_today, current_date)))::date + 9;
$$;

revoke all on function public.cobro_current_month_due(date) from public, anon, authenticated;

do $patch$
declare
  v_sql text;
begin
  v_sql := pg_get_functiondef('public.registrar_cobro(uuid, numeric, jsonb, text)'::regprocedure);

  if position('cobro_filter_marked_months' in v_sql) = 0 then
    if position(
      $old$
    for v_period in
      select * from public.member_dues_periods
      where member_id = p_member_id and capital_open > 0
      order by due_on
      for update
$old$ in v_sql) = 0 then
      raise exception 'No está el loop de períodos abiertos';
    end if;
    v_sql := replace(
      v_sql,
      $old$
    for v_period in
      select * from public.member_dues_periods
      where member_id = p_member_id and capital_open > 0
      order by due_on
      for update
$old$,
      $new$
    -- cobro_filter_marked_months
    if cardinality(v_months) > 0 then
      for v_item in
        select value
        from jsonb_array_elements(public.cobro_schedule_or_months(
          coalesce(p_periodos->'schedule', '[]'::jsonb),
          v_due_ons, v_quota, v_surcharge, v_today, p_importe
        ))
        order by value->>'dueOn'
      loop
        v_due := left(coalesce(v_item->>'dueOn', ''), 10);
        if v_due !~ '^\d{4}-\d{2}-\d{2}$' then
          continue;
        end if;
        if to_char(v_due::date, 'YYYY-MM') <> all (v_months) then
          continue;
        end if;
        v_cap := round(coalesce((v_item->>'capital')::numeric, 0), 2);
        if v_cap <= 0 then
          continue;
        end if;
        v_late := round(coalesce((v_item->>'lateBase')::numeric, 0), 2);
        insert into public.member_dues_periods (member_id, due_on, capital, capital_open, late_base)
        values (p_member_id, v_due::date, v_cap, v_cap, greatest(v_late, 0))
        on conflict (member_id, due_on) do update
        set capital = greatest(public.member_dues_periods.capital, excluded.capital),
            capital_open = case
              when public.member_dues_periods.capital_open > 0 then public.member_dues_periods.capital_open
              else excluded.capital_open
            end,
            late_base = greatest(public.member_dues_periods.late_base, excluded.late_base);
      end loop;
    end if;
    for v_period in
      select * from public.member_dues_periods
      where member_id = p_member_id and capital_open > 0
        and (
          cardinality(v_months) = 0
          or due_on <= date '1900-01-10'
          or to_char(due_on, 'YYYY-MM') = any (v_months)
        )
      order by due_on
      for update
$new$
    );
  end if;

  if position('cobro_current_month_due(v_today)' in v_sql) = 0 then
    if position(
      $old$
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
$old$ in v_sql) = 0 then
      raise exception 'No está el insert de adelanto';
    end if;
    v_sql := replace(
      v_sql,
      $old$
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
$old$,
      $new$
    else
      v_advance_due := (date_trunc('month', v_last_due) + interval '1 month')::date + 9;
    end if;
    -- Hasta que no arranque el mes, nadie lo debe ni se adelanta a ese due.
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
$new$
    );
  end if;

  if position('cardinality(v_months) > 0 then (' in v_sql) = 0 then
    if position(
      $old$
  set period_label = coalesce((
        select string_agg(
          case when i.due_on <= date '1900-01-10' then 'Saldo anterior' else to_char(i.due_on, 'MM/YYYY') end,
          ', ' order by i.due_on)
        from public.dues_imputations i
        where i.payment_id = v_payment.id and i.voided_at is null
      ), period_label),
$old$ in v_sql) = 0 then
      raise exception 'No está el period_label del cobro';
    end if;
    v_sql := replace(
      v_sql,
      $old$
  set period_label = coalesce((
        select string_agg(
          case when i.due_on <= date '1900-01-10' then 'Saldo anterior' else to_char(i.due_on, 'MM/YYYY') end,
          ', ' order by i.due_on)
        from public.dues_imputations i
        where i.payment_id = v_payment.id and i.voided_at is null
      ), period_label),
$old$,
      $new$
  set period_label = coalesce(
        case when cardinality(v_months) > 0 then (
          select string_agg(to_char((m || '-01')::date, 'MM/YYYY'), ', ' order by m)
          from unnest(v_months) as m
        ) else null end,
        (
          select string_agg(
            case when i.due_on <= date '1900-01-10' then 'Saldo anterior' else to_char(i.due_on, 'MM/YYYY') end,
            ', ' order by i.due_on)
          from public.dues_imputations i
          where i.payment_id = v_payment.id and i.voided_at is null
            and coalesce(i.kind, 'cobro') is distinct from 'adelanto'
        ),
        period_label
      ),
$new$
    );
  end if;

  if position('v_advance_due <= public.cobro_current_month_due(v_today)' in v_sql) = 0 then
    v_sql := replace(
      v_sql,
      'next_due_date = coalesce(v_open_due, v_advance_due, v_next_due, next_due_date)',
      'next_due_date = coalesce(v_open_due, case when v_advance_due is not null and v_advance_due <= public.cobro_current_month_due(v_today) then v_advance_due else null end, v_next_due, next_due_date)'
    );
  end if;

  execute v_sql;
end
$patch$;
