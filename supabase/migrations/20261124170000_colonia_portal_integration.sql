-- Colonia: integracion portal / societario / caja.
-- No reaplicar migraciones 140000/150000/160000.
-- No tocar outstanding_balance ni dues.

-- Origen de la inscripcion y metadatos de portal.
alter table public.colonia_enrollments
  add column if not exists source text not null default 'admin';
alter table public.colonia_enrollments
  add column if not exists portal_meta jsonb not null default '{}'::jsonb;
alter table public.colonia_enrollments
  add column if not exists submitted_by_member_id uuid;
alter table public.colonia_enrollments
  add column if not exists shirt_size text;
alter table public.colonia_enrollments
  add column if not exists emergency_contact text;
alter table public.colonia_enrollments
  add column if not exists authorized_pickup text;

do $$
begin
  alter table public.colonia_enrollments drop constraint if exists colonia_enrollments_source_chk;
  alter table public.colonia_enrollments
    add constraint colonia_enrollments_source_chk
    check (source in ('admin', 'portal', 'external'));
exception when others then
  raise notice 'colonia source chk: %', sqlerrm;
end $$;

-- Estados: se mantienen los existentes y se agregan observados / pendiente_pago.
do $$
declare
  cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'colonia_enrollments'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%status%';
  if cname is not null then
    execute format('alter table public.colonia_enrollments drop constraint %I', cname);
  end if;
  alter table public.colonia_enrollments
    add constraint colonia_enrollments_status_chk
    check (status in (
      'borrador',
      'pendiente',
      'pendiente_pago',
      'confirmada',
      'observada',
      'cancelada'
    ));
exception when others then
  raise notice 'colonia status chk: %', sqlerrm;
end $$;

-- Autorizacion explicita socio -> menor (no basta el grupo familiar).
create table if not exists public.colonia_guardian_authorizations (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null,
  student_id uuid not null references public.colonia_students(id) on delete cascade,
  relationship text,
  can_enroll boolean not null default true,
  can_view_health boolean not null default false,
  can_pay boolean not null default true,
  granted_by uuid,
  note text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (member_id, student_id)
);

create index if not exists colonia_guard_auth_member_idx
  on public.colonia_guardian_authorizations (member_id)
  where revoked_at is null;

alter table public.colonia_guardian_authorizations enable row level security;

drop policy if exists colonia_guard_auth_staff on public.colonia_guardian_authorizations;
create policy colonia_guard_auth_staff on public.colonia_guardian_authorizations
  for all to authenticated
  using (public.colonia_has_cap('colonia.operate') or public.colonia_has_cap('colonia.collect'))
  with check (public.colonia_has_cap('colonia.operate'));

drop policy if exists colonia_guard_auth_self on public.colonia_guardian_authorizations;
create policy colonia_guard_auth_self on public.colonia_guardian_authorizations
  for select to authenticated
  using (
    member_id in (
      select m.id from public.members m
      where m.profile_id = auth.uid()
         or (m.meta->>'profileId') = auth.uid()::text
    )
  );

-- Helper: el miembro logueado puede operar sobre un alumno.
create or replace function public.colonia_member_may_act_on_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.colonia_guardian_authorizations a
    join public.members m on m.id = a.member_id
    where a.student_id = p_student_id
      and a.revoked_at is null
      and a.can_enroll
      and (
        m.profile_id = auth.uid()
        or (m.meta->>'profileId') = auth.uid()::text
      )
  )
  or public.colonia_has_cap('colonia.operate')
  or public.colonia_has_cap('colonia.collect');
$$;

-- Listar inscripciones Colonia del hogar del socio (ficha / portal).
create or replace function public.colonia_list_for_member(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean := false;
  v_rows jsonb;
begin
  if auth.uid() is null then raise exception 'Tenés que estar logueado.'; end if;

  if public.colonia_has_cap('colonia.operate')
     or public.colonia_has_cap('colonia.collect')
     or public.colonia_has_cap('colonia.report') then
    v_ok := true;
  elsif exists (
    select 1 from public.members m
    where m.id = p_member_id
      and (m.profile_id = auth.uid() or (m.meta->>'profileId') = auth.uid()::text)
  ) then
    v_ok := true;
  end if;

  if not v_ok then
    raise exception 'Sin permiso para consultar Colonia de este socio.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      e.id,
      e.season_id,
      e.plan_key,
      e.status,
      e.source,
      e.created_at,
      e.updated_at,
      e.group_id,
      s.id as student_id,
      s.full_name as student_name,
      s.birth_date,
      s.member_kind,
      s.member_id as student_member_id,
      s.member_number as student_member_number,
      g.full_name as guardian_name,
      g.phone as guardian_phone,
      coalesce((
        select sum(c.amount) from public.colonia_charges c
        where c.enrollment_id = e.id and c.status = 'posted'
      ), 0) as charges_total,
      coalesce((
        select sum(p.amount) from public.colonia_payments p
        where p.enrollment_id = e.id and p.status = 'confirmed'
      ), 0) as payments_confirmed,
      coalesce((
        select sum(p.amount) from public.colonia_payments p
        where p.enrollment_id = e.id and p.status = 'pending'
      ), 0) as payments_pending
    from public.colonia_enrollments e
    join public.colonia_students s on s.id = e.student_id
    join public.colonia_guardians g on g.id = e.guardian_id
    where s.member_id = p_member_id
       or g.member_id = p_member_id
       or e.submitted_by_member_id = p_member_id
       or exists (
         select 1 from public.colonia_guardian_authorizations a
         where a.student_id = s.id
           and a.member_id = p_member_id
           and a.revoked_at is null
       )
  ) x;

  return jsonb_build_object('ok', true, 'enrollments', v_rows);
end;
$$;

-- Solicitud de inscripcion desde portal (idempotente por identity_key + season).
create or replace function public.colonia_submit_portal_enrollment(
  p_season_id uuid,
  p_student jsonb,
  p_guardian jsonb,
  p_plan_key text,
  p_member_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season public.colonia_seasons;
  v_student public.colonia_students;
  v_guardian public.colonia_guardians;
  v_enroll public.colonia_enrollments;
  v_identity text;
  v_kind text;
  v_plan text := lower(nullif(btrim(coalesce(p_plan_key, '')), ''));
begin
  if auth.uid() is null then raise exception 'Tenés que estar logueado.'; end if;
  if p_member_id is null then raise exception 'Falta el socio responsable.'; end if;
  if not exists (
    select 1 from public.members m
    where m.id = p_member_id
      and (m.profile_id = auth.uid() or (m.meta->>'profileId') = auth.uid()::text)
  ) and not public.colonia_has_cap('colonia.operate') then
    raise exception 'Solo el titular autenticado puede enviar la solicitud.';
  end if;

  select * into v_season from public.colonia_seasons where id = p_season_id;
  if not found then raise exception 'Temporada no encontrada.'; end if;
  if current_date < v_season.enrollment_opens_on or current_date > v_season.enrollment_closes_on then
    raise exception 'Fuera del período de inscripción publicado.';
  end if;

  if v_plan is null or v_plan not in ('cuota', 'temporada', 'hermano_4') then
    raise exception 'Plan no habilitado en portal (promociones ambiguas bloqueadas).';
  end if;

  v_kind := lower(coalesce(p_student->>'member_kind', 'socio'));
  if v_kind not in ('socio', 'no_socio') then v_kind := 'socio'; end if;

  v_identity := nullif(btrim(coalesce(p_student->>'identity_key', '')), '');
  if v_identity is null then
    v_identity := 'dni:' || regexp_replace(coalesce(p_student->>'document_number', ''), '\D', '', 'g');
  end if;
  if v_identity is null or v_identity = 'dni:' then
    raise exception 'Falta identificar al alumno.';
  end if;

  if p_idempotency_key is not null then
    select * into v_enroll
    from public.colonia_enrollments
    where portal_meta->>'idempotency_key' = p_idempotency_key
    limit 1;
    if found then
      return jsonb_build_object('ok', true, 'duplicate', true, 'enrollment', to_jsonb(v_enroll));
    end if;
  end if;

  select * into v_student from public.colonia_students where identity_key = v_identity limit 1;
  if found then
    update public.colonia_students
    set full_name = coalesce(nullif(btrim(p_student->>'full_name'), ''), full_name),
        birth_date = coalesce((p_student->>'birth_date')::date, birth_date),
        member_kind = v_kind,
        member_id = coalesce((p_student->>'member_id')::uuid, member_id, case when v_kind = 'socio' then null end),
        member_number = coalesce(nullif(btrim(p_student->>'member_number'), ''), member_number),
        shirt_size = coalesce(nullif(btrim(p_student->>'shirt_size'), ''), shirt_size),
        updated_at = now()
    where id = v_student.id
    returning * into v_student;
  else
    insert into public.colonia_students (
      full_name, document_number, birth_date, member_kind, member_id, member_number, shirt_size, identity_key
    ) values (
      btrim(p_student->>'full_name'),
      nullif(btrim(p_student->>'document_number'), ''),
      (p_student->>'birth_date')::date,
      v_kind,
      nullif(p_student->>'member_id', '')::uuid,
      nullif(btrim(p_student->>'member_number'), ''),
      nullif(btrim(p_student->>'shirt_size'), ''),
      v_identity
    ) returning * into v_student;
  end if;

  insert into public.colonia_guardians (
    full_name, document_number, relationship, phone, email,
    emergency_contact, authorized_pickup, member_id
  ) values (
    btrim(coalesce(p_guardian->>'full_name', '')),
    nullif(btrim(p_guardian->>'document_number'), ''),
    nullif(btrim(p_guardian->>'relationship'), ''),
    nullif(btrim(p_guardian->>'phone'), ''),
    nullif(btrim(p_guardian->>'email'), ''),
    nullif(btrim(p_guardian->>'emergency_contact'), ''),
    nullif(btrim(p_guardian->>'authorized_pickup'), ''),
    p_member_id
  ) returning * into v_guardian;

  insert into public.colonia_guardian_authorizations (
    member_id, student_id, relationship, can_enroll, can_pay, can_view_health, granted_by, note
  ) values (
    p_member_id, v_student.id,
    coalesce(nullif(btrim(p_guardian->>'relationship'), ''), 'Responsable'),
    true, true, false, auth.uid(), 'Alta portal Colonia'
  )
  on conflict (member_id, student_id) do update
  set revoked_at = null,
      can_enroll = true,
      can_pay = true;

  select * into v_enroll
  from public.colonia_enrollments
  where season_id = p_season_id and student_id = v_student.id;
  if found then
    if v_enroll.status = 'cancelada' then
      update public.colonia_enrollments
      set status = 'pendiente',
          plan_key = v_plan,
          source = 'portal',
          guardian_id = v_guardian.id,
          submitted_by_member_id = p_member_id,
          shirt_size = nullif(btrim(p_student->>'shirt_size'), ''),
          emergency_contact = nullif(btrim(p_guardian->>'emergency_contact'), ''),
          authorized_pickup = nullif(btrim(p_guardian->>'authorized_pickup'), ''),
          portal_meta = jsonb_build_object('idempotency_key', p_idempotency_key),
          updated_at = now()
      where id = v_enroll.id
      returning * into v_enroll;
    else
      return jsonb_build_object('ok', true, 'duplicate', true, 'enrollment', to_jsonb(v_enroll));
    end if;
  else
    insert into public.colonia_enrollments (
      season_id, student_id, guardian_id, plan_key, status, source,
      submitted_by_member_id, shirt_size, emergency_contact, authorized_pickup, portal_meta
    ) values (
      p_season_id, v_student.id, v_guardian.id, v_plan, 'pendiente', 'portal',
      p_member_id,
      nullif(btrim(p_student->>'shirt_size'), ''),
      nullif(btrim(p_guardian->>'emergency_contact'), ''),
      nullif(btrim(p_guardian->>'authorized_pickup'), ''),
      jsonb_build_object('idempotency_key', p_idempotency_key)
    ) returning * into v_enroll;
  end if;

  insert into public.colonia_audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (auth.uid(), 'colonia_portal_enrollment_submitted', 'colonia_enrollments', v_enroll.id,
    jsonb_build_object('member_id', p_member_id, 'plan_key', v_plan, 'affects_social_dues', false));

  return jsonb_build_object('ok', true, 'enrollment', to_jsonb(v_enroll), 'student', to_jsonb(v_student));
end;
$$;

-- Aviso de transferencia desde portal (queda pending).
create or replace function public.colonia_report_portal_transfer(
  p_enrollment_id uuid,
  p_amount numeric,
  p_external_reference text,
  p_receipt_url text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enroll public.colonia_enrollments;
  v_pay public.colonia_payments;
  v_amount numeric := round(coalesce(p_amount, 0)::numeric, 2);
begin
  perform set_config('jc.colonia_tx', 'on', true);
  if auth.uid() is null then raise exception 'Tenés que estar logueado.'; end if;
  if v_amount <= 0 then raise exception 'Importe inválido.'; end if;
  if nullif(btrim(coalesce(p_external_reference, '')), '') is null then
    raise exception 'Indicá la referencia de la transferencia.';
  end if;

  select * into v_enroll from public.colonia_enrollments where id = p_enrollment_id for update;
  if not found then raise exception 'Inscripción no encontrada.'; end if;
  if not public.colonia_member_may_act_on_student(v_enroll.student_id) then
    raise exception 'Sin autorización sobre este alumno.';
  end if;
  if v_enroll.status = 'cancelada' then raise exception 'Inscripción cancelada.'; end if;

  if p_idempotency_key is not null then
    select * into v_pay from public.colonia_payments where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('ok', true, 'duplicate', true, 'payment', to_jsonb(v_pay));
    end if;
  end if;

  insert into public.colonia_payments (
    season_id, enrollment_id, student_id, guardian_id,
    method, amount, status, external_reference, receipt_url, idempotency_key,
    operator_id, income_class, meta
  ) values (
    v_enroll.season_id, v_enroll.id, v_enroll.student_id, v_enroll.guardian_id,
    'transferencia', v_amount, 'pending',
    btrim(p_external_reference), p_receipt_url, p_idempotency_key,
    auth.uid(), 'COLONIA',
    jsonb_build_object('source', 'portal', 'affects_social_dues', false)
  ) returning * into v_pay;

  update public.colonia_enrollments
  set status = case when status in ('confirmada', 'cancelada') then status else 'pendiente_pago' end,
      updated_at = now()
  where id = v_enroll.id;

  return jsonb_build_object('ok', true, 'payment', to_jsonb(v_pay));
end;
$$;

revoke all on function public.colonia_list_for_member(uuid) from public, anon;
revoke all on function public.colonia_submit_portal_enrollment(uuid, jsonb, jsonb, text, uuid, text) from public, anon;
revoke all on function public.colonia_report_portal_transfer(uuid, numeric, text, text, text) from public, anon;
revoke all on function public.colonia_member_may_act_on_student(uuid) from public, anon;

grant execute on function public.colonia_list_for_member(uuid) to authenticated;
grant execute on function public.colonia_submit_portal_enrollment(uuid, jsonb, jsonb, text, uuid, text) to authenticated;
grant execute on function public.colonia_report_portal_transfer(uuid, numeric, text, text, text) to authenticated;
grant execute on function public.colonia_member_may_act_on_student(uuid) to authenticated;

-- Ampliar estados aceptados por colonia_update_enrollment (compatibles con CHECK).
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
  if not public.colonia_has_cap('colonia.operate') then
    raise exception 'Sin permiso para modificar inscripciones de Colonia.';
  end if;
  if v_status is not null and v_status not in (
    'borrador', 'pendiente', 'pendiente_pago', 'confirmada', 'observada', 'cancelada'
  ) then
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
    jsonb_build_object('status', v_enroll.status, 'plan_key', v_enroll.plan_key));

  return jsonb_build_object('ok', true, 'enrollment', to_jsonb(v_enroll));
end;
$$;

notify pgrst, 'reload schema';
