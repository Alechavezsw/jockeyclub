-- Modulo Colonia de Verano (independiente de cuota social).
-- No tocar members.outstanding_balance ni dues_imputations.
-- No aplicar en produccion sin autorizacion.

-- Cuenta de ingreso Colonia (idempotente por code).
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

insert into public.role_capabilities (capability, role_key)
select *
from (values
  ('colonia.operate', 'admin'),
  ('colonia.operate', 'superadmin'),
  ('colonia.operate', 'accountant'),
  ('colonia.operate', 'admin_employee'),
  ('colonia.collect', 'admin'),
  ('colonia.collect', 'superadmin'),
  ('colonia.collect', 'cashier'),
  ('colonia.collect', 'accountant'),
  ('colonia.attend', 'admin'),
  ('colonia.attend', 'superadmin'),
  ('colonia.attend', 'admin_employee'),
  ('colonia.report', 'admin'),
  ('colonia.report', 'superadmin'),
  ('colonia.report', 'accountant')
) as v(capability, role_key)
where exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'role_capabilities')
on conflict do nothing;

create table if not exists public.colonia_seasons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  enrollment_opens_on date not null,
  enrollment_closes_on date not null,
  activities_start_on date not null,
  activities_end_on date,
  schedule_days text not null default 'lunes_a_viernes',
  schedule_hours text not null default '09:00-13:00',
  age_min integer not null default 3,
  age_max integer not null default 15,
  contacts jsonb not null default '[]'::jsonb,
  promotion_periodicity text,
  capacity integer,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint colonia_seasons_promo_chk check (
    promotion_periodicity is null
    or promotion_periodicity in ('monthly', 'season')
  )
);

create table if not exists public.colonia_tariffs (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.colonia_seasons(id) on delete cascade,
  version integer not null default 1,
  member_kind text not null,
  plan_key text not null,
  concept text not null,
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null default 'ARS',
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  unique (season_id, version, member_kind, plan_key)
);

create table if not exists public.colonia_guardians (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  document_number text,
  relationship text,
  phone text,
  email text,
  address text,
  emergency_contact text,
  authorized_pickup text,
  member_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.colonia_students (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  document_number text,
  birth_date date not null,
  member_kind text not null check (member_kind in ('socio', 'no_socio')),
  member_id uuid,
  member_number text,
  shirt_size text,
  notes text,
  identity_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists colonia_students_identity_idx on public.colonia_students (identity_key);
create index if not exists colonia_students_member_idx on public.colonia_students (member_id);

create table if not exists public.colonia_sibling_groups (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.colonia_seasons(id) on delete cascade,
  guardian_id uuid references public.colonia_guardians(id),
  label text,
  promotion_plan text,
  created_at timestamptz not null default now()
);

create table if not exists public.colonia_enrollments (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.colonia_seasons(id) on delete restrict,
  student_id uuid not null references public.colonia_students(id) on delete restrict,
  guardian_id uuid not null references public.colonia_guardians(id) on delete restrict,
  sibling_group_id uuid references public.colonia_sibling_groups(id),
  plan_key text not null,
  status text not null default 'pendiente'
    check (status in ('borrador', 'pendiente', 'confirmada', 'cancelada')),
  group_id uuid,
  observations text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_id, student_id)
);

create table if not exists public.colonia_groups (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.colonia_seasons(id) on delete cascade,
  name text not null,
  age_from integer,
  age_to integer,
  capacity integer,
  lead_name text,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.colonia_enrollments
  drop constraint if exists colonia_enrollments_group_id_fkey;
alter table public.colonia_enrollments
  add constraint colonia_enrollments_group_id_fkey
  foreign key (group_id) references public.colonia_groups(id);

create table if not exists public.colonia_charges (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.colonia_seasons(id),
  enrollment_id uuid not null references public.colonia_enrollments(id) on delete restrict,
  student_id uuid references public.colonia_students(id),
  sibling_group_id uuid references public.colonia_sibling_groups(id),
  concept text not null,
  plan_key text,
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null default 'ARS',
  status text not null default 'posted' check (status in ('posted', 'void')),
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text
);

create index if not exists colonia_charges_enrollment_idx on public.colonia_charges (enrollment_id);

create table if not exists public.colonia_payments (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.colonia_seasons(id),
  enrollment_id uuid not null references public.colonia_enrollments(id) on delete restrict,
  student_id uuid references public.colonia_students(id),
  guardian_id uuid references public.colonia_guardians(id),
  method text not null,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'ARS',
  status text not null check (status in ('pending', 'confirmed', 'rejected', 'cancelled')),
  external_reference text,
  receipt_url text,
  idempotency_key text unique,
  income_class text not null default 'COLONIA',
  operator_id uuid,
  operator_name text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);

create index if not exists colonia_payments_enrollment_idx on public.colonia_payments (enrollment_id, status);

create table if not exists public.colonia_attendance (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.colonia_seasons(id),
  enrollment_id uuid not null references public.colonia_enrollments(id) on delete cascade,
  student_id uuid not null references public.colonia_students(id),
  day date not null,
  status text not null check (status in ('presente', 'ausente', 'justificada', 'retiro_anticipado')),
  operator_id uuid,
  operator_name text,
  note text,
  created_at timestamptz not null default now(),
  unique (enrollment_id, day)
);

create table if not exists public.colonia_activities (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.colonia_seasons(id) on delete cascade,
  kind text not null check (kind in ('natacion', 'recreacion', 'excursion', 'campamento')),
  title text not null,
  activity_date date,
  place text,
  lead_name text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.colonia_authorizations (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.colonia_seasons(id),
  enrollment_id uuid not null references public.colonia_enrollments(id) on delete cascade,
  activity_id uuid references public.colonia_activities(id),
  kind text not null,
  granted boolean not null default false,
  granted_at timestamptz,
  granted_by_name text,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.colonia_audit_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid,
  actor_name text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists colonia_audit_created_idx on public.colonia_audit_logs (created_at desc);

-- Temporada oficial 2026/2027 + tarifas seed (promotion_periodicity null = ambiguas bloqueadas).
insert into public.colonia_seasons (
  code, name, enrollment_opens_on, enrollment_closes_on, activities_start_on,
  activities_end_on, contacts, promotion_periodicity
) values (
  '2026-2027',
  'Escuela de Natacion y Colonia de Verano 2026/2027',
  '2026-11-24',
  '2026-11-30',
  '2026-11-30',
  null,
  '["2644584263","2644170053","2646273314"]'::jsonb,
  null
) on conflict (code) do nothing;

insert into public.colonia_tariffs (season_id, version, member_kind, plan_key, concept, amount, effective_from)
select s.id, 1, v.member_kind, v.plan_key, v.concept, v.amount, '2026-11-24'
from public.colonia_seasons s
cross join (values
  ('any', 'inscripcion', 'colonia_inscripcion', 50000),
  ('socio', 'cuota', 'colonia_cuota', 150000),
  ('socio', 'temporada', 'colonia_temporada', 390000),
  ('socio', 'promo_2', 'colonia_promocion', 280000),
  ('socio', 'promo_3', 'colonia_promocion', 410000),
  ('socio', 'hermano_4', 'colonia_promocion', 0),
  ('no_socio', 'cuota', 'colonia_cuota', 180000),
  ('no_socio', 'temporada', 'colonia_temporada', 490000),
  ('no_socio', 'promo_2', 'colonia_promocion', 340000),
  ('no_socio', 'promo_3', 'colonia_promocion', 500000),
  ('no_socio', 'hermano_4', 'colonia_promocion', 0)
) as v(member_kind, plan_key, concept, amount)
where s.code = '2026-2027'
on conflict do nothing;

alter table public.colonia_seasons enable row level security;
alter table public.colonia_tariffs enable row level security;
alter table public.colonia_guardians enable row level security;
alter table public.colonia_students enable row level security;
alter table public.colonia_sibling_groups enable row level security;
alter table public.colonia_enrollments enable row level security;
alter table public.colonia_groups enable row level security;
alter table public.colonia_charges enable row level security;
alter table public.colonia_payments enable row level security;
alter table public.colonia_attendance enable row level security;
alter table public.colonia_activities enable row level security;
alter table public.colonia_authorizations enable row level security;
alter table public.colonia_audit_logs enable row level security;

create or replace function public.colonia_has_cap(p_cap text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.has_admin_access(), false)
    or coalesce(public.has_capability(p_cap), false);
$$;

do $$
begin
  -- Politicas: lectura/escritura acotada por capability.
  execute $p$
    drop policy if exists colonia_seasons_all on public.colonia_seasons;
    create policy colonia_seasons_all on public.colonia_seasons for all to authenticated
      using (public.colonia_has_cap('colonia.operate') or public.colonia_has_cap('colonia.report'))
      with check (public.colonia_has_cap('colonia.operate'));
  $p$;
exception when others then
  raise notice 'colonia RLS seasons: %', sqlerrm;
end $$;

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
      'affects_member_balance', false
    )
  );

  return jsonb_build_object('ok', true, 'payment', to_jsonb(v_payment));
end;
$$;

create or replace function public.colonia_post_charge(
  p_enrollment_id uuid,
  p_concept text,
  p_plan_key text,
  p_amount numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enroll public.colonia_enrollments;
  v_charge public.colonia_charges;
  v_amount numeric := round(coalesce(p_amount, 0)::numeric, 2);
begin
  if auth.uid() is null then raise exception 'Tenés que estar logueado.'; end if;
  if not public.colonia_has_cap('colonia.operate') and not public.colonia_has_cap('colonia.collect') then
    raise exception 'Sin permiso para cargar Colonia.';
  end if;
  if v_amount < 0 then raise exception 'Importe inválido.'; end if;

  select * into v_enroll from public.colonia_enrollments where id = p_enrollment_id for update;
  if not found then raise exception 'Inscripción no encontrada.'; end if;

  insert into public.colonia_charges (
    season_id, enrollment_id, student_id, sibling_group_id,
    concept, plan_key, amount, note, created_by
  ) values (
    v_enroll.season_id, v_enroll.id, v_enroll.student_id, v_enroll.sibling_group_id,
    p_concept, p_plan_key, v_amount, p_note, auth.uid()
  ) returning * into v_charge;

  insert into public.colonia_audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (
    auth.uid(), 'colonia_charge_posted', 'colonia_charges', v_charge.id,
    jsonb_build_object('amount', v_amount, 'concept', p_concept, 'affects_member_balance', false)
  );

  return jsonb_build_object('ok', true, 'charge', to_jsonb(v_charge));
end;
$$;

create or replace function public.colonia_upsert_attendance(
  p_enrollment_id uuid,
  p_day date,
  p_status text,
  p_operator_name text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enroll public.colonia_enrollments;
  v_row public.colonia_attendance;
  v_status text := lower(nullif(btrim(coalesce(p_status, '')), ''));
begin
  if auth.uid() is null then raise exception 'Tenés que estar logueado.'; end if;
  if not public.colonia_has_cap('colonia.attend') and not public.colonia_has_cap('colonia.operate') then
    raise exception 'Sin permiso para asistencia de Colonia.';
  end if;
  if v_status is null or v_status not in ('presente', 'ausente', 'justificada', 'retiro_anticipado') then
    raise exception 'Estado de asistencia inválido.';
  end if;

  select * into v_enroll from public.colonia_enrollments where id = p_enrollment_id;
  if not found then raise exception 'Inscripción no encontrada.'; end if;

  insert into public.colonia_attendance (
    season_id, enrollment_id, student_id, day, status, operator_id, operator_name, note
  ) values (
    v_enroll.season_id, v_enroll.id, v_enroll.student_id, p_day, v_status, auth.uid(), p_operator_name, p_note
  )
  on conflict (enrollment_id, day) do update
    set status = excluded.status,
        operator_id = excluded.operator_id,
        operator_name = excluded.operator_name,
        note = excluded.note
  returning * into v_row;

  return jsonb_build_object('ok', true, 'attendance', to_jsonb(v_row));
end;
$$;

create or replace function public.colonia_dashboard_stats(p_season_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stats jsonb;
begin
  if auth.uid() is null then raise exception 'Tenés que estar logueado.'; end if;
  if not (
    public.colonia_has_cap('colonia.operate')
    or public.colonia_has_cap('colonia.report')
    or public.colonia_has_cap('colonia.collect')
  ) then
    raise exception 'Sin permiso para reportes de Colonia.';
  end if;

  select jsonb_build_object(
    'enrolled', (select count(*) from public.colonia_enrollments e where e.season_id = p_season_id and e.status <> 'cancelada'),
    'confirmed', (select count(*) from public.colonia_enrollments e where e.season_id = p_season_id and e.status = 'confirmada'),
    'pending', (select count(*) from public.colonia_enrollments e where e.season_id = p_season_id and e.status = 'pendiente'),
    'socio', (
      select count(*) from public.colonia_enrollments e
      join public.colonia_students s on s.id = e.student_id
      where e.season_id = p_season_id and e.status <> 'cancelada' and s.member_kind = 'socio'
    ),
    'no_socio', (
      select count(*) from public.colonia_enrollments e
      join public.colonia_students s on s.id = e.student_id
      where e.season_id = p_season_id and e.status <> 'cancelada' and s.member_kind = 'no_socio'
    ),
    'charges_total', coalesce((select sum(amount) from public.colonia_charges c where c.season_id = p_season_id and c.status = 'posted'), 0),
    'payments_confirmed', coalesce((select sum(amount) from public.colonia_payments p where p.season_id = p_season_id and p.status = 'confirmed'), 0),
    'payments_pending', coalesce((select sum(amount) from public.colonia_payments p where p.season_id = p_season_id and p.status = 'pending'), 0),
    'balance_due', (
      coalesce((select sum(amount) from public.colonia_charges c where c.season_id = p_season_id and c.status = 'posted'), 0)
      - coalesce((select sum(amount) from public.colonia_payments p where p.season_id = p_season_id and p.status = 'confirmed'), 0)
    ),
    'attendance_today', (
      select count(*) from public.colonia_attendance a
      where a.season_id = p_season_id and a.day = (timezone('America/Argentina/Buenos_Aires', now()))::date
        and a.status = 'presente'
    ),
    'sibling_groups', (select count(*) from public.colonia_sibling_groups g where g.season_id = p_season_id)
  ) into v_stats;

  return coalesce(v_stats, '{}'::jsonb);
end;
$$;

revoke all on function public.colonia_record_payment(uuid, text, numeric, text, text, text, text) from public, anon;
revoke all on function public.colonia_post_charge(uuid, text, text, numeric, text) from public, anon;
revoke all on function public.colonia_upsert_attendance(uuid, date, text, text, text) from public, anon;
revoke all on function public.colonia_dashboard_stats(uuid) from public, anon;

grant execute on function public.colonia_record_payment(uuid, text, numeric, text, text, text, text) to authenticated;
grant execute on function public.colonia_post_charge(uuid, text, text, numeric, text) to authenticated;
grant execute on function public.colonia_upsert_attendance(uuid, date, text, text, text) to authenticated;
grant execute on function public.colonia_dashboard_stats(uuid) to authenticated;

notify pgrst, 'reload schema';
