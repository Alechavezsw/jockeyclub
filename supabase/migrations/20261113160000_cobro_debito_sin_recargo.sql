-- Débito (caja / Galicia / automático): el cobro es solo capital.
-- No se suma ni se imputa el 10 % de mora. No es waivedSurcharge.

create or replace function public.dues_method_skips_surcharge(p_method text)
returns boolean
language sql
immutable
as $$
  with n as (
    select lower(regexp_replace(
      translate(btrim(coalesce(p_method, '')),
        'ÁÉÍÓÚÜÑáéíóúüñ_-',
        'AEIOUUNaeiouun  '),
      '\s+', ' ', 'g'
    )) as m
  )
  select case
    when m = '' then false
    when m in ('debito', 'debito automatico', 'galicia') then true
    when m like '%debito automatico%'
      or m like '%debito galicia%'
      or m like '%debito bancario%' then true
    else false
  end
  from n;
$$;

comment on function public.dues_method_skips_surcharge(text) is
  'Medios débito: cobran solo capital de cuota (sin 10 % de mora).';

do $patch$
declare
  v_sql text;
  v_old_pay text := $o$v_payable := round(
    greatest(v_old, 0)
    + greatest(
      v_surcharge_due,
      v_schedule_surcharge,
      coalesce(nullif(p_periodos->>'surcharge', '')::numeric, 0)
    ),
    2
  );$o$;
  v_new_pay text := $n$if public.dues_method_skips_surcharge(v_method)
     or coalesce(p_periodos->>'skipSurcharge', '') in ('true', 't', '1') then
    v_surcharge_due := 0;
    v_schedule_surcharge := 0;
    v_surcharge := 0;
  end if;

  v_payable := round(
    greatest(v_old, 0)
    + greatest(
      v_surcharge_due,
      v_schedule_surcharge,
      coalesce(nullif(p_periodos->>'surcharge', '')::numeric, 0)
    ),
    2
  );$n$;
  v_old_open text := $o$v_surcharge_open := case
        when v_today > v_period.due_on and v_period.due_on > date '1900-01-10'
          then round(coalesce(nullif(v_period.late_base, 0), case when v_period.due_on >= date '2026-10-10' then v_period.capital_open else 0 end) * 0.10, 2) /* Desde octubre la cuota abierta también lleva 10 */
        else 0
      end;$o$;
  v_new_open text := $n$v_surcharge_open := case
        when public.dues_method_skips_surcharge(v_method)
          or coalesce(p_periodos->>'skipSurcharge', '') in ('true', 't', '1') then 0
        when v_today > v_period.due_on and v_period.due_on > date '1900-01-10'
          then round(coalesce(nullif(v_period.late_base, 0), case when v_period.due_on >= date '2026-10-10' then v_period.capital_open else 0 end) * 0.10, 2) /* Desde octubre la cuota abierta también lleva 10 */
        else 0
      end;$n$;
begin
  if to_regprocedure('public.registrar_cobro(uuid, numeric, jsonb, text)') is null then
    raise exception 'Falta registrar_cobro';
  end if;

  v_sql := pg_get_functiondef('public.registrar_cobro(uuid, numeric, jsonb, text)'::regprocedure);

  if strpos(v_sql, 'dues_method_skips_surcharge(v_method)') > 0 then
    return;
  end if;

  if strpos(v_sql, v_old_pay) = 0 then
    raise exception 'No está el tope payable de registrar_cobro para débito sin recargo';
  end if;
  v_sql := replace(v_sql, v_old_pay, v_new_pay);

  if strpos(v_sql, v_old_open) = 0 then
    raise exception 'No está la imputación de mora de registrar_cobro para débito sin recargo';
  end if;
  v_sql := replace(v_sql, v_old_open, v_new_open);

  if strpos(v_sql, 'dues_method_skips_surcharge(v_method)') = 0 then
    raise exception 'No se pudo aplicar débito sin recargo en registrar_cobro';
  end if;

  execute v_sql;
end
$patch$;
