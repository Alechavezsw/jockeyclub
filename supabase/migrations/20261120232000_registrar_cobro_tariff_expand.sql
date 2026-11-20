-- registrar_cobro: expand periods to schedule tariff, payable vs tariff capital,
-- clamp v_should, clear duesOpenPeriods when settled.
-- Redefine registrar_cobro from pg_get_functiondef + five targeted replacements.

create or replace function public.cobro_expand_periods_from_schedule(
  p_member_id uuid,
  p_schedule jsonb,
  p_months text[] default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_item jsonb;
  v_due text;
  v_cap numeric;
  v_late numeric;
begin
  if p_member_id is null then
    return;
  end if;
  if jsonb_typeof(coalesce(p_schedule, '[]'::jsonb)) <> 'array' then
    return;
  end if;

  for v_item in
    select value
    from jsonb_array_elements(coalesce(p_schedule, '[]'::jsonb))
    order by value->>'dueOn'
  loop
    v_due := left(coalesce(v_item->>'dueOn', ''), 10);
    if v_due !~ '^\d{4}-\d{2}-\d{2}$' then
      continue;
    end if;
    if p_months is not null
       and cardinality(p_months) > 0
       and to_char(v_due::date, 'YYYY-MM') <> all (p_months) then
      continue;
    end if;
    v_cap := round(coalesce((v_item->>'capital')::numeric, 0), 2);
    if v_cap <= 0 then
      continue;
    end if;
    v_late := round(coalesce((v_item->>'lateBase')::numeric, v_cap), 2);
    insert into public.member_dues_periods (member_id, due_on, capital, capital_open, late_base)
    values (p_member_id, v_due::date, v_cap, v_cap, greatest(v_late, 0))
    on conflict (member_id, due_on) do update
    set capital = greatest(public.member_dues_periods.capital, excluded.capital),
        capital_open = greatest(public.member_dues_periods.capital_open, excluded.capital_open),
        late_base = greatest(public.member_dues_periods.late_base, excluded.late_base);
  end loop;
end;
$fn$;

comment on function public.cobro_expand_periods_from_schedule(uuid, jsonb, text[]) is
  'Alinea member_dues_periods al schedule a tarifa; no deja meses abiertos por debajo del capital declarado.';

create or replace function public.cobro_schedule_tariff_capital(p_schedule jsonb)
returns numeric
language sql
stable
set search_path to 'public'
as $$
  select round(coalesce(sum((value->>'capital')::numeric), 0), 2)
  from jsonb_array_elements(case
    when jsonb_typeof(coalesce(p_schedule, '[]'::jsonb)) = 'array' then p_schedule
    else '[]'::jsonb
  end) as t(value)
  where coalesce((value->>'capital')::numeric, 0) > 0;
$$;

do $mig$
declare
  v_sql text;
  v_fn text := 'public.registrar_cobro(uuid, numeric, jsonb, text)';
begin
  v_sql := pg_get_functiondef(v_fn::regprocedure);

  if strpos(v_sql, 'cobro_schedule_tariff_capital') = 0 then
    v_sql := replace(
      v_sql,
      $o$  v_payable := round(
    greatest(v_old, 0)
    + greatest(
      v_surcharge_due,
      v_schedule_surcharge,
      coalesce(nullif(p_periodos->>'surcharge', '')::numeric, 0)
    ),
    2
  );$o$,
      $n$  v_payable := round(
    greatest(v_old, public.cobro_schedule_tariff_capital(coalesce(p_periodos->'schedule', '[]'::jsonb)), 0)
    + greatest(
      v_surcharge_due,
      v_schedule_surcharge,
      coalesce(nullif(p_periodos->>'surcharge', '')::numeric, 0)
    ),
    2
  );$n$
    );
  end if;

  if strpos(v_sql, 'capital_open = greatest(public.member_dues_periods.capital_open, excluded.capital_open)') = 0 then
    v_sql := replace(
      v_sql,
      $o$            capital_open = case
              when public.member_dues_periods.capital_open > 0 then public.member_dues_periods.capital_open
              else excluded.capital_open
            end,$o$,
      $n$            capital_open = greatest(public.member_dues_periods.capital_open, excluded.capital_open),$n$
    );
  end if;

  if strpos(v_sql, 'cobro_expand_periods_from_schedule') = 0
     or strpos(v_sql, 'case when cardinality(v_months) > 0 then v_months else null end') = 0 then
    v_sql := replace(
      v_sql,
      $o$    end if;
    for v_period in
      select * from public.member_dues_periods
      where member_id = p_member_id and capital_open > 0$o$,
      $n$    end if;

    perform public.cobro_expand_periods_from_schedule(
      p_member_id,
      public.cobro_schedule_or_months(
        coalesce(p_periodos->'schedule', '[]'::jsonb),
        v_due_ons, v_quota, v_surcharge, v_today, p_importe
      ),
      case when cardinality(v_months) > 0 then v_months else null end
    );

    for v_period in
      select * from public.member_dues_periods
      where member_id = p_member_id and capital_open > 0$n$
    );
  end if;

  if strpos(v_sql, 'v_should := greatest(0, v_should);') = 0 then
    v_sql := replace(
      v_sql,
      $o$    if v_baked > 0.01 and v_capital_paid + 0.01 >= round(v_old - v_baked, 2) then
      v_should := round(v_should - least(v_baked, greatest(v_should, 0)), 2);
    end if;
  else$o$,
      $n$    if v_baked > 0.01 and v_capital_paid + 0.01 >= round(v_old - v_baked, 2) then
      v_should := round(v_should - least(v_baked, greatest(v_should, 0)), 2);
    end if;
    v_should := greatest(0, v_should);
  else$n$
    );
  end if;

  if strpos(v_sql, '''duesOpenPeriods'', ''[]''::jsonb') = 0 then
    v_sql := replace(
      v_sql,
      $o$      meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('lastPaymentDate', to_char(v_paid, 'YYYY-MM-DD')) || case when v_baked > 0.01 and coalesce(v_should, 0) <= 0.01 then jsonb_build_object('unpaidCapital', 0, 'unpaidSurcharges', 0, 'unpaidInterest', 0, 'unallocatedBalance', 0) else '{}'::jsonb end$o$,
      $n$      meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('lastPaymentDate', to_char(v_paid, 'YYYY-MM-DD')) || case when v_baked > 0.01 and coalesce(v_should, 0) <= 0.01 then jsonb_build_object('unpaidCapital', 0, 'unpaidSurcharges', 0, 'unpaidInterest', 0, 'unallocatedBalance', 0) else '{}'::jsonb end || case when v_open_due is null then jsonb_build_object('duesOpenPeriods', '[]'::jsonb, 'unpaidCapital', 0) else '{}'::jsonb end$n$
    );
  end if;

  execute v_sql;
end;
$mig$;