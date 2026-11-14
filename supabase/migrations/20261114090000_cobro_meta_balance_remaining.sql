-- Guarda en el meta del cobro cuánto queda de deuda / a favor (recibo a cuenta).
do $mig$
declare
  v_sql text;
  v_fn text := 'public.registrar_cobro(uuid, numeric, jsonb, text)';
  v_old text := $o$'balanceBefore', nullif(p_periodos->>'balanceBefore', '')::numeric,$o$;
  v_new text := $n$'balanceBefore', nullif(p_periodos->>'balanceBefore', '')::numeric,
    'balanceRemaining', nullif(p_periodos->>'balanceRemaining', '')::numeric,
    'creditLeftover', nullif(p_periodos->>'creditLeftover', '')::numeric,
    'methodLabel', nullif(btrim(coalesce(p_periodos->>'methodLabel', '')), ''),$n$;
begin
  v_sql := pg_get_functiondef(v_fn::regprocedure);
  if strpos(v_sql, '''balanceRemaining''') > 0 then
    raise notice 'balanceRemaining ya está en registrar_cobro';
    return;
  end if;
  if strpos(v_sql, v_old) = 0 then
    raise exception 'No se encontró balanceBefore en registrar_cobro';
  end if;
  v_sql := replace(v_sql, v_old, v_new);
  execute v_sql;
  if position('''balanceRemaining''' in pg_get_functiondef(v_fn::regprocedure)) = 0 then
    raise exception 'No se pudo agregar balanceRemaining a registrar_cobro';
  end if;
end;
$mig$;
