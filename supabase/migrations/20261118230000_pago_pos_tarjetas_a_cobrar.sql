-- Pago POS (tarjeta/pos) → Tarjetas a cobrar en pileta y saldo de reserva (igual que cuotas).

create or replace function public.record_pool_canon_impl(
  p_amount numeric,
  p_concept text,
  p_member_id uuid,
  p_date date,
  p_method text default 'efectivo',
  p_bank_journal text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_register public.cash_registers%rowtype;
  v_session public.cash_sessions%rowtype;
  v_income uuid;
  v_debit_account uuid;
  v_entry uuid;
  v_movement uuid;
  v_concept text;
  v_method text;
  v_bank text;
  v_memo text;
  v_needs_cash boolean;
  v_is_pos boolean;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not public.has_staff_access() then
    raise exception 'No tenés permiso para habilitar pileta.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Importe de canon inválido.';
  end if;

  v_method := lower(translate(btrim(coalesce(p_method, 'efectivo')),
    'ÁÉÍÓÚÜÑáéíóúüñ',
    'AEIOUUNaeiouun'));
  if v_method in ('caja', 'cash') then
    v_method := 'efectivo';
  end if;
  if v_method in ('pos', 'pago pos', 'card') then
    v_method := 'tarjeta';
  end if;
  if v_method not in ('efectivo', 'transferencia', 'tarjeta', 'debito') then
    raise exception 'Medio de pago inválido para canon de pileta.';
  end if;

  v_needs_cash := v_method = 'efectivo';
  v_is_pos := v_method = 'tarjeta';
  v_bank := nullif(btrim(coalesce(p_bank_journal, '')), '');

  select id into v_income
  from public.chart_of_accounts
  where is_active is true
    and (code = '4.1.02' or name = 'Reservas e Instalaciones')
  order by case when code = '4.1.02' then 0 else 1 end
  limit 1;

  if v_income is null then
    raise exception 'Falta la cuenta Reservas e Instalaciones en el plan.';
  end if;

  if v_needs_cash then
    select r.* into v_register
    from public.cash_registers r
    join public.chart_of_accounts a on a.id = r.account_id
    where r.is_active is true
      and (a.code = '1.1.01' or a.name = 'Caja General')
    order by case when a.code = '1.1.01' then 0 else 1 end, r.code
    limit 1;

    if v_register.id is null then
      raise exception 'No hay Caja General configurada.';
    end if;

    select * into v_session
    from public.cash_sessions
    where cash_register_id = v_register.id
      and status = 'open'
    limit 1;

    if v_session.id is null then
      raise exception 'Abrí la caja del día antes de habilitar.';
    end if;

    v_debit_account := v_register.account_id;
    v_memo := 'Caja General';
  elsif v_is_pos then
    if v_bank is null or v_bank = 'Caja General' then
      v_bank := 'Tarjetas a cobrar';
    end if;
    select id into v_debit_account
    from public.chart_of_accounts
    where is_active is true
      and (name = v_bank or code = '1.1.09')
    order by case when name = 'Tarjetas a cobrar' then 0 else 1 end, code
    limit 1;
    if v_debit_account is null then
      raise exception 'No está la cuenta Tarjetas a cobrar en el plan.';
    end if;
    v_memo := 'Tarjetas a cobrar';
  else
    if v_bank is null then
      v_bank := 'Banco Macro';
    end if;
    select id into v_debit_account
    from public.chart_of_accounts
    where is_active is true
      and name = v_bank
    order by code
    limit 1;
    if v_debit_account is null then
      raise exception 'No está la cuenta % en el plan.', v_bank;
    end if;
    v_memo := v_bank;
  end if;

  v_concept := left(coalesce(nullif(btrim(p_concept), ''), 'Canon pileta'), 240);

  insert into public.journal_entries (
    fiscal_period_id, entry_date, concept, status, source_module, created_by
  ) values (
    '11111111-1111-1111-1111-111111111111',
    coalesce(p_date, current_date),
    v_concept,
    'draft',
    'pileta',
    auth.uid()
  )
  returning id into v_entry;

  insert into public.journal_lines (journal_entry_id, account_id, line_order, debit, credit, memo)
  values
    (v_entry, v_debit_account, 1, p_amount, 0, v_memo),
    (v_entry, v_income, 2, 0, p_amount, 'Canon pileta');

  update public.journal_entries
  set status = 'posted',
      posted_at = now(),
      posted_by = auth.uid()
  where id = v_entry;

  if v_needs_cash then
    insert into public.cash_movements (
      cash_session_id, movement_type, amount, concept,
      related_account_id, member_id, created_by, journal_entry_id
    ) values (
      v_session.id, 'income', p_amount, v_concept,
      v_income, p_member_id, auth.uid(), v_entry
    )
    returning id into v_movement;
  end if;

  return jsonb_build_object(
    'journal_entry_id', v_entry,
    'cash_movement_id', v_movement,
    'cash_session_id', v_session.id,
    'payment_method', v_method,
    'bank_journal', case
      when v_needs_cash then null
      when v_is_pos then 'Tarjetas a cobrar'
      else v_bank
    end
  );
end;
$function$;

create or replace function public.completar_pago_reserva(
  p_id uuid,
  p_method text default 'efectivo'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.reservations%rowtype;
  v_method text;
  v_total numeric;
  v_deposit numeric;
  v_charged numeric;
  v_collected numeric;
  v_balance numeric;
  v_cash uuid;
  v_bank uuid;
  v_cards uuid;
  v_income uuid;
  v_debit uuid;
  v_period uuid;
  v_entry uuid;
  v_place text;
  v_concept text;
  v_memo text;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not public.has_staff_access() then
    raise exception 'Sin permiso para completar el pago de la reserva.';
  end if;
  if p_id is null then
    raise exception 'Reserva inválida.';
  end if;

  v_method := lower(coalesce(nullif(btrim(p_method), ''), 'efectivo'));
  if v_method in ('pos', 'pago pos', 'card') then
    v_method := 'tarjeta';
  end if;
  if v_method not in ('efectivo', 'caja', 'tarjeta', 'transferencia', 'mercadopago') then
    v_method := 'efectivo';
  end if;

  select * into v_row
  from public.reservations
  where id = p_id
  for update;

  if not found then
    raise exception 'No se encontró la reserva.';
  end if;
  if v_row.status = 'cancelled' then
    raise exception 'La reserva está anulada.';
  end if;

  v_total := round(coalesce(nullif(v_row.meta->>'estimatedPrice', '')::numeric, 0), 2);
  if v_total <= 0 then
    raise exception 'Esta reserva no tiene importe.';
  end if;
  v_deposit := round(coalesce(
    nullif(v_row.meta->>'depositAmount', '')::numeric,
    round(v_total * 0.5, 2)
  ), 2);
  v_charged := round(coalesce(nullif(v_row.meta->>'chargedPrice', '')::numeric, 0), 2);

  if coalesce(v_row.meta->>'paidInFull', '') in ('true', 't', '1')
     or v_charged + 0.5 >= v_total
     or coalesce(v_row.notes, '') ~* 'Pago:[[:space:]]*total alquiler' then
    return jsonb_build_object(
      'ok', true,
      'already', true,
      'reservationId', v_row.id,
      'total', v_total,
      'balance', 0,
      'chargedPrice', v_total
    );
  end if;

  if v_charged > 0 then
    v_collected := least(v_total, v_charged);
  elsif coalesce(v_row.meta->>'paymentMethod', '') <> '' and v_deposit > 0 then
    v_collected := least(v_total, v_deposit);
  else
    v_collected := 0;
  end if;
  v_balance := round(v_total - v_collected, 2);
  if v_balance <= 0.01 then
    return jsonb_build_object(
      'ok', true,
      'already', true,
      'reservationId', v_row.id,
      'total', v_total,
      'balance', 0,
      'chargedPrice', v_total
    );
  end if;

  select id into v_cash
  from public.chart_of_accounts
  where is_active is true and code = '1.1.01'
  limit 1;
  select id into v_bank
  from public.chart_of_accounts
  where is_active is true and code = '1.1.03'
  limit 1;
  select id into v_cards
  from public.chart_of_accounts
  where is_active is true and (code = '1.1.09' or name = 'Tarjetas a cobrar')
  order by case when code = '1.1.09' then 0 else 1 end
  limit 1;
  select id into v_income
  from public.chart_of_accounts
  where is_active is true and code = '4.1.02'
  limit 1;
  if v_method in ('transferencia', 'mercadopago') then
    v_debit := coalesce(v_bank, v_cash);
    v_memo := 'Banco';
  elsif v_method = 'tarjeta' then
    v_debit := coalesce(v_cards, v_cash);
    v_memo := 'Tarjetas a cobrar';
  else
    v_debit := v_cash;
    v_memo := 'Caja';
  end if;
  if v_debit is null or v_income is null then
    raise exception 'Faltan Caja General, Tarjetas a cobrar o Reservas e Instalaciones en el plan.';
  end if;

  select id into v_period
  from public.fiscal_periods
  where current_date between starts_on and ends_on
  order by starts_on desc
  limit 1;
  if v_period is null then
    select id into v_period from public.fiscal_periods order by starts_on desc limit 1;
  end if;
  if v_period is null then
    raise exception 'No hay ejercicio contable abierto.';
  end if;

  v_place := coalesce(nullif(btrim(v_row.meta->>'facilityName'), ''), v_row.facility_id);
  v_concept := left(
    'Saldo reserva · ' || v_place || ' · ' || to_char(v_row.reservation_date, 'YYYY-MM-DD')
    || ' ' || v_row.time_slot || ' · ' || coalesce(v_row.member_name, ''),
    240
  );

  insert into public.journal_entries (
    fiscal_period_id, entry_date, concept, status, source_module, source_id
  ) values (
    v_period, current_date, v_concept, 'draft', 'caja', v_row.id
  )
  returning id into v_entry;

  insert into public.journal_lines (journal_entry_id, account_id, line_order, debit, credit, memo)
  values
    (v_entry, v_debit, 1, v_balance, 0, v_memo),
    (v_entry, v_income, 2, 0, v_balance, v_concept);

  update public.journal_entries
  set status = 'posted', posted_at = now()
  where id = v_entry;

  update public.reservations
  set notes = case
        when coalesce(notes, '') ~* 'Pago:[[:space:]]*total alquiler' then notes
        else left(trim(both from coalesce(notes, '') || E'\nPago: total alquiler'), 2000)
      end,
      meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
        'chargedPrice', v_total,
        'paidInFull', true,
        'balancePaidAt', to_char(current_date, 'YYYY-MM-DD'),
        'balancePaymentMethod', v_method,
        'balanceAmount', v_balance,
        'balanceJournalId', v_entry
      ),
      updated_at = now()
  where id = v_row.id;

  return jsonb_build_object(
    'ok', true,
    'already', false,
    'reservationId', v_row.id,
    'total', v_total,
    'collectedBefore', v_collected,
    'balance', v_balance,
    'chargedPrice', v_total,
    'method', v_method,
    'journalEntryId', v_entry,
    'facilityName', v_place,
    'date', v_row.reservation_date,
    'time', v_row.time_slot,
    'memberNumber', v_row.member_number,
    'memberName', v_row.member_name
  );
end;
$function$;
