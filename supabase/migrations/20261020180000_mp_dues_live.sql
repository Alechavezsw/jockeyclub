-- Prende Mercado Pago en el club y no acredita cuota a exentos.

insert into public.app_settings (key, value, updated_at)
values (
  'mercadopago',
  jsonb_build_object('enabled', true, 'posId', 'jcsj-caja'),
  now()
)
on conflict (key) do update
set
  value = coalesce(public.app_settings.value, '{}'::jsonb)
    || jsonb_build_object(
      'enabled', true,
      'posId', coalesce(nullif(public.app_settings.value->>'posId', ''), 'jcsj-caja')
    ),
  updated_at = now();

create unique index if not exists mp_intents_authorized_payment_uidx
  on public.mp_intents ((meta->>'authorized_payment_id'))
  where nullif(meta->>'authorized_payment_id', '') is not null;

create or replace function public.apply_mp_approved_payment(
  p_intent_id uuid,
  p_provider_payment_id text,
  p_status text,
  p_paid_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  v_concept text;
  v_due date;
begin
  v_status := lower(coalesce(nullif(btrim(p_status), ''), 'approved'));

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

  update public.mp_intents
  set status = case
        when v_status in ('approved', 'authorized', 'rejected', 'cancelled', 'in_process', 'pending')
          then v_status
        else status
      end,
      provider_payment_id = coalesce(nullif(p_provider_payment_id, ''), provider_payment_id),
      updated_at = now()
  where id = v_intent.id;

  if v_status not in ('approved', 'authorized') then
    return jsonb_build_object('ok', true, 'applied', false, 'status', v_status);
  end if;

  v_amount := round(coalesce(nullif(p_paid_amount, 0), v_intent.amount), 2);
  if v_amount <= 0 then
    raise exception 'Importe de Mercado Pago inválido.';
  end if;

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
  where is_active is true and (code = '1.1.03' or name = 'Banco Nación')
  order by case when code = '1.1.03' then 0 else 1 end
  limit 1;

  if v_intent.kind = 'pool' then
    select id into v_income
    from public.chart_of_accounts
    where is_active is true and (code = '4.1.02' or name = 'Reservas e Instalaciones')
    order by case when code = '4.1.02' then 0 else 1 end
    limit 1;
    v_concept := left(coalesce(nullif(btrim(v_intent.concept), ''), 'Canon pileta · Mercado Pago'), 240);
  else
    select id into v_income
    from public.chart_of_accounts
    where is_active is true and (code = '4.1.01' or name = 'Cuotas Sociales')
    order by case when code = '4.1.01' then 0 else 1 end
    limit 1;
    v_concept := left(coalesce(nullif(btrim(v_intent.concept), ''), 'Cuota social · Mercado Pago'), 240);
  end if;

  if v_bank is null or v_income is null then
    raise exception 'Faltan las cuentas Banco Nación o de ingreso en el plan.';
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

  insert into public.journal_entries (
    fiscal_period_id, entry_date, concept, status, source_module, source_id
  ) values (
    v_period,
    current_date,
    v_concept,
    'draft',
    case when v_intent.kind = 'pool' then 'pileta' else 'cuotas' end,
    v_intent.id
  )
  returning id into v_entry;

  insert into public.journal_lines (journal_entry_id, account_id, line_order, debit, credit, memo)
  values
    (v_entry, v_bank, 1, v_amount, 0, 'Mercado Pago'),
    (v_entry, v_income, 2, 0, v_amount, v_concept);

  update public.journal_entries
  set status = 'posted', posted_at = now()
  where id = v_entry;

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
  elsif v_intent.kind in ('dues', 'subscription') and v_member.id is not null then
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
      jsonb_build_object('mp_intent_id', v_intent.id, 'provider_payment_id', p_provider_payment_id)
    )
    returning id into v_payment;

    v_remaining := greatest(0, round(coalesce(v_member.outstanding_balance, 0) - v_amount, 2));
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
        'pool_access_id', v_access
      )
  where id = v_intent.id;

  return jsonb_build_object(
    'ok', true,
    'applied', true,
    'intent_id', v_intent.id,
    'journal_entry_id', v_entry
  );
end;
$$;
