-- La cuota de Colonia cobrada después del 10 lleva 15 % de interés.
-- El interés queda en la cuenta de Colonia (4.1.06), no en la cuota social.
-- El cargo de capital no cambia: el 15 % se asienta al confirmar el cobro.

create or replace function public.colonia_post_cuota_interest(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.colonia_payments;
  v_interest numeric;
begin
  select * into v_pay from public.colonia_payments where id = p_payment_id;
  if v_pay.id is null or v_pay.status is distinct from 'confirmed' then
    return;
  end if;
  v_interest := round(coalesce((v_pay.meta->>'interestAmount')::numeric, 0), 2);
  if v_interest <= 0.009 then
    return;
  end if;
  if exists (
    select 1
    from public.colonia_charges
    where enrollment_id = v_pay.enrollment_id
      and concept = 'colonia_interes'
      and status = 'posted'
      and note = 'interes:' || v_pay.id::text
  ) then
    return;
  end if;
  insert into public.colonia_charges (
    season_id, enrollment_id, student_id, concept, plan_key, amount, note, created_by
  ) values (
    v_pay.season_id,
    v_pay.enrollment_id,
    v_pay.student_id,
    'colonia_interes',
    'cuota',
    v_interest,
    'interes:' || v_pay.id::text,
    auth.uid()
  );
end;
$$;

revoke all on function public.colonia_post_cuota_interest(uuid) from public, anon, authenticated;

drop function if exists public.colonia_record_payment(uuid, text, numeric, text, text, text, text, text, jsonb);

create or replace function public.colonia_record_payment(
  p_enrollment_id uuid,
  p_method text,
  p_amount numeric,
  p_status text,
  p_external_reference text default null,
  p_idempotency_key text default null,
  p_operator_name text default null,
  p_bank_id text default null,
  p_pos jsonb default null,
  p_interest numeric default 0
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
  v_interest numeric := round(coalesce(p_interest, 0)::numeric, 2);
  v_bank text := lower(nullif(btrim(coalesce(p_bank_id, '')), ''));
  v_meta jsonb := '{}'::jsonb;
  v_fin numeric := 0;
  v_mode text := '';
  v_treasury jsonb;
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
  if v_interest < 0 or v_interest >= v_amount then
    raise exception 'El interés de la cuota no es válido.';
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
  if v_interest > 0 then
    v_meta := v_meta || jsonb_build_object(
      'interestAmount', v_interest,
      'interestRate', 0.15,
      'interestConcept', 'colonia_cuota'
    );
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
    perform public.colonia_post_cuota_interest(v_payment.id);
    v_treasury := public.colonia_post_treasury(v_payment.id, true);
    select * into v_payment from public.colonia_payments where id = v_payment.id;
  end if;

  insert into public.colonia_audit_logs (actor_id, actor_name, action, entity_type, entity_id, payload)
  values (
    auth.uid(), p_operator_name, 'colonia_payment_' || v_status, 'colonia_payments', v_payment.id,
    jsonb_build_object(
      'enrollment_id', v_enroll.id,
      'amount', v_amount,
      'interest', v_interest,
      'method', v_method,
      'bank_id', v_bank,
      'pos', case when v_method = 'tarjeta' then v_meta->'cardFinancing' else null end,
      'affects_social_dues', false,
      'affects_member_balance', false,
      'journal_entry_id', v_payment.journal_entry_id,
      'cash_movement_id', v_payment.cash_movement_id,
      'receipt', case when v_status = 'confirmed' then jsonb_build_object(
        'club', 'Jockey Club San Juan',
        'concept', 'Colonia de Verano',
        'payment_id', v_payment.id,
        'amount', v_amount,
        'interest', v_interest,
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

revoke all on function public.colonia_record_payment(uuid, text, numeric, text, text, text, text, text, jsonb, numeric) from public, anon;
grant execute on function public.colonia_record_payment(uuid, text, numeric, text, text, text, text, text, jsonb, numeric) to authenticated;

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
    perform public.colonia_post_cuota_interest(v_pay.id);
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
    raise exception 'Mercado Pago Colonia se acredita cuando Mercado Pago confirma.';
  end if;

  update public.colonia_payments
  set status = 'confirmed',
      confirmed_at = now(),
      operator_name = coalesce(nullif(btrim(coalesce(p_operator_name, '')), ''), operator_name)
  where id = v_pay.id
  returning * into v_pay;

  perform public.colonia_post_cuota_interest(v_pay.id);
  v_treasury := public.colonia_post_treasury(v_pay.id, true);
  select * into v_pay from public.colonia_payments where id = v_pay.id;

  insert into public.colonia_audit_logs (actor_id, actor_name, action, entity_type, entity_id, payload)
  values (auth.uid(), p_operator_name, 'colonia_payment_confirmed', 'colonia_payments', v_pay.id,
    jsonb_build_object(
      'amount', v_pay.amount,
      'interest', coalesce((v_pay.meta->>'interestAmount')::numeric, 0),
      'method', v_pay.method,
      'affects_social_dues', false,
      'affects_member_balance', false,
      'journal_entry_id', v_pay.journal_entry_id,
      'cash_movement_id', v_pay.cash_movement_id
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

revoke all on function public.colonia_confirm_payment(uuid, text) from public, anon;
grant execute on function public.colonia_confirm_payment(uuid, text) to authenticated;

notify pgrst, 'reload schema';
