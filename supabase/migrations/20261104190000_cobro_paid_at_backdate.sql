-- Cobro antedatado: el recargo se calcula con la fecha del servidor.
-- Un paidAt anterior solo lo pueden usar superadmin o contador, con motivo.

do $patch$
declare
  v_sql text;
  v_fn text := 'public.registrar_cobro(uuid, numeric, jsonb, text)';
  v_old_paid text := $old$v_paid := coalesce(nullif(left(coalesce(p_periodos->>'paidAt', ''), 10), '')::date, current_date);$old$;
  v_new_paid text := $new$v_today := (timezone('America/Argentina/Buenos_Aires', now()))::date;
  begin
    if coalesce(p_periodos->>'paidAt', '') ~ 'T' then
      v_paid := (timezone(
        'America/Argentina/Buenos_Aires',
        (p_periodos->>'paidAt')::timestamptz
      ))::date;
    else
      v_paid := nullif(left(coalesce(p_periodos->>'paidAt', ''), 10), '')::date;
    end if;
  exception when others then
    v_paid := null;
  end;
  v_paid := coalesce(v_paid, v_today);
  if v_paid > v_today then
    raise exception 'La fecha de cobro no puede ser futura.';
  end if;
  if v_paid < v_today then
    if not (
      public.user_has_role('superadmin')
      or public.user_has_role('accountant')
    ) then
      raise exception 'Solo superadmin o contador pueden antedatar el cobro.';
    end if;
    v_paid_reason := btrim(coalesce(
      p_periodos->>'paidAtReason',
      p_periodos->>'backdateReason',
      ''
    ));
    if char_length(v_paid_reason) < 8 then
      raise exception 'Falta el motivo del cobro antedatado (mínimo 8 caracteres).';
    end if;
  end if;$new$;
begin
  v_sql := pg_get_functiondef(v_fn::regprocedure);

  if position('v_today date;' in v_sql) = 0 then
    if position('v_last_due date;' in v_sql) > 0 then
      v_sql := replace(
        v_sql,
        'v_last_due date;',
        'v_last_due date;' || E'\n'
        || '  v_today date;' || E'\n'
        || '  v_paid_reason text;'
      );
    elsif position('v_adelanto boolean := false;' in v_sql) > 0 then
      v_sql := replace(
        v_sql,
        'v_adelanto boolean := false;',
        'v_adelanto boolean := false;' || E'\n'
        || '  v_today date;' || E'\n'
        || '  v_paid_reason text;'
      );
    else
      raise exception 'No se encontró dónde declarar v_today en registrar_cobro';
    end if;
  end if;

  if position(v_old_paid in v_sql) = 0 then
    if position('Solo superadmin o contador pueden antedatar el cobro.' in v_sql) = 0 then
      raise exception 'No se encontró la asignación de v_paid en registrar_cobro';
    end if;
  else
    v_sql := replace(v_sql, v_old_paid, v_new_paid);
  end if;

  -- Recargo siempre con la fecha del servidor, no con paidAt.
  v_sql := replace(
    v_sql,
    'when v_paid > due_on and due_on > date ''1900-01-10''',
    'when v_today > due_on and due_on > date ''1900-01-10'''
  );
  v_sql := replace(
    v_sql,
    'when v_paid > v_period.due_on and v_period.due_on > date ''1900-01-10''',
    'when v_today > v_period.due_on and v_period.due_on > date ''1900-01-10'''
  );

  -- Guardar el motivo en meta si vino.
  if position('''paidAtReason'', v_paid_reason' in v_sql) = 0 then
    if position('''paymentSplits'', p_periodos->''paymentSplits''' in v_sql) = 0 then
      raise exception 'No se encontró el armado de meta en registrar_cobro';
    end if;
    v_sql := replace(
      v_sql,
      '''paymentSplits'', p_periodos->''paymentSplits''',
      '''paymentSplits'', p_periodos->''paymentSplits'',' || E'\n'
      || '    ''paidAtReason'', nullif(v_paid_reason, ''''),' || E'\n'
      || '    ''paidAtServerDate'', to_char(v_today, ''YYYY-MM-DD'')'
    );
  end if;

  execute v_sql;
end;
$patch$;
