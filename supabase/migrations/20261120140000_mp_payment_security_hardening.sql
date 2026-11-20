-- Endurece acreditación Mercado Pago:
-- 1) Solo status `approved` acredita dinero (authorized queda para adhesión vía apply_mp_subscription).
-- 2) Unique parcial sobre provider_payment_id.
-- 3) Rechaza moneda distinta de ARS y subpagos / importes desalineados.
-- 4) Reusa asiento contable existente por source_id (idempotencia ante fallo a mitad de camino).
-- 5) Mantiene EXECUTE solo en service_role.

create unique index if not exists mp_intents_provider_payment_id_uidx
  on public.mp_intents (provider_payment_id)
  where provider_payment_id is not null
    and btrim(provider_payment_id) <> '';

create unique index if not exists journal_entries_mp_intent_source_uidx
  on public.journal_entries (source_module, source_id)
  where source_id is not null
    and source_module in ('cuotas', 'pileta', 'reservas');

create or replace function public.apply_mp_approved_payment(
  p_intent_id uuid,
  p_provider_payment_id text,
  p_status text,
  p_paid_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_intent public.mp_intents%rowtype;
  v_member public.members%rowtype;
  v_status text;
  v_amount numeric(14, 2);
  v_remaining numeric(14, 2);
  v_bank uuid;
  v_income uuid;
  v_period uuid;
  v_entry uuid;
  v_payment uuid;
  v_access uuid;
  v_reservation uuid;
  v_concept text;
  v_due date;
  v_is_facility boolean;
  v_booking jsonb;
  v_facility text;
  v_date date;
  v_slot text;
  v_discount numeric(14, 2) := 0;
  v_cover numeric(14, 2);
  v_discount_account uuid;
  v_source_module text;
  v_other uuid;
  v_currency text;
begin
  v_status := lower(coalesce(nullif(btrim(p_status), ''), 'pending'));

  select * into v_intent
  from public.mp_intents
  where id = p_intent_id
  for update;

  if v_intent.id is null then
    raise exception 'No está el cobro de Mercado Pago.';
  end if;

  if v_intent.applied_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'intent_id', v_intent.id);
  end if;

  if nullif(btrim(p_provider_payment_id), '') is not null then
    select id into v_other
    from public.mp_intents
    where provider_payment_id = btrim(p_provider_payment_id)
      and id <> v_intent.id
      and applied_at is not null
    limit 1;
    if v_other is not null then
      return jsonb_build_object(
        'ok', true,
        'already', true,
        'reason', 'provider_payment_taken',
        'intent_id', v_other
      );
    end if;
  end if;

  update public.mp_intents
  set status = case
        when v_status in ('approved', 'authorized', 'rejected', 'cancelled', 'in_process', 'pending')
          then v_status
        else status
      end,
      provider_payment_id = coalesce(nullif(btrim(p_provider_payment_id), ''), provider_payment_id),
      updated_at = now()
  where id = v_intent.id;

  -- Solo `approved` acredita. `authorized` no implica captura en Payments API.
  if v_status <> 'approved' then
    return jsonb_build_object('ok', true, 'applied', false, 'status', v_status);
  end if;

  v_currency := upper(coalesce(nullif(btrim(v_intent.currency), ''), 'ARS'));
  if v_currency <> 'ARS' then
    raise exception 'Moneda de Mercado Pago inválida (%)', v_currency;
  end if;

  v_amount := round(coalesce(nullif(p_paid_amount, 0), v_intent.amount), 2);
  if v_amount <= 0 then
    raise exception 'Importe de Mercado Pago inválido.';
  end if;

  if abs(v_amount - round(v_intent.amount, 2)) > 0.05 then
    if v_amount < round(v_intent.amount, 2) - 0.05 then
      raise exception 'Importe acreditado menor al cobro declarado.';
    end if;
    if v_amount > round(v_intent.amount * 1.5, 2) + 0.05 then
      raise exception 'Importe acreditado no corresponde al cobro.';
    end if;
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

  if v_intent.member_id is not null then
    select * into v_member from public.members where id = v_intent.member_id;
  end if;

  if v_intent.kind in ('dues', 'subscription')
     and v_member.id is not null
     and public.member_is_dues_exempt(v_member) then
    update public.mp_intents
    set status = 'cancelled',
        updated_at = now(),
        meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('skipped', 'exempt')
    where id = v_intent.id;
    return jsonb_build_object('ok', true, 'applied', false, 'reason', 'exempt');
  end if;

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

  v_is_facility := v_intent.kind in ('pool', 'booking', 'reservation');
  v_source_module := case
    when v_intent.kind = 'pool' then 'pileta'
    when v_intent.kind in ('booking', 'reservation') then 'reservas'
    else 'cuotas'
  end;

  if v_is_facility then
    select id into v_income
    from public.chart_of_accounts
    where is_active is true and (code = '4.1.02' or name = 'Reservas e Instalaciones')
    order by case when code = '4.1.02' then 0 else 1 end
    limit 1;
    v_concept := left(coalesce(
      nullif(btrim(v_intent.concept), ''),
      case when v_intent.kind = 'pool' then 'Canon pileta · Mercado Pago' else 'Seña reserva · Mercado Pago' end
    ), 240);
  else
    select id into v_income
    from public.chart_of_accounts
    where is_active is true and (code = '4.1.01' or name = 'Cuotas Sociales')
    order by case when code = '4.1.01' then 0 else 1 end
    limit 1;
    v_concept := left(coalesce(nullif(btrim(v_intent.concept), ''), 'Cuota social · Mercado Pago'), 240);
  end if;

  if v_bank is null or v_income is null then
    raise exception 'Faltan las cuentas Mercado Pago o de ingreso en el plan.';
  end if;

  select id into v_period
  from public.fiscal_periods
  where current_date between starts_on and ends_on
  order by starts_on desc
  limit 1;

  if v_period is null then
    select id into v_period
    from public.fiscal_periods
    order by starts_on desc
    limit 1;
  end if;

  if v_period is null then
    raise exception 'No hay ejercicio contable abierto.';
  end if;

  select id into v_entry
  from public.journal_entries
  where source_module = v_source_module
    and source_id = v_intent.id
  limit 1;

  if v_entry is null then
    insert into public.journal_entries (
      fiscal_period_id, entry_date, concept, status, source_module, source_id
    ) values (
      v_period,
      current_date,
      v_concept,
      'draft',
      v_source_module,
      v_intent.id
    )
    returning id into v_entry;

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

    update public.journal_entries
    set status = 'posted', posted_at = now()
    where id = v_entry;
  end if;

  if v_intent.kind = 'pool' then
    select id into v_access
    from public.pool_accesses
    where meta->>'mp_intent_id' = v_intent.id::text
    limit 1;

    if v_access is null then
      insert into public.pool_accesses (
        access_date, kind, member_id, member_number, member_name,
        guest_name, host_member_number, payment_amount, payment_method,
        payment_concept, status, source, journal_entry_id, meta
      ) values (
        current_date,
        case when coalesce(v_intent.meta->>'guestName', '') <> '' then 'guest' else 'member' end,
        v_intent.member_id,
        v_intent.member_number,
        v_member.full_name,
        nullif(v_intent.meta->>'guestName', ''),
        case when coalesce(v_intent.meta->>'guestName', '') <> '' then v_intent.member_number else null end,
        v_amount,
        'mercadopago',
        v_concept,
        'active',
        'mercadopago',
        v_entry,
        jsonb_build_object('mp_intent_id', v_intent.id)
      )
      returning id into v_access;
    end if;
  elsif v_intent.kind in ('booking', 'reservation') then
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
    begin
      v_date := nullif(btrim(coalesce(v_booking->>'date', '')), '')::date;
    exception when others then
      v_date := null;
    end;
    v_slot := nullif(btrim(coalesce(v_booking->>'time', '')), '');

    select id into v_reservation
    from public.reservations
    where meta->>'mpIntentId' = v_intent.id::text
    limit 1;

    if v_reservation is null
       and coalesce(v_booking->>'settleBalance', '') not in ('true', 't', '1')
       and v_facility is not null
       and v_date is not null
       and v_slot is not null then
      begin
        insert into public.reservations (
          facility_id, member_id, member_number, member_name,
          reservation_date, time_slot, status, guests, notes, meta
        ) values (
          v_facility,
          v_intent.member_id,
          v_intent.member_number,
          coalesce(v_member.full_name, v_intent.member_number),
          v_date,
          v_slot,
          coalesce(nullif(btrim(v_booking->>'status'), ''), 'confirmed'),
          greatest(0, coalesce((v_booking->>'guests')::int, 0)),
          left(coalesce(v_booking->>'facilityName', '') || ' · seña MP', 240),
          jsonb_build_object(
            'mpIntentId', v_intent.id,
            'paymentMethod', 'mercadopago',
            'depositAmount', coalesce((v_booking->>'depositAmount')::numeric, v_amount),
            'estimatedPrice', nullif(v_booking->>'estimatedPrice', '')::numeric,
            'guestNames', nullif(v_booking->>'guestNames', ''),
            'endTime', nullif(v_booking->>'endTime', ''),
            'source', 'mercadopago_webhook'
          )
        )
        returning id into v_reservation;
      exception when unique_violation then
        select id into v_reservation
        from public.reservations
        where facility_id = v_facility
          and reservation_date = v_date
          and time_slot = v_slot
        limit 1;
        if v_reservation is not null then
          update public.reservations
          set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
            'mpIntentId', v_intent.id,
            'paymentMethod', 'mercadopago',
            'source', 'mercadopago_webhook'
          ),
          updated_at = now()
          where id = v_reservation;
        end if;
      end;
    end if;
  elsif v_intent.kind in ('dues', 'subscription') and v_member.id is not null then
    select id into v_payment
    from public.member_payments
    where meta->>'mp_intent_id' = v_intent.id::text
    limit 1;

    if v_payment is null then
      insert into public.member_payments (
        member_id, amount, paid_at, method, concept, period_label,
        receipt_number, journal_entry_id, meta
      ) values (
        v_member.id,
        v_amount,
        current_date,
        'mercadopago',
        v_concept,
        to_char(current_date, 'MM/YYYY'),
        'MP-' || substr(v_intent.id::text, 1, 8),
        v_entry,
        jsonb_build_object(
          'mp_intent_id', v_intent.id,
          'provider_payment_id', p_provider_payment_id,
          'discount', case when v_discount > 0 then v_discount else null end,
          'discountDetail', case when v_discount > 0 then nullif(btrim(coalesce(v_intent.meta->>'discountDetail', '')), '') else null end,
          'schedule', case when jsonb_typeof(v_intent.meta->'schedule') = 'array' then v_intent.meta->'schedule' else null end
        )
      )
      returning id into v_payment;
    end if;

    if v_discount > 0 then
      declare
        v_open numeric(14, 2);
        v_extra numeric(14, 2);
      begin
        v_open := greatest(0, round(coalesce(public.member_dues_balance(v_member.id), 0), 2));
        v_extra := least(v_open, v_discount);
        if v_extra > 0.009 then
          insert into public.member_dues_entries (member_id, amount, kind, source)
          values (v_member.id, round(-v_extra, 2), 'payment', 'discount:' || v_payment::text)
          on conflict (source) where source <> '' do nothing;
        end if;
      end;
    end if;

    v_remaining := greatest(0, round(coalesce(public.member_dues_balance(v_member.id), 0), 2));
    if v_remaining <= 0.01 then
      v_due := public.mp_next_dues_date(greatest(coalesce(v_member.next_due_date, current_date), current_date));
      update public.members
      set outstanding_balance = 0,
          overdue_since = null,
          next_due_date = v_due,
          meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('lastPaymentDate', current_date::text)
      where id = v_member.id;
    else
      update public.members
      set outstanding_balance = v_remaining,
          meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('lastPaymentDate', current_date::text)
      where id = v_member.id;
    end if;

    if v_intent.kind = 'subscription' then
      update public.members
      set payment_method = 'debito',
          meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('mpAdhesion', 'authorized')
      where id = v_member.id;
    end if;
  end if;

  update public.mp_intents
  set status = 'approved',
      applied_at = now(),
      updated_at = now(),
      meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
        'journal_entry_id', v_entry,
        'member_payment_id', v_payment,
        'pool_access_id', v_access,
        'reservation_id', v_reservation
      )
  where id = v_intent.id;

  return jsonb_build_object(
    'ok', true,
    'applied', true,
    'intent_id', v_intent.id,
    'journal_entry_id', v_entry,
    'reservation_id', v_reservation
  );
end;
$function$;

revoke all on function public.apply_mp_approved_payment(uuid, text, text, numeric) from public;
revoke all on function public.apply_mp_approved_payment(uuid, text, text, numeric) from anon;
revoke all on function public.apply_mp_approved_payment(uuid, text, text, numeric) from authenticated;
grant execute on function public.apply_mp_approved_payment(uuid, text, text, numeric) to service_role;

revoke all on function public.apply_mp_subscription(uuid, text, text) from public;
revoke all on function public.apply_mp_subscription(uuid, text, text) from anon;
revoke all on function public.apply_mp_subscription(uuid, text, text) from authenticated;
grant execute on function public.apply_mp_subscription(uuid, text, text) to service_role;
