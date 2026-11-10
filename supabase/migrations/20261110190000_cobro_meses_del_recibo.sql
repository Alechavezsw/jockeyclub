-- Si el navegador manda el saldo entero en 1900-01-10 pero el recibo
-- nombra meses reales, el interés no tiene donde sentarse y el cobro
-- se rechaza como adelanto. Se arman esos meses cuando el capital se
-- reparte parejo y el 10 % declarado coincide.

create or replace function public.cobro_schedule_or_months(
  p_schedule jsonb,
  p_due_ons jsonb,
  p_quota numeric,
  p_surcharge numeric,
  p_today date,
  p_importe numeric
) returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_real int;
  v_dates text[] := '{}';
  v_due text;
  v_item jsonb;
  v_n int;
  v_cap numeric;
  v_interest numeric := 0;
  v_out jsonb := '[]'::jsonb;
begin
  select count(*) into v_real
  from jsonb_array_elements(coalesce(p_schedule, '[]'::jsonb)) e
  where left(coalesce(e.value->>'dueOn', ''), 10) > '1900-01-10';
  if v_real > 0 then
    return coalesce(p_schedule, '[]'::jsonb);
  end if;

  if coalesce(p_quota, 0) <= 0 or coalesce(p_surcharge, 0) < 0 then
    return coalesce(p_schedule, '[]'::jsonb);
  end if;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_due_ons, '[]'::jsonb))
  loop
    v_due := left(coalesce(
      v_item->>'dueOn',
      v_item->>'date',
      trim(both '"' from v_item::text)
    ), 10);
    if v_due ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       and v_due > '1900-01-10'
       and not v_due = any (v_dates) then
      v_dates := array_append(v_dates, v_due);
    end if;
  end loop;

  v_n := cardinality(v_dates);
  if v_n < 1 or v_n > 18 then
    return coalesce(p_schedule, '[]'::jsonb);
  end if;

  v_cap := round(p_quota / v_n, 2);
  if abs(round(v_cap * v_n, 2) - round(p_quota, 2)) > 0.01 then
    return coalesce(p_schedule, '[]'::jsonb);
  end if;

  select coalesce(sum(round(v_cap * 0.10, 2)), 0) into v_interest
  from unnest(v_dates) d
  where p_today > d::date;

  if abs(v_interest - round(coalesce(p_surcharge, 0), 2)) > 0.01 then
    return coalesce(p_schedule, '[]'::jsonb);
  end if;
  if abs(round(coalesce(p_importe, 0), 2) - round(p_quota + coalesce(p_surcharge, 0), 2)) > 0.01 then
    return coalesce(p_schedule, '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'dueOn', d,
    'capital', v_cap,
    'lateBase', case
      when p_today > d::date and coalesce(p_surcharge, 0) > 0 then v_cap
      else 0
    end
  ) order by d), '[]'::jsonb)
  into v_out
  from unnest(v_dates) d;

  return v_out;
end;
$$;

revoke all on function public.cobro_schedule_or_months(jsonb, jsonb, numeric, numeric, date, numeric) from public, anon, authenticated;

do $patch$
declare
  def text;
  old text;
  new text;
begin
  select pg_get_functiondef('public.registrar_cobro(uuid,numeric,jsonb,text)'::regprocedure)
    into def;

  old := $old$
    v_left := v_old;
    for v_item in
      select value
      from jsonb_array_elements(coalesce(p_periodos->'schedule', '[]'::jsonb))
      order by value->>'dueOn'
    loop
      exit when v_left <= 0;
$old$;

  if strpos(def, old) = 0 then
    if strpos(def, 'cobro_schedule_or_months') > 0 then
      return;
    end if;
    raise exception 'No está el loop de schedule para imputar los meses del recibo';
  end if;

  new := $new$
    v_left := v_old;
    if coalesce(v_baked, 0) <= 0.01
       and coalesce(v_quota, 0) > 0
       and v_old > coalesce(v_quota, 0)
       and round(v_old - v_quota, 2) <= round(coalesce(v_surcharge, 0), 2) + 0.01
       and public.cobro_schedule_or_months(
         coalesce(p_periodos->'schedule', '[]'::jsonb),
         v_due_ons, v_quota, v_surcharge, v_today, p_importe
       ) is distinct from coalesce(p_periodos->'schedule', '[]'::jsonb) then
      v_baked := round(v_old - v_quota, 2);
    end if;
    for v_item in
      select value
      from jsonb_array_elements(public.cobro_schedule_or_months(
        coalesce(p_periodos->'schedule', '[]'::jsonb),
        v_due_ons, v_quota, v_surcharge, v_today, p_importe
      ))
      order by value->>'dueOn'
    loop
      exit when v_left <= 0;
$new$;

  execute replace(def, old, new);
end
$patch$;
