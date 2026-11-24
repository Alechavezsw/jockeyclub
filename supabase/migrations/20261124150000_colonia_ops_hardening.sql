-- Colonia: cancelacion, void, confirmacion de pagos, autorizaciones, grupos y defensa financiera.
-- No aplicar en produccion sin autorizacion.

-- Defensa: ningun UPDATE de members.outstanding_balance puede originarse desde funciones colonia_*.
create or replace function public.colonia_forbid_member_balance_touch()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and coalesce(new.outstanding_balance, 0) is distinct from coalesce(old.outstanding_balance, 0)
     and coalesce(current_setting('jc.colonia_tx', true), 'off') = 'on'
  then
    raise exception 'Abortado: un movimiento de Colonia no puede modificar members.outstanding_balance.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_colonia_forbid_member_balance on public.members;
create trigger trg_colonia_forbid_member_balance
  before update of outstanding_balance on public.members
  for each row execute function public.colonia_forbid_member_balance_touch();

create or replace function public.colonia_cancel_enrollment(
  p_enrollment_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enroll public.colonia_enrollments;
begin
  if auth.uid() is null then raise exception 'Tenés que estar logueado.'; end if;
  if not public.colonia_has_cap('colonia.operate') then
    raise exception 'Sin permiso para cancelar inscripciones de Colonia.';
  end if;

  select * into v_enroll from public.colonia_enrollments where id = p_enrollment_id for update;
  if not found then raise exception 'Inscripción no encontrada.'; end if;
  if v_enroll.status = 'cancelada' then
    return jsonb_build_object('ok', true, 'enrollment', to_jsonb(v_enroll), 'already', true);
  end if;

  update public.colonia_enrollments
  set status = 'cancelada',
      observations = nullif(btrim(concat_ws(' · ', coalesce(observations, ''), coalesce(p_reason, 'Cancelada'))), ''),
      updated_at = now()
  where id = v_enroll.id
  returning * into v_enroll;

  insert into public.colonia_audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (auth.uid(), 'colonia_enrollment_cancelled', 'colonia_enrollments', v_enroll.id,
    jsonb_build_object('reason', p_reason));

  return jsonb_build_object('ok', true, 'enrollment', to_jsonb(v_enroll));
end;
$$;

create or replace function public.colonia_update_enrollment(
  p_enrollment_id uuid,
  p_plan_key text default null,
  p_status text default null,
  p_group_id uuid default null,
  p_observations text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enroll public.colonia_enrollments;
  v_status text := lower(nullif(btrim(coalesce(p_status, '')), ''));
begin
  if auth.uid() is null then raise exception 'Tenés que estar logueado.'; end if;
  if not public.colonia_has_cap('colonia.operate') then
    raise exception 'Sin permiso para modificar inscripciones de Colonia.';
  end if;
  if v_status is not null and v_status not in ('borrador', 'pendiente', 'confirmada', 'cancelada') then
    raise exception 'Estado de inscripción inválido.';
  end if;

  select * into v_enroll from public.colonia_enrollments where id = p_enrollment_id for update;
  if not found then raise exception 'Inscripción no encontrada.'; end if;

  update public.colonia_enrollments
  set plan_key = coalesce(nullif(btrim(coalesce(p_plan_key, '')), ''), plan_key),
      status = coalesce(v_status, status),
      group_id = coalesce(p_group_id, group_id),
      observations = coalesce(p_observations, observations),
      updated_at = now()
  where id = v_enroll.id
  returning * into v_enroll;

  insert into public.colonia_audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (auth.uid(), 'colonia_enrollment_updated', 'colonia_enrollments', v_enroll.id,
    jsonb_build_object('plan_key', v_enroll.plan_key, 'status', v_enroll.status, 'group_id', v_enroll.group_id));

  return jsonb_build_object('ok', true, 'enrollment', to_jsonb(v_enroll));
end;
$$;

create or replace function public.colonia_void_charge(
  p_charge_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charge public.colonia_charges;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then raise exception 'Tenés que estar logueado.'; end if;
  if not public.colonia_has_cap('colonia.operate') then
    raise exception 'Sin permiso para anular cargos de Colonia.';
  end if;
  if v_reason is null or char_length(v_reason) < 5 then
    raise exception 'La anulación requiere un motivo (mínimo 5 caracteres).';
  end if;

  select * into v_charge from public.colonia_charges where id = p_charge_id for update;
  if not found then raise exception 'Cargo no encontrado.'; end if;
  if v_charge.status = 'void' then
    return jsonb_build_object('ok', true, 'charge', to_jsonb(v_charge), 'already', true);
  end if;

  update public.colonia_charges
  set status = 'void', voided_at = now(), void_reason = v_reason
  where id = v_charge.id
  returning * into v_charge;

  insert into public.colonia_audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (auth.uid(), 'colonia_charge_voided', 'colonia_charges', v_charge.id,
    jsonb_build_object('reason', v_reason, 'amount', v_charge.amount));

  return jsonb_build_object('ok', true, 'charge', to_jsonb(v_charge));
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
begin
  perform set_config('jc.colonia_tx', 'on', true);
  if auth.uid() is null then raise exception 'Tenés que estar logueado.'; end if;
  if not public.colonia_has_cap('colonia.collect') and not public.colonia_has_cap('colonia.operate') then
    raise exception 'Sin permiso para confirmar cobros de Colonia.';
  end if;

  select * into v_pay from public.colonia_payments where id = p_payment_id for update;
  if not found then raise exception 'Pago no encontrado.'; end if;
  if v_pay.status = 'confirmed' then
    return jsonb_build_object('ok', true, 'payment', to_jsonb(v_pay), 'already', true);
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

  insert into public.colonia_audit_logs (actor_id, actor_name, action, entity_type, entity_id, payload)
  values (auth.uid(), p_operator_name, 'colonia_payment_confirmed', 'colonia_payments', v_pay.id,
    jsonb_build_object(
      'amount', v_pay.amount,
      'method', v_pay.method,
      'affects_social_dues', false,
      'affects_member_balance', false,
      'receipt', jsonb_build_object(
        'club', 'Jockey Club San Juan',
        'concept', 'Colonia de Verano',
        'payment_id', v_pay.id,
        'amount', v_pay.amount,
        'method', v_pay.method,
        'fiscal', false
      )
    ));

  return jsonb_build_object('ok', true, 'payment', to_jsonb(v_pay));
end;
$$;

create or replace function public.colonia_set_authorization(
  p_enrollment_id uuid,
  p_kind text,
  p_granted boolean,
  p_activity_id uuid default null,
  p_granted_by_name text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enroll public.colonia_enrollments;
  v_row public.colonia_authorizations;
  v_kind text := lower(nullif(btrim(coalesce(p_kind, '')), ''));
begin
  if auth.uid() is null then raise exception 'Tenés que estar logueado.'; end if;
  if not public.colonia_has_cap('colonia.operate') and not public.colonia_has_cap('colonia.attend') then
    raise exception 'Sin permiso para autorizaciones de Colonia.';
  end if;
  if v_kind is null then raise exception 'Falta el tipo de autorización.'; end if;

  select * into v_enroll from public.colonia_enrollments where id = p_enrollment_id;
  if not found then raise exception 'Inscripción no encontrada.'; end if;

  insert into public.colonia_authorizations (
    season_id, enrollment_id, activity_id, kind, granted, granted_at, granted_by_name, note
  ) values (
    v_enroll.season_id, v_enroll.id, p_activity_id, v_kind, coalesce(p_granted, false),
    case when coalesce(p_granted, false) then now() else null end,
    p_granted_by_name, p_note
  )
  returning * into v_row;

  insert into public.colonia_audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (auth.uid(), 'colonia_authorization_set', 'colonia_authorizations', v_row.id,
    jsonb_build_object('kind', v_kind, 'granted', p_granted, 'activity_id', p_activity_id));

  return jsonb_build_object('ok', true, 'authorization', to_jsonb(v_row));
end;
$$;

create or replace function public.colonia_create_group(
  p_season_id uuid,
  p_name text,
  p_age_from integer default null,
  p_age_to integer default null,
  p_capacity integer default null,
  p_lead_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.colonia_groups;
begin
  if auth.uid() is null then raise exception 'Tenés que estar logueado.'; end if;
  if not public.colonia_has_cap('colonia.operate') then
    raise exception 'Sin permiso para crear grupos de Colonia.';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'Falta el nombre del grupo.';
  end if;

  insert into public.colonia_groups (season_id, name, age_from, age_to, capacity, lead_name)
  values (p_season_id, btrim(p_name), p_age_from, p_age_to, p_capacity, nullif(btrim(coalesce(p_lead_name, '')), ''))
  returning * into v_row;

  return jsonb_build_object('ok', true, 'group', to_jsonb(v_row));
end;
$$;

create or replace function public.colonia_create_activity(
  p_season_id uuid,
  p_kind text,
  p_title text,
  p_activity_date date default null,
  p_place text default null,
  p_lead_name text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.colonia_activities;
  v_kind text := lower(nullif(btrim(coalesce(p_kind, '')), ''));
begin
  if auth.uid() is null then raise exception 'Tenés que estar logueado.'; end if;
  if not public.colonia_has_cap('colonia.operate') and not public.colonia_has_cap('colonia.attend') then
    raise exception 'Sin permiso para actividades de Colonia.';
  end if;
  if v_kind is null or v_kind not in ('natacion', 'recreacion', 'excursion', 'campamento') then
    raise exception 'Tipo de actividad inválido.';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception 'Falta el título de la actividad.';
  end if;

  insert into public.colonia_activities (season_id, kind, title, activity_date, place, lead_name, notes)
  values (p_season_id, v_kind, btrim(p_title), p_activity_date, p_place, p_lead_name, p_notes)
  returning * into v_row;

  return jsonb_build_object('ok', true, 'activity', to_jsonb(v_row));
end;
$$;

-- Endurecer record_payment: no confirmar MP; marcar colonia_tx; denegar confirmed de tarjeta sin meta.
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

  insert into public.colonia_audit_logs (actor_id, actor_name, action, entity_type, entity_id, payload)
  values (
    auth.uid(), p_operator_name, 'colonia_payment_' || v_status, 'colonia_payments', v_payment.id,
    jsonb_build_object(
      'enrollment_id', v_enroll.id,
      'amount', v_amount,
      'method', v_method,
      'affects_social_dues', false,
      'affects_member_balance', false,
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

  return jsonb_build_object('ok', true, 'payment', to_jsonb(v_payment));
end;
$$;

-- RLS restante (best-effort)
do $$
declare
  t text;
begin
  foreach t in array array[
    'colonia_tariffs','colonia_guardians','colonia_students','colonia_sibling_groups',
    'colonia_enrollments','colonia_groups','colonia_charges','colonia_payments',
    'colonia_attendance','colonia_activities','colonia_authorizations','colonia_audit_logs'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.colonia_has_cap(''colonia.operate'') or public.colonia_has_cap(''colonia.report'') or public.colonia_has_cap(''colonia.collect'') or public.colonia_has_cap(''colonia.attend'')) with check (public.colonia_has_cap(''colonia.operate'') or public.colonia_has_cap(''colonia.collect'') or public.colonia_has_cap(''colonia.attend''))',
      t || '_all', t
    );
  end loop;
exception when others then
  raise notice 'colonia RLS bulk: %', sqlerrm;
end $$;

revoke all on function public.colonia_cancel_enrollment(uuid, text) from public, anon;
revoke all on function public.colonia_update_enrollment(uuid, text, text, uuid, text) from public, anon;
revoke all on function public.colonia_void_charge(uuid, text) from public, anon;
revoke all on function public.colonia_confirm_payment(uuid, text) from public, anon;
revoke all on function public.colonia_set_authorization(uuid, text, boolean, uuid, text, text) from public, anon;
revoke all on function public.colonia_create_group(uuid, text, integer, integer, integer, text) from public, anon;
revoke all on function public.colonia_create_activity(uuid, text, text, date, text, text, text) from public, anon;

grant execute on function public.colonia_cancel_enrollment(uuid, text) to authenticated;
grant execute on function public.colonia_update_enrollment(uuid, text, text, uuid, text) to authenticated;
grant execute on function public.colonia_void_charge(uuid, text) to authenticated;
grant execute on function public.colonia_confirm_payment(uuid, text) to authenticated;
grant execute on function public.colonia_set_authorization(uuid, text, boolean, uuid, text, text) to authenticated;
grant execute on function public.colonia_create_group(uuid, text, integer, integer, integer, text) to authenticated;
grant execute on function public.colonia_create_activity(uuid, text, text, date, text, text, text) to authenticated;
grant execute on function public.colonia_record_payment(uuid, text, numeric, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
