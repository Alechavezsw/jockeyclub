-- Asienta en caja/banco la seña o el total al confirmar una reserva (no MP ni cuenta corriente).

create or replace function public.registrar_cobro_inicial_reserva(p_id uuid)
returns jsonb
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
  v_amount numeric;
  v_cash uuid;
  v_bank uuid;
  v_income uuid;
  v_debit uuid;
  v_period uuid;
  v_entry uuid;
  v_place text;
  v_concept text;
  v_scope text;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not public.has_staff_access() then
    raise exception 'Sin permiso para registrar el cobro de la reserva.';
  end if;
  if p_id is null then
    raise exception 'Reserva inválida.';
  end if;

  select * into v_row
  from public.reservations
  where id = p_id
  for update;

  if not found then
    raise exception 'No se encontró la reserva.';
  end if;
  if coalesce(v_row.meta->>'depositJournalId', '') <> '' then
    return jsonb_build_object(
      'ok', true,
      'already', true,
      'journalEntryId', v_row.meta->>'depositJournalId'
    );
  end if;

  v_method := lower(coalesce(nullif(btrim(v_row.meta->>'paymentMethod'), ''), ''));
  if v_method in ('', 'cuenta_corriente', 'cuenta', 'mercadopago', 'mp') then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'method');
  end if;
  if coalesce(v_row.meta->>'rentalWaived', '') in ('true', 't', '1') then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'waived');
  end if;

  v_total := round(coalesce(nullif(v_row.meta->>'estimatedPrice', '')::numeric, 0), 2);
  v_deposit := round(coalesce(
    nullif(v_row.meta->>'depositAmount', '')::numeric,
    case when v_total > 0 then round(v_total * 0.5, 2) else 0 end
  ), 2);
  v_charged := round(coalesce(nullif(v_row.meta->>'chargedPrice', '')::numeric, 0), 2);

  -- Si ya hay asiento del saldo, solo falta la seña (no repetir el total).
  if coalesce(v_row.meta->>'balanceJournalId', '') <> '' then
    v_amount := v_deposit;
    if v_amount <= 0 and v_charged > 0 then
      v_amount := round(
        v_charged - coalesce(nullif(v_row.meta->>'balanceAmount', '')::numeric, 0),
        2
      );
    end if;
  elsif v_charged > 0 then
    v_amount := least(v_total, v_charged);
  elsif v_method <> '' and v_deposit > 0 then
    v_amount := least(v_total, v_deposit);
  else
    v_amount := 0;
  end if;

  if v_amount <= 0.01 then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'amount');
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
    when v_method in ('transferencia', 'transfer') then coalesce(v_bank, v_cash)
    else v_cash
  end;
  if v_debit is null or v_income is null then
    raise exception 'Faltan Caja General / Banco o Reservas e Instalaciones en el plan.';
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
  v_scope := case
    when v_total > 0 and v_amount + 0.5 >= v_total then 'total'
    else 'deposit'
  end;
  v_concept := left(
    case
      when v_scope = 'total' then 'Confirmación · Reserva · '
      else 'Confirmación · Seña reserva · '
    end
    || v_place
    || ' · ' || to_char(v_row.reservation_date, 'YYYY-MM-DD')
    || ' ' || v_row.time_slot
    || ' · ' || coalesce(v_row.member_name, ''),
    240
  );

  insert into public.journal_entries (
    fiscal_period_id, entry_date, concept, status, source_module, source_id
  ) values (
    v_period, coalesce(v_row.created_at::date, current_date), v_concept, 'draft', 'reservas', v_row.id
  )
  returning id into v_entry;

  insert into public.journal_lines (journal_entry_id, account_id, line_order, debit, credit, memo)
  values
    (v_entry, v_debit, 1, v_amount, 0, case when v_method in ('transferencia', 'transfer') then 'Banco' else 'Caja' end),
    (v_entry, v_income, 2, 0, v_amount, v_concept);

  update public.journal_entries
  set status = 'posted', posted_at = now()
  where id = v_entry;

  update public.reservations
  set meta = coalesce(meta, '{}'::jsonb)
        || jsonb_build_object('depositJournalId', v_entry)
        || case
             when v_scope = 'total' then jsonb_build_object('cashJournalId', v_entry)
             else '{}'::jsonb
           end,
      updated_at = now()
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'already', false,
    'reservationId', v_row.id,
    'amount', v_amount,
    'method', v_method,
    'scope', v_scope,
    'journalEntryId', v_entry,
    'concept', v_concept
  );
end;
$function$;

revoke all on function public.registrar_cobro_inicial_reserva(uuid) from public, anon;
grant execute on function public.registrar_cobro_inicial_reserva(uuid) to authenticated;
