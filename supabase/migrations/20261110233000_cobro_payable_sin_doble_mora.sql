-- El tope del cobro suma una sola capa de mora (10 %), no dos.
-- Así capital + interés cierran la cuenta; solo el sobrante real es adelanto.

do $patch$
declare
  v_sql text;
  v_old text := $o$v_payable := round(greatest(v_old, 0) + v_surcharge_due + greatest(v_schedule_surcharge, coalesce(nullif(p_periodos->>'surcharge', '')::numeric, 0)), 2);$o$;
  v_new text := $n$v_payable := round(
    greatest(v_old, 0)
    + greatest(
      v_surcharge_due,
      v_schedule_surcharge,
      coalesce(nullif(p_periodos->>'surcharge', '')::numeric, 0)
    ),
    2
  );$n$;
begin
  v_sql := pg_get_functiondef('public.registrar_cobro(uuid, numeric, jsonb, text)'::regprocedure);
  if strpos(v_sql, 'greatest(v_surcharge_due,') > 0
     or strpos(v_sql, 'greatest(\n      v_surcharge_due') > 0 then
    return;
  end if;
  if strpos(v_sql, v_old) = 0 then
    -- Formato multilínea por migraciones previas.
    v_old := 'v_payable := round(greatest(v_old, 0) + v_surcharge_due + greatest(v_schedule_surcharge, coalesce(nullif(p_periodos->>''surcharge'', '''')::numeric, 0)), 2);';
    if strpos(v_sql, v_old) = 0 then
      raise exception 'No está el tope de mora de registrar_cobro';
    end if;
  end if;
  v_sql := replace(v_sql, v_old, v_new);
  if strpos(v_sql, 'greatest(v_surcharge_due') = 0
     and strpos(v_sql, 'greatest(\n      v_surcharge_due') = 0 then
    raise exception 'No se pudo unificar la mora del tope';
  end if;
  execute v_sql;
end
$patch$;
