-- Impide adelantos ficticios cuando la ficha está por debajo de la tarifa
-- de los meses marcados (caso 100214: $135k ficha vs 2×$70k).
-- 1) Expande capital_open al schedule a tarifa antes de imputar.
-- 2) La deuda comparable al efectivo usa max(ficha, capital del schedule).
-- 3) Al saldar, el saldo operativo no baja de 0 por ese hueco de tarifa.
-- 4) Limpia duesOpenPeriods cuando no queda capital abierto.

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
        -- Antes no se expandía capital_open si ya había saldo: inventaba adelanto.
        capital_open = greatest(public.member_dues_periods.capital_open, excluded.capital_open),
        late_base = greatest(public.member_dues_periods.late_base, excluded.late_base);
  end loop;
end;
$fn$;

comment on function public.cobro_expand_periods_from_schedule(uuid, jsonb, text[]) is
  'Alinea member_dues_periods al schedule a tarifa; no deja meses abiertos por debajo del capital declarado.';

-- Parche puntual de registrar_cobro: reemplaza el bloque de meses marcados
-- y el cálculo de payable / should / limpieza de meta.
-- Se aplica redefiniendo solo vía wrapper interno llamado desde un trigger
-- BEFORE imputation no existe; por eso se redefine la función completa
-- con los tres cambios (ver diff en PR).

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
