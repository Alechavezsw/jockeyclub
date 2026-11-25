-- Cobro confirmado de Colonia: asiento y, si es efectivo, movimiento de la caja del dia.
-- Haber 4.1.06 Colonia de Verano. No toca cuota social ni outstanding_balance.
-- Efectivo: Caja General 1.1.01. Tarjeta/POS: Tarjetas a cobrar 1.1.09.
-- Transferencia y débito: Banco Macro 1.1.03. Mercado Pago sigue sin acreditarse.

insert into public.chart_of_accounts (
  id, code, name, account_type, parent_id, level, is_postable, is_cash_account, is_active
)
select
  'aaaaaaaa-0004-0004-0004-000000000116',
  '4.1.06',
  'Colonia de Verano',
  'income',
  parent_id,
  3,
  true,
  false,
  true
from public.chart_of_accounts
where code = '4.1.01'
limit 1
on conflict (code) do update
set
  name = excluded.name,
  account_type = excluded.account_type,
  is_postable = true,
  is_active = true;

alter table public.colonia_payments
  add column if not exists journal_entry_id uuid references public.journal_entries (id),
  add column if not exists cash_movement_id uuid references public.cash_movements (id);

create or replace function public.colonia_post_treasury(
  p_payment_id uuid,
  p_require_open_cash boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.colonia_payments;
  v_student_name text;
  v_member uuid;
  v_period uuid;
  v_income uuid;
  v_register public.cash_registers%rowtype;
  v_session public.cash_sessions%rowtype;
  v_debit uuid;
  v_entry uuid;
  v_movement uuid;
  v_actor uuid;
  v_method text;
  v_memo text;
  v_concept text;
  v_needs_cash boolean;
  v_day date;
begin
  perform set_config('jc.colonia_tx', 'on', true);

  select * into v_pay
  from public.colonia_payments
  where id = p_payment_id
  for update;
  if not found then
    raise exception 'Pago de Colonia no encontrado.';
  end if;
  if v_pay.status is distinct from 'confirmed' then
    return jsonb_build_object('ok', true, 'skipped', true, 'payment', to_jsonb(v_pay));
  end if;
  if v_pay.method = 'mercadopago' then
    raise exception 'Mercado Pago Colonia aún no está habilitado. No se asienta.';
  end if;

  if v_pay.journal_entry_id is not null then
    return jsonb_build_object(
      'ok', true,
      'already', true,
      'payment', to_jsonb(v_pay),
      'journal_entry_id', v_pay.journal_entry_id,
      'cash_movement_id', v_pay.cash_movement_id
    );
  end if;

  select e.id into v_entry
  from public.journal_entries e
  where e.source_module = 'colonia'
    and e.source_id = v_pay.id
    and e.voided_at is null
  limit 1;
  if v_entry is not null then
    update public.colonia_payments
    set journal_entry_id = v_entry
    where id = v_pay.id
    returning * into v_pay;
    return jsonb_build_object(
      'ok', true,
      'already', true,
      'payment', to_jsonb(v_pay),
      'journal_entry_id', v_entry
    );
  end if;

  v_method := lower(btrim(coalesce(v_pay.method, '')));
  if v_method in ('pos', 'pago pos', 'card') then
    v_method := 'tarjeta';
  end if;
  v_needs_cash := v_method = 'efectivo';

  select s.full_name, s.member_id
    into v_student_name, v_member
  from public.colonia_students s
  where s.id = v_pay.student_id;
  if v_member is not null and not exists (select 1 from public.members m where m.id = v_member) then
    v_member := null;
  end if;

  select id into v_income
  from public.chart_of_accounts
  where is_active is true
    and code = '4.1.06'
  limit 1;
  if v_income is null then
    raise exception 'Falta la cuenta Colonia de Verano (4.1.06) en el plan.';
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
    if v_session.id is null and coalesce(p_require_open_cash, true) then
      raise exception 'Abrí la caja del día antes de cobrar Colonia en efectivo.';
    end if;
    v_debit := v_register.account_id;
    v_memo := 'Caja General';
  elsif v_method in ('tarjeta', 'pos') then
    select id into v_debit
    from public.chart_of_accounts
    where is_active is true
      and (code = '1.1.09' or name = 'Tarjetas a cobrar')
    order by case when code = '1.1.09' then 0 else 1 end
    limit 1;
    if v_debit is null then
      raise exception 'No está la cuenta Tarjetas a cobrar en el plan.';
    end if;
    v_memo := 'Tarjetas a cobrar';
  elsif v_method in ('transferencia', 'debito') then
    select id into v_debit
    from public.chart_of_accounts
    where is_active is true
      and (code = '1.1.03' or name = 'Banco Macro')
    order by case when code = '1.1.03' then 0 else 1 end
    limit 1;
    if v_debit is null then
      raise exception 'No está la cuenta Banco Macro en el plan.';
    end if;
    v_memo := 'Banco Macro';
  else
    raise exception 'Medio de Colonia sin cuenta de tesorería.';
  end if;

  v_day := (timezone('America/Argentina/Buenos_Aires', coalesce(v_pay.confirmed_at, now())))::date;
  select id into v_period
  from public.fiscal_periods
  where is_closed is not true
    and v_day between starts_on and ends_on
  order by starts_on desc
  limit 1;
  if v_period is null then
    select id into v_period
    from public.fiscal_periods
    where id = '11111111-1111-1111-1111-111111111111'
      and is_closed is not true;
  end if;
  if v_period is null then
    raise exception 'No hay período fiscal abierto para asentar Colonia.';
  end if;

  v_concept := left(
    'Colonia de Verano'
      || case when nullif(btrim(coalesce(v_student_name, '')), '') is null then '' else ' · ' || btrim(v_student_name) end
      || ' · ' || v_memo,
    240
  );

  v_actor := auth.uid();
  if v_actor is not null and not exists (select 1 from public.profiles p where p.id = v_actor) then
    v_actor := null;
  end if;

  insert into public.journal_entries (
    fiscal_period_id, entry_date, concept, reference, status, source_module, source_id, created_by
  ) values (
    v_period,
    v_day,
    v_concept,
    v_pay.id::text,
    'draft',
    'colonia',
    v_pay.id,
    v_actor
  )
  returning id into v_entry;

  insert into public.journal_lines (journal_entry_id, account_id, line_order, debit, credit, memo)
  values
    (v_entry, v_debit, 1, v_pay.amount, 0, v_memo),
    (v_entry, v_income, 2, 0, v_pay.amount, 'Colonia de Verano');

  update public.journal_entries
  set status = 'posted',
      posted_at = now(),
      posted_by = v_actor
  where id = v_entry;

  if v_needs_cash and v_session.id is not null then
    insert into public.cash_movements (
      cash_session_id, movement_type, amount, concept,
      related_account_id, member_id, created_by, journal_entry_id
    ) values (
      v_session.id, 'income', v_pay.amount, v_concept,
      v_income, v_member, v_actor, v_entry
    )
    returning id into v_movement;
  end if;

  update public.colonia_payments
  set journal_entry_id = v_entry,
      cash_movement_id = v_movement
  where id = v_pay.id
  returning * into v_pay;

  return jsonb_build_object(
    'ok', true,
    'payment', to_jsonb(v_pay),
    'journal_entry_id', v_entry,
    'cash_movement_id', v_movement
  );
end;
$$;

create or replace function public.colonia_record_payment(
  p_enrollment_id uuid,
  p_method text,
  p_amount numeric,
  p_status text,
  p_external_reference text default null,
  p_idempotency_key text default null,
  p_operator_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enroll public.colonia_enrollments;
  v_payment public.colonia_payments;
  v_method text := lower(nullif(btrim(coalesce(p_method, '')), ''));
  v_status text := lower(nullif(btrim(coalesce(p_status, '')), ''));
  v_amount numeric := round(coalesce(p_amount, 0)::numeric, 2);
  v_treasury jsonb;
begin
  perform set_config('jc.colonia_tx', 'on', true);
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not public.colonia_has_cap('colonia.collect') and not public.colonia_has_cap('colonia.operate') then
    raise exception 'Sin permiso para cobrar Colonia.';
  end if;
  if v_method is null or v_method not in ('efectivo', 'tarjeta', 'pos', 'debito', 'mercadopago', 'transferencia') then
    raise exception 'Medio de pago no habilitado.';
  end if;
  if v_amount <= 0 then
    raise exception 'Importe inválido.';
  end if;
  if v_status is null or v_status not in ('pending', 'confirmed', 'rejected', 'cancelled') then
    raise exception 'Estado de pago inválido.';
  end if;
  if v_method = 'mercadopago' and v_status = 'confirmed' then
    raise exception 'Mercado Pago Colonia aún no está habilitado. No se acredita.';
  end if;
  if v_method = 'mercadopago' then
    v_status := 'pending';
  end if;
  if p_idempotency_key is not null then
    select * into v_payment from public.colonia_payments where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('ok', true, 'duplicate', true, 'payment', to_jsonb(v_payment));
    end if;
  end if;

  select * into v_enroll from public.colonia_enrollments where id = p_enrollment_id for update;
  if not found then
    raise exception 'Inscripción no encontrada.';
  end if;
  if v_enroll.status = 'cancelada' then
    raise exception 'La inscripción está cancelada.';
  end if;

  insert into public.colonia_payments (
    season_id, enrollment_id, student_id, guardian_id,
    method, amount, status, external_reference, idempotency_key,
    operator_id, operator_name, confirmed_at, income_class
  ) values (
    v_enroll.season_id, v_enroll.id, v_enroll.student_id, v_enroll.guardian_id,
    v_method, v_amount, v_status, nullif(btrim(coalesce(p_external_reference, '')), ''), p_idempotency_key,
    auth.uid(), nullif(btrim(coalesce(p_operator_name, '')), ''),
    case when v_status = 'confirmed' then now() else null end,
    'COLONIA'
  ) returning * into v_payment;

  if v_status = 'confirmed' then
    v_treasury := public.colonia_post_treasury(v_payment.id, true);
    select * into v_payment from public.colonia_payments where id = v_payment.id;
  end if;

  insert into public.colonia_audit_logs (actor_id, actor_name, action, entity_type, entity_id, payload)
  values (
    auth.uid(), p_operator_name, 'colonia_payment_' || v_status, 'colonia_payments', v_payment.id,
    jsonb_build_object(
      'enrollment_id', v_enroll.id,
      'amount', v_amount,
      'method', v_method,
      'affects_social_dues', false,
      'affects_member_balance', false,
      'journal_entry_id', v_payment.journal_entry_id,
      'cash_movement_id', v_payment.cash_movement_id,
      'receipt', case when v_status = 'confirmed' then jsonb_build_object(
        'club', 'Jockey Club San Juan',
        'concept', 'Colonia de Verano',
        'payment_id', v_payment.id,
        'amount', v_amount,
        'method', v_method,
        'fiscal', false
      ) else null end
    )
  );

  return jsonb_build_object(
    'ok', true,
    'payment', to_jsonb(v_payment),
    'journal_entry_id', v_payment.journal_entry_id,
    'cash_movement_id', v_payment.cash_movement_id,
    'treasury', v_treasury
  );
end;
$$;

create or replace function public.colonia_confirm_payment(
  p_payment_id uuid,
  p_operator_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.colonia_payments;
  v_treasury jsonb;
begin
  perform set_config('jc.colonia_tx', 'on', true);
  if auth.uid() is null then raise exception 'Tenés que estar logueado.'; end if;
  if not public.colonia_has_cap('colonia.collect') and not public.colonia_has_cap('colonia.operate') then
    raise exception 'Sin permiso para confirmar cobros de Colonia.';
  end if;

  select * into v_pay from public.colonia_payments where id = p_payment_id for update;
  if not found then raise exception 'Pago no encontrado.'; end if;
  if v_pay.status = 'confirmed' then
    if v_pay.journal_entry_id is null and v_pay.method is distinct from 'mercadopago' then
      v_treasury := public.colonia_post_treasury(v_pay.id, true);
      select * into v_pay from public.colonia_payments where id = v_pay.id;
    end if;
    return jsonb_build_object(
      'ok', true,
      'payment', to_jsonb(v_pay),
      'already', true,
      'journal_entry_id', v_pay.journal_entry_id,
      'cash_movement_id', v_pay.cash_movement_id,
      'treasury', v_treasury
    );
  end if;
  if v_pay.status not in ('pending') then
    raise exception 'Solo se confirman pagos pendientes.';
  end if;
  if v_pay.method = 'mercadopago' then
    raise exception 'Mercado Pago Colonia aún no está habilitado en el webhook. No se puede confirmar a mano como acreditado.';
  end if;

  update public.colonia_payments
  set status = 'confirmed',
      confirmed_at = now(),
      operator_name = coalesce(nullif(btrim(coalesce(p_operator_name, '')), ''), operator_name)
  where id = v_pay.id
  returning * into v_pay;

  v_treasury := public.colonia_post_treasury(v_pay.id, true);
  select * into v_pay from public.colonia_payments where id = v_pay.id;

  insert into public.colonia_audit_logs (actor_id, actor_name, action, entity_type, entity_id, payload)
  values (auth.uid(), p_operator_name, 'colonia_payment_confirmed', 'colonia_payments', v_pay.id,
    jsonb_build_object(
      'amount', v_pay.amount,
      'method', v_pay.method,
      'affects_social_dues', false,
      'affects_member_balance', false,
      'journal_entry_id', v_pay.journal_entry_id,
      'cash_movement_id', v_pay.cash_movement_id,
      'receipt', jsonb_build_object(
        'club', 'Jockey Club San Juan',
        'concept', 'Colonia de Verano',
        'payment_id', v_pay.id,
        'amount', v_pay.amount,
        'method', v_pay.method,
        'fiscal', false
      )
    ));

  return jsonb_build_object(
    'ok', true,
    'payment', to_jsonb(v_pay),
    'journal_entry_id', v_pay.journal_entry_id,
    'cash_movement_id', v_pay.cash_movement_id,
    'treasury', v_treasury
  );
end;
$$;

revoke all on function public.colonia_post_treasury(uuid, boolean) from public, anon, authenticated;
revoke all on function public.colonia_record_payment(uuid, text, numeric, text, text, text, text) from public, anon;
revoke all on function public.colonia_confirm_payment(uuid, text) from public, anon;

grant execute on function public.colonia_record_payment(uuid, text, numeric, text, text, text, text) to authenticated;
grant execute on function public.colonia_confirm_payment(uuid, text) to authenticated;

do $$
declare
  r record;
begin
  for r in
    select id
    from public.colonia_payments
    where status = 'confirmed'
      and journal_entry_id is null
      and method is distinct from 'mercadopago'
  loop
    perform public.colonia_post_treasury(r.id, false);
  end loop;
end $$;

notify pgrst, 'reload schema';
