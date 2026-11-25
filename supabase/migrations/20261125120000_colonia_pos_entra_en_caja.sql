-- La cuota de Colonia cobrada con Pago POS entra en la Caja General del día.
-- La financiación (modalidad A) sigue en Tarjetas a cobrar y no suma el efectivo.

do $patch$
declare
  def text := pg_get_functiondef('public.colonia_post_treasury(uuid,boolean)'::regprocedure);
  patched text := def;
  fin_old text := $old$
      update public.journal_lines
      set debit = round(debit + v_fin, 2)
      where journal_entry_id = v_entry
        and line_order = 1;
      insert into public.journal_lines (journal_entry_id, account_id, line_order, debit, credit, memo)
      values (v_entry, v_fin_account, 3, 0, v_fin, 'Financiación tarjeta');$old$;
  fin_new text := $new$
      declare
        v_card uuid;
      begin
        select id into v_card
        from public.chart_of_accounts
        where is_active is true
          and (code = '1.1.09' or name = 'Tarjetas a cobrar')
        order by case when code = '1.1.09' then 0 else 1 end
        limit 1;
        if v_card is null then
          raise exception 'No está la cuenta Tarjetas a cobrar en el plan.';
        end if;
        insert into public.journal_lines (journal_entry_id, account_id, line_order, debit, credit, memo)
        values
          (v_entry, v_card, 3, v_fin, 0, 'Tarjetas a cobrar'),
          (v_entry, v_fin_account, 4, 0, v_fin, 'Financiación tarjeta');
      end;$new$;
begin
  if position('v_method in (''efectivo'', ''tarjeta'')' in patched) = 0 then
    patched := replace(
      patched,
      'v_needs_cash := v_method = ''efectivo'';',
      'v_needs_cash := v_method in (''efectivo'', ''tarjeta'');'
    );
    patched := replace(
      patched,
      'Abrí la caja del día antes de cobrar Colonia en efectivo.',
      'Abrí la caja del día antes de cobrar Colonia.'
    );
    patched := replace(
      patched,
      'v_memo := ''Caja General'';',
      'v_memo := case when v_method = ''tarjeta'' then ''Pago POS · Caja General'' else ''Caja General'' end;'
    );
  end if;
  if position(fin_old in patched) > 0 then
    patched := replace(patched, fin_old, fin_new);
  end if;
  if patched = def then
    return;
  end if;
  if position('v_method in (''efectivo'', ''tarjeta'')' in patched) = 0 then
    raise exception 'No pude mandar la cuota con tarjeta a la caja.';
  end if;
  execute patched;
end
$patch$;

notify pgrst, 'reload schema';
