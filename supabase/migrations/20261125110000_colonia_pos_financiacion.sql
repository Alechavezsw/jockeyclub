-- Pago POS de Colonia usa el mismo cupón que el resto del club.
-- El capital queda en Colonia (4.1.06). Modalidad A suma la financiación
-- a Tarjetas a cobrar (1.1.09) y la acredita en 4.1.05. Modalidad B no la asienta.

drop function if exists public.colonia_record_payment(uuid, text, numeric, text, text, text, text, text);
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

revoke all on function public.colonia_record_payment(uuid, text, numeric, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.colonia_record_payment(uuid, text, numeric, text, text, text, text, text, jsonb) to authenticated;

do $patch$
declare
  def text := pg_get_functiondef('public.colonia_post_treasury(uuid,boolean)'::regprocedure);
  extra text := $new$
    (v_entry, v_income, 2, 0, v_pay.amount, 'Colonia de Verano');

  if v_method in ('tarjeta', 'pos')
     and coalesce(v_pay.meta->'cardFinancing'->>'mode', '') = 'club_keeps'
     and coalesce((v_pay.meta->'cardFinancing'->>'financingAmount')::numeric, 0) > 0.009
  then
    declare
      v_fin numeric := round(coalesce((v_pay.meta->'cardFinancing'->>'financingAmount')::numeric, 0), 2);
      v_fin_account uuid;
    begin
      select id into v_fin_account
      from public.chart_of_accounts
      where is_active is true
        and (code = '4.1.05' or name = 'Ingresos por financiación tarjetas')
      order by case when code = '4.1.05' then 0 else 1 end
      limit 1;
      if v_fin_account is null then
        raise exception 'No está la cuenta de financiación de tarjetas.';
      end if;
      update public.journal_lines
      set debit = round(debit + v_fin, 2)
      where journal_entry_id = v_entry
        and line_order = 1;
      insert into public.journal_lines (journal_entry_id, account_id, line_order, debit, credit, memo)
      values (v_entry, v_fin_account, 3, 0, v_fin, 'Financiación tarjeta');
    end;
  end if;

  update public.journal_entries$new$;
  patched text;
begin
  if position('Financiación tarjeta' in def) > 0 then
    return;
  end if;
  patched := regexp_replace(
    def,
    $re$\(v_entry, v_income, 2, 0, v_pay\.amount, 'Colonia de Verano'\);\s*update public\.journal_entries$re$,
    extra
  );
  if patched = def then
    raise exception 'No encontré el asiento de Colonia para sumar la financiación POS.';
  end if;
  execute patched;
end
$patch$;

notify pgrst, 'reload schema';
