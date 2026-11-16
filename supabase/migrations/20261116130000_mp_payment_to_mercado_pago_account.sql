-- Los cobros MP (cuota, pileta, reserva) debitan Mercado Pago (1.1.08), no Banco Nación/Macro.
do $$
declare
  v_sql text;
  v_new text;
begin
  v_sql := pg_get_functiondef('public.apply_mp_approved_payment(uuid, text, text, numeric)'::regprocedure);

  if v_sql is null then
    raise exception 'Falta apply_mp_approved_payment';
  end if;

  if v_sql like '%code = ''1.1.08''%' then
    raise notice 'apply_mp_approved_payment ya apunta a Mercado Pago';
    return;
  end if;

  v_new := replace(
    v_sql,
    $old$
  select id into v_bank
  from public.chart_of_accounts
  where is_active is true and (code = '1.1.03' or name = 'Banco Nación')
  order by case when code = '1.1.03' then 0 else 1 end
  limit 1;
$old$,
    $new$
  select id into v_bank
  from public.chart_of_accounts
  where is_active is true
    and (code = '1.1.08' or name = 'Mercado Pago' or code = '1.1.03' or name = 'Banco Macro')
  order by case
    when code = '1.1.08' or name = 'Mercado Pago' then 0
    when code = '1.1.03' or name = 'Banco Macro' then 1
    else 2
  end
  limit 1;
$new$
  );

  if v_new = v_sql then
    raise exception 'No se pudo reescribir el débito bancario de apply_mp_approved_payment';
  end if;

  execute v_new;
end $$;

do $$
declare
  v_sql text;
  v_new text;
begin
  v_sql := pg_get_functiondef('public.apply_mp_approved_payment(uuid, text, text, numeric)'::regprocedure);
  if position('Faltan las cuentas Banco Nación o de ingreso' in v_sql) = 0 then
    return;
  end if;
  v_new := replace(
    v_sql,
    'Faltan las cuentas Banco Nación o de ingreso en el plan.',
    'Faltan las cuentas Mercado Pago o de ingreso en el plan.'
  );
  if v_new <> v_sql then
    execute v_new;
  end if;
end $$;
