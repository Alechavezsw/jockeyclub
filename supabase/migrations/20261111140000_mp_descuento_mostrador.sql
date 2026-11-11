-- Mercado Pago cobra el neto. El descuento de mostrador cierra el resto de la cuota
-- y entra a Descuentos sobre cuotas, igual que en caja.

do $patch$
declare
  def text;
  old text;
  new text;
begin
  select pg_get_functiondef('public.apply_mp_approved_payment(uuid,text,text,numeric)'::regprocedure)
    into def;

  if strpos(def, 'v_discount numeric') > 0 then
    return;
  end if;

  old := $old$
  v_slot text;
begin
$old$;
  if strpos(def, old) = 0 then
    raise exception 'No está la declaración de apply_mp_approved_payment';
  end if;
  new := $new$
  v_slot text;
  v_discount numeric(14, 2) := 0;
  v_cover numeric(14, 2);
  v_discount_account uuid;
begin
$new$;
  def := replace(def, old, new);

  old := $old$
  if v_amount <= 0 then
    raise exception 'Importe de Mercado Pago inválido.';
  end if;
$old$;
  if strpos(def, old) = 0 then
    raise exception 'No está el importe de Mercado Pago';
  end if;
  new := $new$
  if v_amount <= 0 then
    raise exception 'Importe de Mercado Pago inválido.';
  end if;

  v_discount := 0;
  if v_intent.kind in ('dues', 'subscription') then
    begin
      v_discount := round(coalesce(nullif(v_intent.meta->>'discount', ''), '0')::numeric, 2);
    exception when others then
      v_discount := 0;
    end;
    if v_discount < 0 then
      v_discount := 0;
    end if;
  end if;
  v_cover := round(v_amount + v_discount, 2);
$new$;
  def := replace(def, old, new);

  old := $old$
  insert into public.journal_lines (journal_entry_id, account_id, line_order, debit, credit, memo)
  values
    (v_entry, v_bank, 1, v_amount, 0, 'Mercado Pago'),
    (v_entry, v_income, 2, 0, v_amount, v_concept);
$old$;
  if strpos(def, old) = 0 then
    raise exception 'No está el asiento de Mercado Pago';
  end if;
  new := $new$
  if v_discount > 0 then
    select id into v_discount_account
    from public.chart_of_accounts
    where is_active is true and (code = '5.1.07' or name = 'Descuentos sobre cuotas')
    order by case when code = '5.1.07' then 0 else 1 end
    limit 1;
    if v_discount_account is null then
      raise exception 'Falta la cuenta Descuentos sobre cuotas.';
    end if;
    insert into public.journal_lines (journal_entry_id, account_id, line_order, debit, credit, memo)
    values
      (v_entry, v_bank, 1, v_amount, 0, 'Mercado Pago'),
      (v_entry, v_discount_account, 2, v_discount, 0, left('Descuento · ' || coalesce(nullif(btrim(v_intent.meta->>'discountDetail'), ''), 'mostrador'), 240)),
      (v_entry, v_income, 3, 0, v_cover, v_concept);
  else
    insert into public.journal_lines (journal_entry_id, account_id, line_order, debit, credit, memo)
    values
      (v_entry, v_bank, 1, v_amount, 0, 'Mercado Pago'),
      (v_entry, v_income, 2, 0, v_amount, v_concept);
  end if;
$new$;
  def := replace(def, old, new);

  old := $old$
      jsonb_build_object('mp_intent_id', v_intent.id, 'provider_payment_id', p_provider_payment_id)
    )
    returning id into v_payment;

    v_remaining := greatest(0, round(coalesce(v_member.outstanding_balance, 0) - v_amount, 2));
$old$;
  if strpos(def, old) = 0 then
    raise exception 'No está el cobro de cuota de Mercado Pago';
  end if;
  new := $new$
      jsonb_build_object(
        'mp_intent_id', v_intent.id,
        'provider_payment_id', p_provider_payment_id,
        'discount', case when v_discount > 0 then v_discount else null end,
        'discountDetail', case when v_discount > 0 then nullif(btrim(coalesce(v_intent.meta->>'discountDetail', '')), '') else null end
      )
    )
    returning id into v_payment;

    if v_discount > 0 then
      insert into public.member_dues_entries (member_id, amount, kind, source)
      values (v_member.id, round(-v_discount, 2), 'payment', 'discount:' || v_payment::text)
      on conflict (source) where source <> '' do nothing;
    end if;

    v_remaining := greatest(0, round(coalesce(v_member.outstanding_balance, 0) - v_cover, 2));
$new$;
  def := replace(def, old, new);

  execute def;
end;
$patch$;
