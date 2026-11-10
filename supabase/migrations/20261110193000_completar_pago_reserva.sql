-- Completar el saldo de una reserva confirmada.
-- El cobro del resto queda en caja y la reserva queda saldada.
-- Mercado Pago del saldo actualiza esa reserva y no abre otro turno.

create or replace function public.completar_pago_reserva(
  p_id uuid,
  p_method text default 'efectivo'
) returns jsonb
language plpgsql
security definer
set search_path = public
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
  v_income uuid;
  v_debit uuid;
  v_period uuid;
  v_entry uuid;
  v_place text;
  v_concept text;
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
  select id into v_income
  from public.chart_of_accounts
  where is_active is true and code = '4.1.02'
  limit 1;
  v_debit := case
    when v_method in ('transferencia', 'mercadopago') then coalesce(v_bank, v_cash)
    else v_cash
  end;
  if v_debit is null or v_income is null then
    raise exception 'Faltan Caja General o Reservas e Instalaciones en el plan.';
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
    (v_entry, v_debit, 1, v_balance, 0, case when v_method in ('transferencia', 'mercadopago') then 'Banco' else 'Caja' end),
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

revoke all on function public.completar_pago_reserva(uuid, text) from public, anon;
grant execute on function public.completar_pago_reserva(uuid, text) to authenticated;

do $patch$
declare
  def text;
  old text;
  new text;
begin
  select pg_get_functiondef('public.apply_mp_approved_payment(uuid,text,text,numeric)'::regprocedure)
    into def;

  if strpos(def, 'settleBalance') > 0 then
    return;
  end if;

  old := $old$
    v_booking := coalesce(v_intent.meta->'booking', '{}'::jsonb);
    v_facility := nullif(btrim(coalesce(v_booking->>'facilityId', '')), '');
$old$;
  if strpos(def, old) = 0 then
    raise exception 'No está el alta de reserva de Mercado Pago';
  end if;

  new := $new$
    v_booking := coalesce(v_intent.meta->'booking', '{}'::jsonb);
    if coalesce(v_booking->>'settleBalance', '') in ('true', 't', '1')
       and nullif(btrim(coalesce(v_booking->>'reservationId', '')), '') is not null then
      update public.reservations
      set notes = case
            when coalesce(notes, '') ~* 'Pago:[[:space:]]*total alquiler' then notes
            else left(trim(both from coalesce(notes, '') || E'\nPago: total alquiler'), 2000)
          end,
          meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
            'chargedPrice', coalesce(
              nullif(meta->>'estimatedPrice', '')::numeric,
              round(coalesce(nullif(meta->>'depositAmount', '')::numeric, 0) + v_amount, 2)
            ),
            'paidInFull', true,
            'balancePaidAt', to_char(current_date, 'YYYY-MM-DD'),
            'balancePaymentMethod', 'mercadopago',
            'balanceMpIntentId', v_intent.id,
            'balanceAmount', v_amount
          ),
          updated_at = now()
      where id = (v_booking->>'reservationId')::uuid
      returning id into v_reservation;
    end if;
    v_facility := nullif(btrim(coalesce(v_booking->>'facilityId', '')), '');
$new$;
  def := replace(def, old, new);

  old := $old$
    if v_reservation is null
       and v_facility is not null
$old$;
  new := $new$
    if v_reservation is null
       and coalesce(v_booking->>'settleBalance', '') not in ('true', 't', '1')
       and v_facility is not null
$new$;
  if strpos(def, old) = 0 then
    raise exception 'No está el control para no duplicar la reserva';
  end if;
  execute replace(def, old, new);
end
$patch$;
