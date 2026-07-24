-- =============================================================================
-- Jockey Club San Juan — Fundación de infraestructura (producción)
-- Esquema pensado para miles de socios: auth, roles, contabilidad, cajas,
-- personal, eventos/fiestas y alertas con RLS.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Roles y perfiles
-- -----------------------------------------------------------------------------
create type public.app_role as enum (
  'member',
  'staff',
  'cashier',
  'accountant',
  'admin',
  'superadmin'
);

create type public.member_tier as enum ('gold', 'platinum', 'royal', 'vitalicio');
create type public.member_status as enum ('active', 'suspended', 'inactive', 'pending');
create type public.account_type as enum ('asset', 'liability', 'equity', 'income', 'expense');
create type public.entry_status as enum ('draft', 'posted', 'void');
create type public.cash_session_status as enum ('open', 'closed', 'discrepancy');
create type public.expense_status as enum ('draft', 'pending_approval', 'approved', 'rejected', 'paid', 'void');
create type public.alert_severity as enum ('info', 'warning', 'critical');
create type public.alert_audience as enum ('all', 'members', 'staff', 'admin', 'custom');
create type public.employee_status as enum ('active', 'on_leave', 'terminated');
create type public.event_status as enum ('draft', 'published', 'cancelled', 'finished');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text not null,
  phone text,
  avatar_url text,
  role public.app_role not null default 'member',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles (id) on delete set null,
  member_number text not null unique,
  card_number text unique,
  full_name text not null,
  phone text,
  email text,
  tier public.member_tier not null default 'gold',
  status public.member_status not null default 'active',
  outstanding_balance numeric(14, 2) not null default 0 check (outstanding_balance >= 0),
  years_active integer not null default 0,
  joined_at date not null default current_date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.member_adherents (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  full_name text not null,
  relationship text not null,
  tier public.member_tier not null default 'gold',
  status public.member_status not null default 'active',
  outstanding_balance numeric(14, 2) not null default 0,
  created_at timestamptz not null default now()
);

create index members_status_idx on public.members (status);
create index members_tier_idx on public.members (tier);
create index members_full_name_idx on public.members using gin (to_tsvector('spanish', full_name));

-- -----------------------------------------------------------------------------
-- Contabilidad: plan de cuentas, períodos, asientos
-- -----------------------------------------------------------------------------
create table public.fiscal_periods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  year integer not null,
  starts_on date not null,
  ends_on date not null,
  is_closed boolean not null default false,
  closed_at timestamptz,
  closed_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint fiscal_periods_range check (ends_on > starts_on),
  unique (year, name)
);

create table public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  account_type public.account_type not null,
  parent_id uuid references public.chart_of_accounts (id),
  level smallint not null default 1 check (level between 1 and 5),
  is_postable boolean not null default true,
  is_cash_account boolean not null default false,
  is_active boolean not null default true,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index chart_of_accounts_type_idx on public.chart_of_accounts (account_type);
create index chart_of_accounts_parent_idx on public.chart_of_accounts (parent_id);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_number bigserial,
  fiscal_period_id uuid not null references public.fiscal_periods (id),
  entry_date date not null,
  concept text not null,
  reference text,
  status public.entry_status not null default 'draft',
  source_module text, -- 'manual' | 'caja' | 'cuotas' | 'gastos' | 'eventos' | 'sueldos'
  source_id uuid,
  created_by uuid references public.profiles (id),
  posted_by uuid references public.profiles (id),
  posted_at timestamptz,
  voided_by uuid references public.profiles (id),
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index journal_entries_date_idx on public.journal_entries (entry_date desc);
create index journal_entries_status_idx on public.journal_entries (status);
create index journal_entries_period_idx on public.journal_entries (fiscal_period_id);

create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.journal_entries (id) on delete cascade,
  account_id uuid not null references public.chart_of_accounts (id),
  line_order smallint not null default 1,
  debit numeric(14, 2) not null default 0 check (debit >= 0),
  credit numeric(14, 2) not null default 0 check (credit >= 0),
  memo text,
  constraint journal_lines_one_side check (
    (debit > 0 and credit = 0) or (credit > 0 and debit = 0)
  )
);

create index journal_lines_entry_idx on public.journal_lines (journal_entry_id);
create index journal_lines_account_idx on public.journal_lines (account_id);

-- Impide publicar asientos desbalanceados
create or replace function public.assert_journal_balanced()
returns trigger
language plpgsql
as $$
declare
  v_debit numeric(14, 2);
  v_credit numeric(14, 2);
  v_status public.entry_status;
begin
  select status into v_status from public.journal_entries where id = coalesce(new.journal_entry_id, old.journal_entry_id);

  select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into v_debit, v_credit
  from public.journal_lines
  where journal_entry_id = coalesce(new.journal_entry_id, old.journal_entry_id);

  if v_status = 'posted' and v_debit <> v_credit then
    raise exception 'Asiento desbalanceado: debe % != haber %', v_debit, v_credit;
  end if;

  if v_status = 'posted' and v_debit = 0 then
    raise exception 'Asiento publicado sin importes';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger journal_lines_balance_trg
after insert or update or delete on public.journal_lines
for each row execute function public.assert_journal_balanced();

create or replace function public.assert_entry_balanced_on_post()
returns trigger
language plpgsql
as $$
declare
  v_debit numeric(14, 2);
  v_credit numeric(14, 2);
  v_closed boolean;
begin
  if new.status = 'posted' and old.status is distinct from 'posted' then
    select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
      into v_debit, v_credit
    from public.journal_lines
    where journal_entry_id = new.id;

    if v_debit = 0 or v_debit <> v_credit then
      raise exception 'No se puede publicar un asiento desbalanceado (debe %, haber %)', v_debit, v_credit;
    end if;

    select is_closed into v_closed from public.fiscal_periods where id = new.fiscal_period_id;
    if v_closed then
      raise exception 'El período fiscal está cerrado';
    end if;

    new.posted_at := coalesce(new.posted_at, now());
  end if;

  if old.status = 'posted' and new.status = 'draft' then
    raise exception 'Un asiento publicado no puede volver a borrador; anúlelo (void)';
  end if;

  return new;
end;
$$;

create trigger journal_entries_post_trg
before update on public.journal_entries
for each row execute function public.assert_entry_balanced_on_post();

-- -----------------------------------------------------------------------------
-- Cajas y sesiones (apertura / movimientos / arqueo)
-- -----------------------------------------------------------------------------
create table public.cash_registers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  location text,
  account_id uuid not null references public.chart_of_accounts (id),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  cash_register_id uuid not null references public.cash_registers (id),
  opened_by uuid not null references public.profiles (id),
  closed_by uuid references public.profiles (id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_balance numeric(14, 2) not null default 0 check (opening_balance >= 0),
  expected_balance numeric(14, 2),
  counted_balance numeric(14, 2),
  difference numeric(14, 2),
  status public.cash_session_status not null default 'open',
  notes text,
  journal_entry_id uuid references public.journal_entries (id)
);

create unique index cash_sessions_one_open_idx
  on public.cash_sessions (cash_register_id)
  where status = 'open';

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  cash_session_id uuid not null references public.cash_sessions (id) on delete restrict,
  movement_type text not null check (movement_type in ('income', 'expense', 'transfer_in', 'transfer_out', 'adjustment')),
  amount numeric(14, 2) not null check (amount > 0),
  concept text not null,
  related_account_id uuid references public.chart_of_accounts (id),
  member_id uuid references public.members (id),
  created_by uuid references public.profiles (id),
  journal_entry_id uuid references public.journal_entries (id),
  created_at timestamptz not null default now()
);

create index cash_movements_session_idx on public.cash_movements (cash_session_id);

-- -----------------------------------------------------------------------------
-- Gastos (workflow de aprobación + impacto contable)
-- -----------------------------------------------------------------------------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_number bigserial,
  expense_date date not null default current_date,
  vendor_name text,
  category_account_id uuid not null references public.chart_of_accounts (id),
  payment_account_id uuid references public.chart_of_accounts (id),
  amount numeric(14, 2) not null check (amount > 0),
  concept text not null,
  invoice_number text,
  status public.expense_status not null default 'draft',
  requested_by uuid references public.profiles (id),
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  paid_at timestamptz,
  cash_session_id uuid references public.cash_sessions (id),
  journal_entry_id uuid references public.journal_entries (id),
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index expenses_status_idx on public.expenses (status);
create index expenses_date_idx on public.expenses (expense_date desc);

-- -----------------------------------------------------------------------------
-- Personal / empleados
-- -----------------------------------------------------------------------------
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles (id) on delete set null,
  employee_number text not null unique,
  full_name text not null,
  role_title text not null,
  department text,
  specialty text,
  status public.employee_status not null default 'active',
  hire_date date not null default current_date,
  termination_date date,
  phone text,
  email text,
  salary_account_id uuid references public.chart_of_accounts (id),
  current_task text,
  on_duty boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.employee_activity_logs (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  logged_at timestamptz not null default now(),
  description text not null,
  created_by uuid references public.profiles (id)
);

create index employee_activity_logs_emp_idx on public.employee_activity_logs (employee_id, logged_at desc);

-- -----------------------------------------------------------------------------
-- Eventos / fiestas
-- -----------------------------------------------------------------------------
create table public.club_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text unique,
  category text not null default 'fiesta',
  description text,
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  capacity integer check (capacity is null or capacity > 0),
  ticket_price numeric(14, 2) not null default 0 check (ticket_price >= 0),
  income_account_id uuid references public.chart_of_accounts (id),
  status public.event_status not null default 'draft',
  cover_image_url text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.club_events (id) on delete cascade,
  member_id uuid references public.members (id),
  guest_name text,
  guests_count integer not null default 1 check (guests_count > 0),
  amount_paid numeric(14, 2) not null default 0,
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'refunded', 'waived')),
  journal_entry_id uuid references public.journal_entries (id),
  registered_at timestamptz not null default now(),
  notes text
);

create index event_registrations_event_idx on public.event_registrations (event_id);

-- -----------------------------------------------------------------------------
-- Sistema de alertas
-- -----------------------------------------------------------------------------
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  code text,
  title text not null,
  body text not null,
  severity public.alert_severity not null default 'info',
  audience public.alert_audience not null default 'all',
  source text not null default 'manual', -- manual | zonda | contabilidad | sistema | reservas
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_active boolean not null default true,
  requires_ack boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index alerts_active_idx on public.alerts (is_active, starts_at desc);

create table public.alert_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.alerts (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  unique (alert_id, profile_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  alert_id uuid references public.alerts (id) on delete set null,
  title text not null,
  body text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index notifications_profile_idx on public.notifications (profile_id, is_read, created_at desc);

-- -----------------------------------------------------------------------------
-- Auditoría mínima
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Helpers de rol / RLS
-- -----------------------------------------------------------------------------
create or replace function public.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    'member'::public.app_role
  );
$$;

create or replace function public.has_staff_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() in ('staff', 'cashier', 'accountant', 'admin', 'superadmin');
$$;

create or replace function public.has_accounting_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() in ('accountant', 'admin', 'superadmin', 'cashier');
$$;

create or replace function public.has_admin_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() in ('admin', 'superadmin');
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data->>'role')::public.app_role, 'member')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger members_updated_at before update on public.members
for each row execute function public.set_updated_at();
create trigger chart_updated_at before update on public.chart_of_accounts
for each row execute function public.set_updated_at();
create trigger journal_updated_at before update on public.journal_entries
for each row execute function public.set_updated_at();
create trigger expenses_updated_at before update on public.expenses
for each row execute function public.set_updated_at();
create trigger employees_updated_at before update on public.employees
for each row execute function public.set_updated_at();
create trigger events_updated_at before update on public.club_events
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.members enable row level security;
alter table public.member_adherents enable row level security;
alter table public.fiscal_periods enable row level security;
alter table public.chart_of_accounts enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
alter table public.cash_registers enable row level security;
alter table public.cash_sessions enable row level security;
alter table public.cash_movements enable row level security;
alter table public.expenses enable row level security;
alter table public.employees enable row level security;
alter table public.employee_activity_logs enable row level security;
alter table public.club_events enable row level security;
alter table public.event_registrations enable row level security;
alter table public.alerts enable row level security;
alter table public.alert_acknowledgements enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

-- Profiles
create policy "profiles_select_own_or_staff"
  on public.profiles for select
  using (id = auth.uid() or public.has_staff_access());

create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid() or public.has_admin_access());

-- Members
create policy "members_select"
  on public.members for select
  using (
    profile_id = auth.uid()
    or public.has_staff_access()
  );

create policy "members_write_admin"
  on public.members for all
  using (public.has_admin_access())
  with check (public.has_admin_access());

create policy "adherents_select"
  on public.member_adherents for select
  using (
    exists (
      select 1 from public.members m
      where m.id = member_id
        and (m.profile_id = auth.uid() or public.has_staff_access())
    )
  );

create policy "adherents_write_admin"
  on public.member_adherents for all
  using (public.has_admin_access())
  with check (public.has_admin_access());

-- Contabilidad: lectura staff contable; escritura accountant/admin
create policy "coa_select_accounting"
  on public.chart_of_accounts for select
  using (public.has_accounting_access() or public.has_staff_access());

create policy "coa_write_admin"
  on public.chart_of_accounts for all
  using (public.has_admin_access() or public.current_role() = 'accountant')
  with check (public.has_admin_access() or public.current_role() = 'accountant');

create policy "fiscal_select"
  on public.fiscal_periods for select
  using (public.has_accounting_access());

create policy "fiscal_write_admin"
  on public.fiscal_periods for all
  using (public.has_admin_access() or public.current_role() = 'accountant')
  with check (public.has_admin_access() or public.current_role() = 'accountant');

create policy "journal_select"
  on public.journal_entries for select
  using (public.has_accounting_access());

create policy "journal_insert"
  on public.journal_entries for insert
  with check (public.has_accounting_access());

create policy "journal_update"
  on public.journal_entries for update
  using (public.has_accounting_access());

create policy "journal_lines_select"
  on public.journal_lines for select
  using (public.has_accounting_access());

create policy "journal_lines_write"
  on public.journal_lines for all
  using (public.has_accounting_access())
  with check (public.has_accounting_access());

create policy "cash_registers_select"
  on public.cash_registers for select
  using (public.has_accounting_access());

create policy "cash_registers_write"
  on public.cash_registers for all
  using (public.has_admin_access() or public.current_role() = 'accountant')
  with check (public.has_admin_access() or public.current_role() = 'accountant');

create policy "cash_sessions_access"
  on public.cash_sessions for all
  using (public.has_accounting_access())
  with check (public.has_accounting_access());

create policy "cash_movements_access"
  on public.cash_movements for all
  using (public.has_accounting_access())
  with check (public.has_accounting_access());

create policy "expenses_access"
  on public.expenses for all
  using (public.has_accounting_access() or public.has_staff_access())
  with check (public.has_accounting_access() or public.has_staff_access());

-- Personal
create policy "employees_select_staff"
  on public.employees for select
  using (public.has_staff_access() or profile_id = auth.uid());

create policy "employees_write_admin"
  on public.employees for all
  using (public.has_admin_access())
  with check (public.has_admin_access());

create policy "employee_logs_select"
  on public.employee_activity_logs for select
  using (public.has_staff_access());

create policy "employee_logs_insert"
  on public.employee_activity_logs for insert
  with check (public.has_staff_access());

-- Eventos
create policy "events_select_published_or_staff"
  on public.club_events for select
  using (status = 'published' or public.has_staff_access());

create policy "events_write_staff"
  on public.club_events for all
  using (public.has_staff_access())
  with check (public.has_staff_access());

create policy "event_reg_select"
  on public.event_registrations for select
  using (
    public.has_staff_access()
    or exists (
      select 1 from public.members m
      where m.id = member_id and m.profile_id = auth.uid()
    )
  );

create policy "event_reg_insert_member"
  on public.event_registrations for insert
  with check (
    public.has_staff_access()
    or exists (
      select 1 from public.members m
      where m.id = member_id and m.profile_id = auth.uid()
    )
  );

-- Alertas / notificaciones
create policy "alerts_select_active"
  on public.alerts for select
  using (
    (is_active = true and (ends_at is null or ends_at > now()))
    or public.has_staff_access()
  );

create policy "alerts_write_staff"
  on public.alerts for all
  using (public.has_staff_access())
  with check (public.has_staff_access());

create policy "alert_ack_own"
  on public.alert_acknowledgements for all
  using (profile_id = auth.uid() or public.has_staff_access())
  with check (profile_id = auth.uid() or public.has_staff_access());

create policy "notifications_own"
  on public.notifications for all
  using (profile_id = auth.uid() or public.has_admin_access())
  with check (profile_id = auth.uid() or public.has_admin_access());

create policy "audit_admin_only"
  on public.audit_logs for select
  using (public.has_admin_access());

create policy "audit_insert_authenticated"
  on public.audit_logs for insert
  with check (auth.uid() is not null);

-- -----------------------------------------------------------------------------
-- Semilla: plan de cuentas institucional + período + cajas
-- -----------------------------------------------------------------------------
insert into public.fiscal_periods (id, name, year, starts_on, ends_on)
values ('11111111-1111-1111-1111-111111111111', 'Ejercicio 2026', 2026, '2026-01-01', '2026-12-31');

insert into public.chart_of_accounts (id, code, name, account_type, level, is_postable, is_cash_account, description) values
  ('aaaaaaaa-0001-0001-0001-000000000001', '1', 'ACTIVO', 'asset', 1, false, false, 'Rubro activo'),
  ('aaaaaaaa-0001-0001-0001-000000000011', '1.1', 'Activo Corriente', 'asset', 2, false, false, null),
  ('aaaaaaaa-0001-0001-0001-000000000111', '1.1.01', 'Caja General', 'asset', 3, true, true, 'Efectivo en sede'),
  ('aaaaaaaa-0001-0001-0001-000000000112', '1.1.02', 'Caja Cantina', 'asset', 3, true, true, 'Efectivo gastronomía'),
  ('aaaaaaaa-0001-0001-0001-000000000113', '1.1.03', 'Banco Nación', 'asset', 3, true, false, 'Cuenta corriente institucional'),
  ('aaaaaaaa-0001-0001-0001-000000000121', '1.2.01', 'Equipamiento Canchas', 'asset', 3, true, false, null),
  ('aaaaaaaa-0001-0001-0001-000000000122', '1.2.02', 'Caballos Criollos', 'asset', 3, true, false, null),
  ('aaaaaaaa-0002-0002-0002-000000000001', '2', 'PASIVO', 'liability', 1, false, false, null),
  ('aaaaaaaa-0002-0002-0002-000000000111', '2.1.01', 'Proveedores Hípicos', 'liability', 3, true, false, null),
  ('aaaaaaaa-0002-0002-0002-000000000112', '2.1.02', 'Sueldos a Pagar', 'liability', 3, true, false, null),
  ('aaaaaaaa-0002-0002-0002-000000000113', '2.1.03', 'Impuestos Pendientes', 'liability', 3, true, false, null),
  ('aaaaaaaa-0003-0003-0003-000000000001', '3', 'PATRIMONIO NETO', 'equity', 1, false, false, null),
  ('aaaaaaaa-0003-0003-0003-000000000111', '3.1.01', 'Capital Social', 'equity', 3, true, false, null),
  ('aaaaaaaa-0003-0003-0003-000000000112', '3.1.02', 'Resultados Acumulados', 'equity', 3, true, false, null),
  ('aaaaaaaa-0004-0004-0004-000000000001', '4', 'INGRESOS', 'income', 1, false, false, null),
  ('aaaaaaaa-0004-0004-0004-000000000111', '4.1.01', 'Cuotas Sociales', 'income', 3, true, false, null),
  ('aaaaaaaa-0004-0004-0004-000000000112', '4.1.02', 'Reservas e Instalaciones', 'income', 3, true, false, null),
  ('aaaaaaaa-0004-0004-0004-000000000113', '4.1.03', 'Eventos y Fiestas', 'income', 3, true, false, null),
  ('aaaaaaaa-0004-0004-0004-000000000114', '4.1.04', 'Concesión Gastronómica', 'income', 3, true, false, null),
  ('aaaaaaaa-0005-0005-0005-000000000001', '5', 'GASTOS', 'expense', 1, false, false, null),
  ('aaaaaaaa-0005-0005-0005-000000000111', '5.1.01', 'Sueldos y Jornales', 'expense', 3, true, false, null),
  ('aaaaaaaa-0005-0005-0005-000000000112', '5.1.02', 'Mantenimiento de Canchas', 'expense', 3, true, false, null),
  ('aaaaaaaa-0005-0005-0005-000000000113', '5.1.03', 'Alimento Equino', 'expense', 3, true, false, null),
  ('aaaaaaaa-0005-0005-0005-000000000114', '5.1.04', 'Servicios e Insumos', 'expense', 3, true, false, null),
  ('aaaaaaaa-0005-0005-0005-000000000115', '5.1.05', 'Gastos de Eventos', 'expense', 3, true, false, null);

update public.chart_of_accounts set parent_id = 'aaaaaaaa-0001-0001-0001-000000000001' where code like '1.%' and code <> '1';
update public.chart_of_accounts set parent_id = 'aaaaaaaa-0001-0001-0001-000000000011' where code in ('1.1.01','1.1.02','1.1.03');
update public.chart_of_accounts set parent_id = 'aaaaaaaa-0001-0001-0001-000000000001' where code in ('1.2.01','1.2.02');
update public.chart_of_accounts set parent_id = 'aaaaaaaa-0002-0002-0002-000000000001' where code like '2.%' and code <> '2';
update public.chart_of_accounts set parent_id = 'aaaaaaaa-0003-0003-0003-000000000001' where code like '3.%' and code <> '3';
update public.chart_of_accounts set parent_id = 'aaaaaaaa-0004-0004-0004-000000000001' where code like '4.%' and code <> '4';
update public.chart_of_accounts set parent_id = 'aaaaaaaa-0005-0005-0005-000000000001' where code like '5.%' and code <> '5';

insert into public.cash_registers (id, code, name, location, account_id) values
  ('bbbbbbbb-0001-0001-0001-000000000001', 'CAJA-GEN', 'Caja General Secretaría', 'Secretaría Rivadavia', 'aaaaaaaa-0001-0001-0001-000000000111'),
  ('bbbbbbbb-0001-0001-0001-000000000002', 'CAJA-CAN', 'Caja Cantina / Pavilion', 'Cantina', 'aaaaaaaa-0001-0001-0001-000000000112');
