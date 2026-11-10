-- Si el importe supera lo adeudado, el cobro sigue como adelanto.
-- No se frena con el mensaje rojo del mostrador.

do $patch$
declare
  v_sql text;
  v_old_gate text := $o$
  if round(p_importe, 2) > v_payable + 0.01 and not v_adelanto then
    raise exception 'El cobro supera la deuda. Para adelantar una cuota hay que marcarlo como adelanto.';
  end if;
$o$;
  v_new_gate text := $n$
  if round(p_importe, 2) > v_payable + 0.01 then
    v_adelanto := true;
  end if;
$n$;
  v_old_cash text := $o$
    if not v_adelanto then
      raise exception 'El cobro supera la deuda. Para adelantar una cuota hay que marcarlo como adelanto.';
    end if;
$o$;
  v_new_cash text := $n$
    v_adelanto := true;
$n$;
begin
  v_sql := pg_get_functiondef('public.registrar_cobro(uuid, numeric, jsonb, text)'::regprocedure);

  if strpos(v_sql, 'El cobro supera la deuda') = 0 then
    return;
  end if;

  if strpos(v_sql, v_old_gate) > 0 then
    v_sql := replace(v_sql, v_old_gate, v_new_gate);
  end if;

  if strpos(v_sql, v_old_cash) > 0 then
    v_sql := replace(v_sql, v_old_cash, v_new_cash);
  end if;

  if strpos(v_sql, 'El cobro supera la deuda') > 0 then
    raise exception 'No se pudo quitar el freno de adelanto en registrar_cobro';
  end if;

  execute v_sql;
end
$patch$;
