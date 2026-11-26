-- Abono de tenis ya regularizado en el libro (pending = 0) no se vuelve a cobrar.
-- Un remanente solo admite ese saldo. No crea pagos ni toca la categoría.

create or replace function public.cobro_reject_settled_tennis(
  p_member_id uuid,
  p_due date,
  p_capital numeric,
  p_importe numeric
) returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_number text;
  v_count int := 0;
  v_pending numeric := 0;
begin
  if p_member_id is null or p_due is null then
    return;
  end if;

  select member_number into v_number
  from public.members
  where id = p_member_id;
  if v_number is null then
    return;
  end if;

  select count(*)::int, round(coalesce(sum(pending), 0), 2)
    into v_count, v_pending
  from public.fee_ledger_lines
  where member_number = v_number
    and line_date >= date_trunc('month', p_due)::date
    and line_date < (date_trunc('month', p_due) + interval '1 month')::date
    and type_label ilike '%abono tenis%';

  if coalesce(v_count, 0) = 0 then
    return;
  end if;

  if coalesce(v_pending, 0) <= 0.01 then
    raise exception 'Ese abono de tenis ya está regularizado y no se puede volver a cobrar.';
  end if;

  if round(coalesce(p_capital, 0), 2) > v_pending + 0.01 then
    raise exception 'El abono de tenis pedido (%) supera el remanente (%).', p_capital, v_pending;
  end if;

  if round(coalesce(p_capital, 0), 2) <= 0.01
     and round(coalesce(p_importe, 0), 2) > v_pending + 0.01 then
    raise exception 'El abono de tenis pedido (%) supera el remanente (%).', p_importe, v_pending;
  end if;
end;
$$;

do $$
declare
  v_sql text;
  v_nl text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef('public.cobro_assert_due_ons_collectable(uuid, jsonb, jsonb, numeric)'::regprocedure)
    into v_sql;
  if strpos(v_sql, 'cobro_reject_settled_tennis') > 0 then
    return;
  end if;
  v_nl := case when strpos(v_sql, chr(13) || chr(10)) > 0 then chr(13) || chr(10) else chr(10) end;
  v_old := '    if public.cobro_due_already_paid(p_member_id, v_due) then' || v_nl
    || '      raise exception' || v_nl
    || '        ''Ese período ya está pago y no se puede volver a cobrar.'';' || v_nl
    || '    end if;';
  v_new := v_old || v_nl
    || '    perform public.cobro_reject_settled_tennis(' || v_nl
    || '      p_member_id,' || v_nl
    || '      v_due,' || v_nl
    || '      coalesce((' || v_nl
    || '        select round(coalesce(sum(coalesce(nullif(s.value->>''capital'', '''')::numeric, 0)), 0), 2)' || v_nl
    || '        from jsonb_array_elements(coalesce(p_periodos->''schedule'', ''[]''::jsonb)) s' || v_nl
    || '        where left(coalesce(s.value->>''dueOn'', ''''), 10) = v_due_text' || v_nl
    || '      ), 0),' || v_nl
    || '      p_importe' || v_nl
    || '    );';
  if strpos(v_sql, v_old) = 0 then
    raise exception 'No se encontró el ancla de cobro_due_already_paid.';
  end if;
  v_sql := replace(v_sql, v_old, v_new);
  if strpos(v_sql, 'cobro_reject_settled_tennis') = 0 then
    raise exception 'No se pudo actualizar la validación de cobro del abono de tenis.';
  end if;
  execute v_sql;
end $$;
