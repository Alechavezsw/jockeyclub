-- Mercado Pago de Colonia: kind=colonia acredita colonia_payments y el asiento 4.1.06.
-- Debe Mercado Pago 1.1.08. No toca cuota social ni outstanding_balance.
-- El cobro a mano sigue prohibido: solo entra cuando el webhook confirma approved.

create or replace function public.colonia_mp_quote(
  p_member_id uuid,
  p_enrollment_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_enroll public.colonia_enrollments;
  v_name text;
  v_charged numeric := 0;
  v_paid numeric := 0;
  v_pending numeric := 0;
  v_staff boolean;
  v_self boolean;
  v_linked boolean;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if p_member_id is null or p_enrollment_id is null then
    raise exception 'Falta la inscripción de Colonia.';
  end if;

  v_staff := public.colonia_has_cap('colonia.collect') or public.colonia_has_cap('colonia.operate');
  select exists (
    select 1 from public.members m
    where m.id = p_member_id
      and (m.profile_id = auth.uid() or (m.meta->>'profileId') = auth.uid()::text)
  ) into v_self;
  if not v_staff and not coalesce(v_self, false) then
    raise exception 'Sin permiso para cobrar esta Colonia.';
  end if;

  select * into v_enroll from public.colonia_enrollments where id = p_enrollment_id;
  if not found then
    raise exception 'Inscripción no encontrada.';
  end if;
  if v_enroll.status = 'cancelada' then
    raise exception 'La inscripción está cancelada.';
  end if;

  select s.full_name into v_name
  from public.colonia_students s
  where s.id = v_enroll.student_id;

  if not v_staff then
    select exists (
      select 1
      from public.colonia_enrollments e
      join public.colonia_students s on s.id = e.student_id
      join public.colonia_guardians g on g.id = e.guardian_id
      where e.id = v_enroll.id
        and (
          s.member_id = p_member_id
          or g.member_id = p_member_id
          or e.submitted_by_member_id = p_member_id
          or exists (
            select 1 from public.colonia_guardian_authorizations a
            where a.student_id = s.id
              and a.member_id = p_member_id
              and a.revoked_at is null
              and coalesce(a.can_pay, false)
          )
        )
    ) into v_linked;
    if not coalesce(v_linked, false) then
      raise exception 'Esta inscripción no está en tu grupo de Colonia.';
    end if;
  end if;

  select coalesce(sum(amount), 0) into v_charged
  from public.colonia_charges
  where enrollment_id = v_enroll.id and status = 'posted';
  select coalesce(sum(amount), 0) into v_paid
  from public.colonia_payments
  where enrollment_id = v_enroll.id and status = 'confirmed';
  select coalesce(sum(amount), 0) into v_pending
  from public.colonia_payments
  where enrollment_id = v_enroll.id and status = 'pending';

  return jsonb_build_object(
    'ok', true,
    'enrollment_id', v_enroll.id,
    'student_name', v_name,
    'payable', greatest(0, round(v_charged - v_paid - v_pending, 2))
  );
end;
$$;

create or replace function public.colonia_apply_mp_intent(p_intent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent public.mp_intents%rowtype;
  v_enroll public.colonia_enrollments;
  v_pay public.colonia_payments;
  v_enrollment_id uuid;
  v_treasury jsonb;
  v_key text;
begin
  perform set_config('jc.colonia_tx', 'on', true);

  select * into v_intent from public.mp_intents where id = p_intent_id for update;
  if v_intent.id is null then
    raise exception 'No está el cobro de Mercado Pago.';
  end if;
  if v_intent.kind is distinct from 'colonia' then
    raise exception 'Este cobro no es de Colonia.';
  end if;
  if v_intent.applied_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'applied', false, 'intent_id', v_intent.id);
  end if;
  if lower(coalesce(v_intent.status, '')) <> 'approved' then
    raise exception 'Mercado Pago de Colonia todavía no está aprobado.';
  end if;
  if upper(coalesce(nullif(btrim(v_intent.currency), ''), 'ARS')) <> 'ARS' then
    raise exception 'Moneda de Mercado Pago inválida';
  end if;

  begin
    v_enrollment_id := nullif(v_intent.meta->>'enrollmentId', '')::uuid;
  exception when others then
    v_enrollment_id := null;
  end;
  if v_enrollment_id is null then
    raise exception 'El cobro de Colonia no indica la inscripción.';
  end if;

  select * into v_enroll from public.colonia_enrollments where id = v_enrollment_id for update;
  if not found then
    raise exception 'Inscripción de Colonia no encontrada.';
  end if;
  if v_enroll.status = 'cancelada' then
    raise exception 'La inscripción de Colonia está cancelada.';
  end if;

  v_key := 'mp:' || v_intent.id::text;
  select * into v_pay from public.colonia_payments where idempotency_key = v_key;
  if v_pay.id is null then
    begin
      insert into public.colonia_payments (
        season_id, enrollment_id, student_id, guardian_id,
        method, amount, status, external_reference, idempotency_key,
        operator_name, confirmed_at, income_class, meta
      ) values (
        v_enroll.season_id, v_enroll.id, v_enroll.student_id, v_enroll.guardian_id,
        'mercadopago', round(v_intent.amount, 2), 'confirmed',
        coalesce(nullif(btrim(v_intent.provider_payment_id), ''), v_intent.id::text),
        v_key,
        'Mercado Pago', now(), 'COLONIA',
        jsonb_build_object(
          'mp_intent_id', v_intent.id,
          'chargeScope', 'colonia',
          'affects_social_dues', false
        )
      ) returning * into v_pay;
    exception when unique_violation then
      select * into v_pay from public.colonia_payments where idempotency_key = v_key;
    end;
  end if;

  if v_pay.status is distinct from 'confirmed' then
    update public.colonia_payments
    set status = 'confirmed',
        confirmed_at = coalesce(confirmed_at, now())
    where id = v_pay.id
    returning * into v_pay;
  end if;

  v_treasury := public.colonia_post_treasury(v_pay.id, false);
  select * into v_pay from public.colonia_payments where id = v_pay.id;

  update public.mp_intents
  set applied_at = now(),
      updated_at = now(),
      meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
        'colonia_payment_id', v_pay.id,
        'journal_entry_id', v_pay.journal_entry_id,
        'chargeScope', 'colonia'
      )
  where id = v_intent.id;

  insert into public.colonia_audit_logs (actor_id, actor_name, action, entity_type, entity_id, payload)
  values (
    auth.uid(), 'Mercado Pago', 'colonia_mp_applied', 'colonia_payments', v_pay.id,
    jsonb_build_object(
      'intent_id', v_intent.id,
      'amount', v_pay.amount,
      'journal_entry_id', v_pay.journal_entry_id,
      'affects_social_dues', false,
      'affects_member_balance', false
    )
  );

  return jsonb_build_object(
    'ok', true,
    'applied', true,
    'intent_id', v_intent.id,
    'payment_id', v_pay.id,
    'journal_entry_id', v_pay.journal_entry_id,
    'treasury', v_treasury
  );
end;
$$;

do $patch$
declare
  def text;
  old_mp text := $old$
  if v_pay.method = 'mercadopago' then
    raise exception 'Mercado Pago Colonia aún no está habilitado. No se asienta.';
  end if;
$old$;
  old_else text := $old$
  else
    raise exception 'Medio de Colonia sin cuenta de tesorería.';
  end if;$old$;
  new_else text := $new$
  elsif v_method = 'mercadopago' then
    select id into v_debit
    from public.chart_of_accounts
    where is_active is true
      and (code = '1.1.08' or name = 'Mercado Pago')
    order by case when code = '1.1.08' then 0 else 1 end
    limit 1;
    if v_debit is null then
      raise exception 'No está la cuenta Mercado Pago en el plan.';
    end if;
    v_memo := 'Mercado Pago';
  else
    raise exception 'Medio de Colonia sin cuenta de tesorería.';
  end if;$new$;
begin
  def := pg_get_functiondef('public.colonia_post_treasury(uuid,boolean)'::regprocedure);
  if position('v_method = ''mercadopago''' in def) = 0 then
    if position(old_mp in def) = 0 then
      raise exception 'No encontré el bloque de Mercado Pago en colonia_post_treasury.';
    end if;
    def := replace(def, old_mp, E'\n');
    if position(old_else in def) = 0 then
      raise exception 'No encontré el cierre de tesorería de Colonia.';
    end if;
    def := replace(def, old_else, new_else);
    execute def;
  end if;
end
$patch$;

do $hook$
declare
  def text;
  anchor text := $a$  if abs(v_amount - round(v_intent.amount, 2)) > 0.009 then
    raise exception 'Importe acreditado no coincide con el cobro (centavos).';
  end if;$a$;
  extra text := $x$  if abs(v_amount - round(v_intent.amount, 2)) > 0.009 then
    raise exception 'Importe acreditado no coincide con el cobro (centavos).';
  end if;

  if v_intent.kind = 'colonia' then
    return public.colonia_apply_mp_intent(v_intent.id);
  end if;$x$;
begin
  if to_regprocedure('public.apply_mp_approved_payment(uuid,text,text,numeric)') is null then
    return;
  end if;
  def := pg_get_functiondef('public.apply_mp_approved_payment(uuid,text,text,numeric)'::regprocedure);
  if position('colonia_apply_mp_intent' in def) > 0 then
    return;
  end if;
  if position(anchor in def) = 0 then
    raise exception 'No encontré el control de centavos para enganchar Colonia.';
  end if;
  execute replace(def, anchor, extra);
end
$hook$;

revoke all on function public.colonia_mp_quote(uuid, uuid) from public, anon;
revoke all on function public.colonia_apply_mp_intent(uuid) from public, anon, authenticated;
grant execute on function public.colonia_mp_quote(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
