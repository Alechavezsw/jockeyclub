-- Colonia completar: seguridad anon, externos, MP preparado (flag off), comprobantes, comunicaciones.
-- No tocar outstanding_balance / dues / Galicia / tenis.
-- Mercado Pago Colonia permanece DESHABILITADO hasta autorizacion (app_settings).

-- ---------------------------------------------------------------------------
-- 1) Seguridad: revocar privilegios de anon sobre datos privados Colonia
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'colonia_students',
    'colonia_guardians',
    'colonia_enrollments',
    'colonia_charges',
    'colonia_payments',
    'colonia_attendance',
    'colonia_authorizations',
    'colonia_student_health',
    'colonia_guardian_authorizations',
    'colonia_audit_logs',
    'colonia_sibling_groups',
    'colonia_groups',
    'colonia_activities',
    'colonia_tariffs'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on table public.%I from anon', t);
      execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
      execute format('grant all on table public.%I to service_role', t);
    end if;
  end loop;
  -- Temporada publica (lectura) puede seguir visible a autenticados; anon no.
  if to_regclass('public.colonia_seasons') is not null then
    revoke all on table public.colonia_seasons from anon;
    grant select on table public.colonia_seasons to authenticated;
    grant all on table public.colonia_seasons to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Flag de feature: MP Colonia off por defecto
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value, updated_at)
values (
  'colonia_mp_live',
  jsonb_build_object('enabled', false, 'note', 'Requiere autorizacion expresa de despliegue'),
  now()
)
on conflict (key) do update
set value = coalesce(public.app_settings.value, '{}'::jsonb)
  || jsonb_build_object('enabled', false),
    updated_at = now();

create or replace function public.colonia_mp_is_live()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (value->>'enabled')::boolean from public.app_settings where key = 'colonia_mp_live'),
    false
  );
$$;

revoke all on function public.colonia_mp_is_live() from public, anon;
grant execute on function public.colonia_mp_is_live() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Responsables externos (NO son members)
-- ---------------------------------------------------------------------------
create table if not exists public.colonia_external_guardians (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique,
  full_name text not null,
  document_number text,
  email text not null,
  phone text,
  email_verified_at timestamptz,
  status text not null default 'pending_verification'
    check (status in ('pending_verification', 'active', 'suspended', 'cancelled')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists colonia_ext_guard_email_idx
  on public.colonia_external_guardians (lower(email));

alter table public.colonia_external_guardians enable row level security;

drop policy if exists colonia_ext_guard_staff on public.colonia_external_guardians;
create policy colonia_ext_guard_staff on public.colonia_external_guardians
  for all to authenticated
  using (public.colonia_has_cap('colonia.operate') or public.colonia_has_cap('colonia.collect'))
  with check (public.colonia_has_cap('colonia.operate'));

drop policy if exists colonia_ext_guard_self on public.colonia_external_guardians;
create policy colonia_ext_guard_self on public.colonia_external_guardians
  for select to authenticated
  using (profile_id = auth.uid());

revoke all on table public.colonia_external_guardians from public, anon;
grant select, insert, update on table public.colonia_external_guardians to authenticated;
grant all on table public.colonia_external_guardians to service_role;

alter table public.colonia_guardians
  add column if not exists external_guardian_id uuid references public.colonia_external_guardians(id);

alter table public.colonia_enrollments
  add column if not exists external_guardian_id uuid references public.colonia_external_guardians(id);

-- ---------------------------------------------------------------------------
-- 4) Cola de comunicaciones + comprobantes Colonia
-- ---------------------------------------------------------------------------
create table if not exists public.colonia_notification_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  enrollment_id uuid references public.colonia_enrollments(id) on delete set null,
  payment_id uuid references public.colonia_payments(id) on delete set null,
  recipient_email text,
  recipient_member_id uuid,
  external_guardian_id uuid references public.colonia_external_guardians(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'failed', 'cancelled', 'dry_run')),
  idempotency_key text not null,
  attempts int not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (idempotency_key)
);

create index if not exists colonia_notif_status_idx
  on public.colonia_notification_jobs (status, created_at);

alter table public.colonia_notification_jobs enable row level security;
drop policy if exists colonia_notif_staff on public.colonia_notification_jobs;
create policy colonia_notif_staff on public.colonia_notification_jobs
  for all to authenticated
  using (public.colonia_has_cap('colonia.operate') or public.colonia_has_cap('colonia.report'))
  with check (public.colonia_has_cap('colonia.operate'));

revoke all on table public.colonia_notification_jobs from public, anon;
grant select on table public.colonia_notification_jobs to authenticated;
grant all on table public.colonia_notification_jobs to service_role;

alter table public.colonia_payments
  add column if not exists receipt_delivered_at timestamptz;
alter table public.colonia_payments
  add column if not exists receipt_email_id text;
alter table public.colonia_payments
  add column if not exists receipt_status text;

-- ---------------------------------------------------------------------------
-- 5) Permitir kind=colonia en mp_intents (sin activar cobros)
-- ---------------------------------------------------------------------------
do $$
declare
  cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'mp_intents'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%kind%';
  if cname is not null then
    execute format('alter table public.mp_intents drop constraint %I', cname);
  end if;
  alter table public.mp_intents
    add constraint mp_intents_kind_chk
    check (kind in ('dues', 'pool', 'subscription', 'booking', 'reservation', 'colonia'));
exception when others then
  raise notice 'mp_intents kind chk: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- 6) RPCs externos + notificaciones + MP Colonia (flag gated)
-- ---------------------------------------------------------------------------
create or replace function public.colonia_register_external_guardian(
  p_full_name text,
  p_email text,
  p_phone text default null,
  p_document_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.colonia_external_guardians;
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
begin
  if auth.uid() is null then raise exception 'Tenés que estar logueado.'; end if;
  if v_name is null then raise exception 'Indicá tu nombre.'; end if;
  if v_email is null or position('@' in v_email) < 2 then
    raise exception 'Indicá un correo válido.';
  end if;

  insert into public.colonia_external_guardians (
    profile_id, full_name, document_number, email, phone, status
  ) values (
    auth.uid(), v_name, nullif(btrim(coalesce(p_document_number, '')), ''),
    v_email, nullif(btrim(coalesce(p_phone, '')), ''), 'pending_verification'
  )
  on conflict (profile_id) do update
  set full_name = excluded.full_name,
      document_number = coalesce(excluded.document_number, public.colonia_external_guardians.document_number),
      email = excluded.email,
      phone = coalesce(excluded.phone, public.colonia_external_guardians.phone),
      updated_at = now()
  returning * into v_row;

  return jsonb_build_object('ok', true, 'guardian', to_jsonb(v_row), 'creates_member', false);
end;
$$;

create or replace function public.colonia_mark_external_email_verified()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.colonia_external_guardians;
begin
  if auth.uid() is null then raise exception 'Tenés que estar logueado.'; end if;
  update public.colonia_external_guardians
  set email_verified_at = coalesce(email_verified_at, now()),
      status = case when status = 'pending_verification' then 'active' else status end,
      updated_at = now()
  where profile_id = auth.uid()
  returning * into v_row;
  if not found then raise exception 'No hay responsable externo para esta sesión.'; end if;
  return jsonb_build_object('ok', true, 'guardian', to_jsonb(v_row));
end;
$$;

create or replace function public.colonia_enqueue_notification(
  p_kind text,
  p_enrollment_id uuid default null,
  p_payment_id uuid default null,
  p_recipient_email text default null,
  p_recipient_member_id uuid default null,
  p_external_guardian_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_idempotency_key text default null,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := coalesce(nullif(btrim(coalesce(p_idempotency_key, '')), ''), p_kind || ':' || coalesce(p_enrollment_id::text, '') || ':' || coalesce(p_payment_id::text, 'x'));
  v_row public.colonia_notification_jobs;
  v_status text := case when coalesce(p_dry_run, true) then 'dry_run' else 'queued' end;
begin
  insert into public.colonia_notification_jobs (
    kind, enrollment_id, payment_id, recipient_email, recipient_member_id,
    external_guardian_id, payload, status, idempotency_key
  ) values (
    btrim(p_kind), p_enrollment_id, p_payment_id,
    nullif(btrim(coalesce(p_recipient_email, '')), ''),
    p_recipient_member_id, p_external_guardian_id,
    coalesce(p_payload, '{}'::jsonb), v_status, v_key
  )
  on conflict (idempotency_key) do update
  set updated_at = now()
  returning * into v_row;

  return jsonb_build_object('ok', true, 'job', to_jsonb(v_row), 'duplicate', v_row.created_at < v_row.updated_at - interval '1 second');
end;
$$;

-- Acreditación MP Colonia: solo service_role / cuando flag live (edges no desplegados aún).
create or replace function public.colonia_apply_mp_approved_payment(
  p_intent_id uuid,
  p_provider_payment_id text,
  p_amount numeric,
  p_currency text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent public.mp_intents;
  v_enroll public.colonia_enrollments;
  v_pay public.colonia_payments;
  v_amount numeric := round(coalesce(p_amount, 0)::numeric, 2);
  v_currency text := upper(nullif(btrim(coalesce(p_currency, '')), ''));
  v_status text := lower(nullif(btrim(coalesce(p_status, '')), ''));
  v_expected numeric;
  v_enrollment_id uuid;
begin
  perform set_config('jc.colonia_tx', 'on', true);

  if not public.colonia_mp_is_live() then
    raise exception 'Mercado Pago Colonia está deshabilitado (colonia_mp_live=false).';
  end if;
  if auth.role() is distinct from 'service_role' and not public.colonia_has_cap('colonia.collect') then
    raise exception 'Sin permiso para acreditar MP Colonia.';
  end if;
  if v_status is distinct from 'approved' then
    raise exception 'Solo se acredita estado approved.';
  end if;
  if v_currency is distinct from 'ARS' then
    raise exception 'Moneda inválida para Colonia (ARS).';
  end if;
  if v_amount <= 0 then raise exception 'Importe inválido.'; end if;

  select * into v_intent from public.mp_intents where id = p_intent_id for update;
  if not found then raise exception 'Intent MP no encontrado.'; end if;
  if lower(coalesce(v_intent.kind, '')) is distinct from 'colonia' then
    raise exception 'Intent no es kind=colonia.';
  end if;
  if v_intent.status = 'applied' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'intent_id', v_intent.id);
  end if;

  v_expected := round(coalesce(v_intent.amount, 0)::numeric, 2);
  if abs(v_expected - v_amount) > 0.01 then
    raise exception 'Importe MP no coincide con el intent Colonia.';
  end if;

  v_enrollment_id := nullif(v_intent.meta->>'enrollment_id', '')::uuid;
  if v_enrollment_id is null then raise exception 'Intent Colonia sin enrollment_id.'; end if;
  select * into v_enroll from public.colonia_enrollments where id = v_enrollment_id for update;
  if not found then raise exception 'Inscripción Colonia no encontrada.'; end if;

  if nullif(btrim(coalesce(p_provider_payment_id, '')), '') is not null then
    select * into v_pay from public.colonia_payments
    where external_reference = btrim(p_provider_payment_id)
       or idempotency_key = 'mp:' || p_intent_id::text
    limit 1;
    if found and v_pay.status = 'confirmed' then
      update public.mp_intents
      set status = 'applied', applied_at = coalesce(applied_at, now()), provider_payment_id = p_provider_payment_id
      where id = v_intent.id;
      return jsonb_build_object('ok', true, 'duplicate', true, 'payment', to_jsonb(v_pay));
    end if;
  end if;

  insert into public.colonia_payments (
    season_id, enrollment_id, student_id, guardian_id,
    method, amount, status, external_reference, idempotency_key,
    confirmed_at, income_class, meta
  ) values (
    v_enroll.season_id, v_enroll.id, v_enroll.student_id, v_enroll.guardian_id,
    'mercadopago', v_amount, 'confirmed',
    nullif(btrim(coalesce(p_provider_payment_id, '')), ''),
    'mp:' || p_intent_id::text,
    now(), 'COLONIA',
    jsonb_build_object(
      'source', 'mercadopago',
      'intent_id', p_intent_id,
      'affects_social_dues', false,
      'affects_member_outstanding_balance', false
    )
  )
  on conflict (idempotency_key) do update
  set status = 'confirmed',
      confirmed_at = coalesce(public.colonia_payments.confirmed_at, now()),
      external_reference = coalesce(excluded.external_reference, public.colonia_payments.external_reference)
  returning * into v_pay;

  update public.mp_intents
  set status = 'applied',
      applied_at = now(),
      provider_payment_id = coalesce(nullif(btrim(coalesce(p_provider_payment_id, '')), ''), provider_payment_id),
      meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('colonia_payment_id', v_pay.id)
  where id = v_intent.id;

  update public.colonia_enrollments
  set status = case when status = 'cancelada' then status else 'confirmada' end,
      updated_at = now()
  where id = v_enroll.id;

  perform public.colonia_enqueue_notification(
    'pago_confirmado',
    v_enroll.id,
    v_pay.id,
    null,
    null,
    v_enroll.external_guardian_id,
    jsonb_build_object('amount', v_amount, 'method', 'mercadopago'),
    'pago_confirmado:' || v_pay.id::text,
    true
  );
  perform public.colonia_enqueue_notification(
    'comprobante_disponible',
    v_enroll.id,
    v_pay.id,
    null,
    null,
    v_enroll.external_guardian_id,
    jsonb_build_object('payment_id', v_pay.id),
    'comprobante:' || v_pay.id::text,
    true
  );

  return jsonb_build_object(
    'ok', true,
    'payment', to_jsonb(v_pay),
    'affects_social_dues', false,
    'affects_member_outstanding_balance', false
  );
end;
$$;

-- Marca comprobante entregado (idempotente).
create or replace function public.colonia_mark_receipt_delivered(
  p_payment_id uuid,
  p_email_id text default null,
  p_status text default 'sent'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.colonia_payments;
begin
  if not public.colonia_has_cap('colonia.collect')
     and not public.colonia_has_cap('colonia.operate')
     and auth.role() is distinct from 'service_role' then
    raise exception 'Sin permiso.';
  end if;
  update public.colonia_payments
  set receipt_delivered_at = coalesce(receipt_delivered_at, now()),
      receipt_email_id = coalesce(nullif(btrim(coalesce(p_email_id, '')), ''), receipt_email_id),
      receipt_status = coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'sent')
  where id = p_payment_id
  returning * into v_pay;
  if not found then raise exception 'Pago no encontrado.'; end if;
  return jsonb_build_object('ok', true, 'payment', to_jsonb(v_pay));
end;
$$;

create or replace function public.colonia_submit_external_enrollment(
  p_season_id uuid,
  p_student jsonb,
  p_plan_key text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ext public.colonia_external_guardians;
  v_season public.colonia_seasons;
  v_student public.colonia_students;
  v_guardian public.colonia_guardians;
  v_enroll public.colonia_enrollments;
  v_identity text;
  v_age int;
  v_plan text := lower(nullif(btrim(coalesce(p_plan_key, '')), ''));
begin
  if auth.uid() is null then raise exception 'Tenés que estar logueado.'; end if;
  select * into v_ext from public.colonia_external_guardians where profile_id = auth.uid();
  if not found then raise exception 'Registrá el responsable externo primero.'; end if;
  if v_ext.email_verified_at is null and v_ext.status is distinct from 'active' then
    raise exception 'Verificá el correo antes de inscribir.';
  end if;
  select * into v_season from public.colonia_seasons where id = p_season_id;
  if not found then raise exception 'Temporada no encontrada.'; end if;
  if current_date < v_season.enrollment_opens_on or current_date > v_season.enrollment_closes_on then
    raise exception 'Fuera del período de inscripción publicado.';
  end if;
  if v_plan is null or v_plan not in ('cuota', 'temporada', 'hermano_4') then
    raise exception 'Plan no habilitado.';
  end if;
  if nullif(btrim(coalesce(p_student->>'full_name', '')), '') is null then
    raise exception 'Falta el nombre del alumno.';
  end if;
  if nullif(btrim(coalesce(p_student->>'birth_date', '')), '') is null then
    raise exception 'Falta la fecha de nacimiento.';
  end if;
  -- Edad al inicio de actividades (regla de temporada).
  v_age := date_part(
    'year',
    age(v_season.activities_start_on, (p_student->>'birth_date')::date)
  )::int;
  if v_age < coalesce(v_season.age_min, 3) or v_age > coalesce(v_season.age_max, 15) then
    raise exception 'Edad fuera del rango de la Colonia (%–% años).',
      coalesce(v_season.age_min, 3), coalesce(v_season.age_max, 15);
  end if;

  v_identity := nullif(btrim(coalesce(p_student->>'identity_key', '')), '');
  if v_identity is null then
    v_identity := 'dni:' || regexp_replace(coalesce(p_student->>'document_number', ''), '\D', '', 'g');
  end if;
  if v_identity is null or v_identity = 'dni:' then
    raise exception 'Falta identificar al alumno.';
  end if;

  if p_idempotency_key is not null then
    select * into v_enroll from public.colonia_enrollments
    where portal_meta->>'idempotency_key' = p_idempotency_key limit 1;
    if found then
      return jsonb_build_object('ok', true, 'duplicate', true, 'enrollment', to_jsonb(v_enroll));
    end if;
  end if;

  select * into v_student from public.colonia_students where identity_key = v_identity limit 1;
  if found then
    update public.colonia_students
    set full_name = coalesce(nullif(btrim(p_student->>'full_name'), ''), full_name),
        birth_date = coalesce((p_student->>'birth_date')::date, birth_date),
        member_kind = 'no_socio',
        shirt_size = coalesce(nullif(btrim(p_student->>'shirt_size'), ''), shirt_size),
        updated_at = now()
    where id = v_student.id
    returning * into v_student;
  else
    insert into public.colonia_students (
      full_name, document_number, birth_date, member_kind, shirt_size, identity_key
    ) values (
      btrim(p_student->>'full_name'),
      nullif(btrim(p_student->>'document_number'), ''),
      (p_student->>'birth_date')::date,
      'no_socio',
      nullif(btrim(p_student->>'shirt_size'), ''),
      v_identity
    ) returning * into v_student;
  end if;

  insert into public.colonia_guardians (
    full_name, document_number, relationship, phone, email, member_id, external_guardian_id
  ) values (
    v_ext.full_name, v_ext.document_number, 'Responsable externo',
    v_ext.phone, v_ext.email, null, v_ext.id
  ) returning * into v_guardian;

  -- Autorización del externo: vínculo enrollment.external_guardian_id (no usa members).
  select * into v_enroll from public.colonia_enrollments
  where season_id = p_season_id and student_id = v_student.id;
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'enrollment', to_jsonb(v_enroll));
  end if;

  insert into public.colonia_enrollments (
    season_id, student_id, guardian_id, plan_key, status, source,
    external_guardian_id, shirt_size, portal_meta
  ) values (
    p_season_id, v_student.id, v_guardian.id, v_plan, 'pendiente', 'external',
    v_ext.id, nullif(btrim(p_student->>'shirt_size'), ''),
    jsonb_build_object('idempotency_key', p_idempotency_key, 'external', true)
  ) returning * into v_enroll;

  perform public.colonia_enqueue_notification(
    'solicitud_recibida', v_enroll.id, null, v_ext.email, null, v_ext.id,
    jsonb_build_object('source', 'external'), 'solicitud:' || v_enroll.id::text, true
  );

  return jsonb_build_object('ok', true, 'enrollment', to_jsonb(v_enroll), 'creates_member', false);
end;
$$;

create or replace function public.colonia_list_for_external_guardian()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ext public.colonia_external_guardians;
begin
  if auth.uid() is null then raise exception 'Tenés que estar logueado.'; end if;
  select * into v_ext from public.colonia_external_guardians where profile_id = auth.uid();
  if not found then
    return jsonb_build_object('ok', true, 'guardian', null, 'enrollments', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'ok', true,
    'guardian', to_jsonb(v_ext),
    'enrollments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'enrollment', to_jsonb(e),
        'student', to_jsonb(s),
        'charges', coalesce((
          select jsonb_agg(to_jsonb(c) order by c.created_at)
          from public.colonia_charges c where c.enrollment_id = e.id and c.status = 'posted'
        ), '[]'::jsonb),
        'payments', coalesce((
          select jsonb_agg(to_jsonb(p) order by p.created_at)
          from public.colonia_payments p where p.enrollment_id = e.id
        ), '[]'::jsonb)
      ) order by e.created_at desc)
      from public.colonia_enrollments e
      join public.colonia_students s on s.id = e.student_id
      where e.external_guardian_id = v_ext.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.colonia_list_for_external_guardian() from public, anon;
grant execute on function public.colonia_list_for_external_guardian() to authenticated;

revoke all on function public.colonia_submit_external_enrollment(uuid, jsonb, text, text) from public, anon;
grant execute on function public.colonia_submit_external_enrollment(uuid, jsonb, text, text) to authenticated;

revoke all on function public.colonia_register_external_guardian(text, text, text, text) from public, anon;
revoke all on function public.colonia_mark_external_email_verified() from public, anon;
revoke all on function public.colonia_enqueue_notification(text, uuid, uuid, text, uuid, uuid, jsonb, text, boolean) from public, anon;
revoke all on function public.colonia_apply_mp_approved_payment(uuid, text, numeric, text, text) from public, anon, authenticated;
revoke all on function public.colonia_mark_receipt_delivered(uuid, text, text) from public, anon;

grant execute on function public.colonia_register_external_guardian(text, text, text, text) to authenticated;
grant execute on function public.colonia_mark_external_email_verified() to authenticated;
grant execute on function public.colonia_enqueue_notification(text, uuid, uuid, text, uuid, uuid, jsonb, text, boolean) to authenticated, service_role;
grant execute on function public.colonia_apply_mp_approved_payment(uuid, text, numeric, text, text) to service_role;
grant execute on function public.colonia_mark_receipt_delivered(uuid, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
