-- Si la inscripción quedó en pendiente_pago pero el saldo ya está cubierto,
-- pasa a confirmada. Lo mismo al acreditar un cobro.

create or replace function public.colonia_sync_enrollment_status(p_enrollment_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enroll public.colonia_enrollments;
  v_charged numeric := 0;
  v_paid numeric := 0;
  v_balance numeric := 0;
  v_next text;
begin
  if p_enrollment_id is null then
    return null;
  end if;

  select * into v_enroll
  from public.colonia_enrollments
  where id = p_enrollment_id
  for update;
  if not found then
    return null;
  end if;
  if v_enroll.status = 'cancelada' then
    return v_enroll.status;
  end if;

  select coalesce(sum(amount), 0) into v_charged
  from public.colonia_charges
  where enrollment_id = v_enroll.id
    and status = 'posted';

  select coalesce(sum(amount), 0) into v_paid
  from public.colonia_payments
  where enrollment_id = v_enroll.id
    and status = 'confirmed';

  v_balance := round(v_charged - v_paid, 2);
  v_next := v_enroll.status;

  if v_balance <= 0
     and v_enroll.status in ('borrador', 'pendiente', 'pendiente_pago', 'observada')
  then
    v_next := 'confirmada';
  elsif v_balance > 0.009
     and v_enroll.status = 'confirmada'
  then
    -- Quedó deuda después de un cargo nuevo: vuelve a pendiente de pago.
    v_next := 'pendiente_pago';
  end if;

  if v_next is distinct from v_enroll.status then
    update public.colonia_enrollments
    set status = v_next,
        updated_at = now()
    where id = v_enroll.id;

    insert into public.colonia_audit_logs (actor_id, actor_name, action, entity_type, entity_id, payload)
    values (
      auth.uid(),
      null,
      'colonia_enrollment_status_synced',
      'colonia_enrollments',
      v_enroll.id,
      jsonb_build_object(
        'from', v_enroll.status,
        'to', v_next,
        'charged', v_charged,
        'paid', v_paid,
        'balance', v_balance
      )
    );
  end if;

  return v_next;
end;
$$;

revoke all on function public.colonia_sync_enrollment_status(uuid) from public, anon;
grant execute on function public.colonia_sync_enrollment_status(uuid) to authenticated;

create or replace function public.colonia_record_payment(
  p_enrollment_id uuid,
  p_method text,
  p_amount numeric,
  p_status text,
  p_external_reference text default null,
  p_idempotency_key text default null,
  p_operator_name text default null,
  p_bank_id text default null,
  p_pos jsonb default null
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
  v_bank text := lower(nullif(btrim(coalesce(p_bank_id, '')), ''));
  v_meta jsonb := '{}'::jsonb;
  v_fin numeric := 0;
  v_mode text := '';
  v_treasury jsonb;
  v_enrollment_status text;
begin
  perform set_config('jc.colonia_tx', 'on', true);
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not public.colonia_has_cap('colonia.collect') and not public.colonia_has_cap('colonia.operate') then
    raise exception 'Sin permiso para cobrar Colonia.';
  end if;
  if v_method in ('pos', 'pago pos', 'card') then
    v_method := 'tarjeta';
  end if;
  if v_method is null or v_method not in ('efectivo', 'tarjeta', 'debito', 'mercadopago', 'transferencia') then
    raise exception 'Medio de pago no habilitado.';
  end if;
  if v_amount <= 0 then
    raise exception 'Importe inválido.';
  end if;
  if v_status is null or v_status not in ('pending', 'confirmed', 'rejected', 'cancelled') then
    raise exception 'Estado de pago inválido.';
  end if;
  if v_method = 'mercadopago' and v_status = 'confirmed' then
    raise exception 'Mercado Pago Colonia se acredita solo cuando Mercado Pago confirma.';
  end if;
  if v_method = 'mercadopago' then
    v_status := 'pending';
  end if;
  if v_method in ('transferencia', 'debito') and v_bank is null then
    v_bank := 'macro';
  end if;
  if v_method not in ('transferencia', 'debito') then
    v_bank := null;
  end if;
  if v_bank is not null then
    v_meta := jsonb_build_object('bankId', v_bank);
  end if;
  if v_method = 'tarjeta' and p_pos is not null and jsonb_typeof(p_pos) = 'object' then
    v_fin := round(coalesce((p_pos->>'financingAmount')::numeric, 0), 2);
    v_mode := coalesce(nullif(btrim(p_pos->>'mode'), ''), 'issuer_keeps');
    if v_fin < 0 or v_fin > v_amount then
      raise exception 'Financiación POS inválida.';
    end if;
    if v_mode not in ('issuer_keeps', 'club_keeps') then
      raise exception 'Modalidad POS inválida.';
    end if;
    if nullif(btrim(coalesce(p_pos->>'planId', '')), '') is null then
      raise exception 'Elegí el plan de Pago POS.';
    end if;
    v_meta := v_meta || jsonb_build_object('cardFinancing', p_pos || jsonb_build_object(
      'financingAmount', v_fin,
      'mode', v_mode
    ));
  end if;
  if p_idempotency_key is not null then
    select * into v_payment from public.colonia_payments where idempotency_key = p_idempotency_key;
    if found then
      if v_payment.status = 'confirmed' then
        v_enrollment_status := public.colonia_sync_enrollment_status(v_payment.enrollment_id);
      end if;
      return jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'payment', to_jsonb(v_payment),
        'enrollment_status', v_enrollment_status
      );
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
    operator_id, operator_name, confirmed_at, income_class, meta
  ) values (
    v_enroll.season_id, v_enroll.id, v_enroll.student_id, v_enroll.guardian_id,
    v_method, v_amount, v_status, nullif(btrim(coalesce(p_external_reference, '')), ''), p_idempotency_key,
    auth.uid(), nullif(btrim(coalesce(p_operator_name, '')), ''),
    case when v_status = 'confirmed' then now() else null end,
    'COLONIA',
    v_meta
  ) returning * into v_payment;

  if v_status = 'confirmed' then
    v_treasury := public.colonia_post_treasury(v_payment.id, true);
    select * into v_payment from public.colonia_payments where id = v_payment.id;
    v_enrollment_status := public.colonia_sync_enrollment_status(v_enroll.id);
  end if;

  insert into public.colonia_audit_logs (actor_id, actor_name, action, entity_type, entity_id, payload)
  values (
    auth.uid(), p_operator_name, 'colonia_payment_' || v_status, 'colonia_payments', v_payment.id,
    jsonb_build_object(
      'enrollment_id', v_enroll.id,
      'amount', v_amount,
      'method', v_method,
      'bank_id', v_bank,
      'pos', case when v_method = 'tarjeta' then v_meta->'cardFinancing' else null end,
      'affects_social_dues', false,
      'affects_member_balance', false,
      'journal_entry_id', v_payment.journal_entry_id,
      'cash_movement_id', v_payment.cash_movement_id,
      'enrollment_status', v_enrollment_status,
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
    'treasury', v_treasury,
    'enrollment_status', v_enrollment_status
  );
end;
$$;

revoke all on function public.colonia_record_payment(uuid, text, numeric, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.colonia_record_payment(uuid, text, numeric, text, text, text, text, text, jsonb) to authenticated;

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
  v_enrollment_status text;
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
    v_enrollment_status := public.colonia_sync_enrollment_status(v_pay.enrollment_id);
    return jsonb_build_object(
      'ok', true,
      'payment', to_jsonb(v_pay),
      'already', true,
      'journal_entry_id', v_pay.journal_entry_id,
      'cash_movement_id', v_pay.cash_movement_id,
      'treasury', v_treasury,
      'enrollment_status', v_enrollment_status
    );
  end if;
  if v_pay.status not in ('pending') then
    raise exception 'Solo se confirman pagos pendientes.';
  end if;
  if v_pay.method = 'mercadopago' then
    raise exception 'Mercado Pago Colonia se acredita solo cuando Mercado Pago confirma. No se puede confirmar a mano como acreditado.';
  end if;

  update public.colonia_payments
  set status = 'confirmed',
      confirmed_at = now(),
      operator_name = coalesce(nullif(btrim(coalesce(p_operator_name, '')), ''), operator_name)
  where id = v_pay.id
  returning * into v_pay;

  v_treasury := public.colonia_post_treasury(v_pay.id, true);
  select * into v_pay from public.colonia_payments where id = v_pay.id;
  v_enrollment_status := public.colonia_sync_enrollment_status(v_pay.enrollment_id);

  insert into public.colonia_audit_logs (actor_id, actor_name, action, entity_type, entity_id, payload)
  values (auth.uid(), p_operator_name, 'colonia_payment_confirmed', 'colonia_payments', v_pay.id,
    jsonb_build_object(
      'amount', v_pay.amount,
      'method', v_pay.method,
      'affects_social_dues', false,
      'affects_member_balance', false,
      'journal_entry_id', v_pay.journal_entry_id,
      'cash_movement_id', v_pay.cash_movement_id,
      'enrollment_status', v_enrollment_status,
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
    'treasury', v_treasury,
    'enrollment_status', v_enrollment_status
  );
end;
$$;

revoke all on function public.colonia_confirm_payment(uuid, text) from public, anon;
grant execute on function public.colonia_confirm_payment(uuid, text) to authenticated;

-- Backfill: ya pagaron y siguen en pendiente_pago / pendiente / observada / borrador.
do $fix$
declare
  r record;
begin
  for r in
    select e.id
    from public.colonia_enrollments e
    where e.status in ('borrador', 'pendiente', 'pendiente_pago', 'observada')
      and coalesce((
        select sum(c.amount) from public.colonia_charges c
        where c.enrollment_id = e.id and c.status = 'posted'
      ), 0) - coalesce((
        select sum(p.amount) from public.colonia_payments p
        where p.enrollment_id = e.id and p.status = 'confirmed'
      ), 0) <= 0
  loop
    perform public.colonia_sync_enrollment_status(r.id);
  end loop;
end;
$fix$;

notify pgrst, 'reload schema';
