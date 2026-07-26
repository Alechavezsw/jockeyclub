-- =============================================================================
-- Jockey Club — Módulos operativos (reservas, acceso, pagos, comms, concesiones,
-- tesorería, HR, settings) + ampliación de ficha de socio.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Ampliar members (ficha rica)
-- -----------------------------------------------------------------------------
alter table public.members
  add column if not exists phone_alt text,
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists province text,
  add column if not exists postal_code text,
  add column if not exists document_type text,
  add column if not exists document_number text,
  add column if not exists birth_date date,
  add column if not exists gender text,
  add column if not exists marital_status text,
  add column if not exists nationality text,
  add column if not exists emergency_contact text,
  add column if not exists emergency_phone text,
  add column if not exists payment_method text,
  add column if not exists billing_name text,
  add column if not exists cuit_cuil text,
  add column if not exists tax_condition text,
  add column if not exists disciplines text[] not null default '{}',
  add column if not exists next_due_date date,
  add column if not exists overdue_since date,
  add column if not exists photo_url text,
  add column if not exists meta jsonb not null default '{}'::jsonb;

alter table public.member_adherents
  add column if not exists disciplines text[] not null default '{}',
  add column if not exists meta jsonb not null default '{}'::jsonb;

-- -----------------------------------------------------------------------------
-- Pagos de socios
-- -----------------------------------------------------------------------------
create table if not exists public.member_payments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  amount numeric(14, 2) not null check (amount >= 0),
  paid_at date not null default current_date,
  method text,
  concept text,
  period_label text,
  receipt_number text,
  journal_entry_id uuid references public.journal_entries (id) on delete set null,
  recorded_by uuid references public.profiles (id),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists member_payments_member_idx on public.member_payments (member_id, paid_at desc);

-- -----------------------------------------------------------------------------
-- Reservas
-- -----------------------------------------------------------------------------
create table if not exists public.facilities (
  id text primary key,
  name text not null,
  category text,
  description text,
  image_url text,
  hours text,
  capacity text,
  slots jsonb not null default '[]'::jsonb,
  guest_limit integer not null default 0,
  is_outdoor boolean not null default true,
  is_active boolean not null default true,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  facility_id text not null references public.facilities (id),
  member_id uuid references public.members (id) on delete set null,
  member_number text,
  member_name text not null,
  reservation_date date not null,
  time_slot text not null,
  status text not null default 'confirmed',
  guests integer not null default 0,
  notes text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reservations_date_idx on public.reservations (reservation_date, facility_id);
create index if not exists reservations_member_idx on public.reservations (member_id);

create table if not exists public.reservation_waitlist (
  id uuid primary key default gen_random_uuid(),
  facility_id text not null references public.facilities (id),
  member_id uuid references public.members (id) on delete cascade,
  member_number text,
  member_name text not null,
  desired_date date not null,
  time_slot text,
  status text not null default 'waiting',
  notified_at timestamptz,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Acceso
-- -----------------------------------------------------------------------------
create table if not exists public.access_logs (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members (id) on delete set null,
  member_number text,
  member_name text,
  role_label text,
  status text not null default 'granted',
  notes text,
  logged_on date not null default current_date,
  logged_at time not null default (now()::time),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists access_logs_created_idx on public.access_logs (created_at desc);

create table if not exists public.guest_passes (
  id text primary key,
  host_member_id uuid references public.members (id) on delete set null,
  host_member_number text not null,
  host_name text,
  guest_name text not null,
  pass_date date not null default current_date,
  status text not null default 'active',
  payload text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists guest_passes_host_date_idx on public.guest_passes (host_member_number, pass_date);

-- -----------------------------------------------------------------------------
-- Comunicaciones
-- -----------------------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_name text not null,
  sender_key text,
  recipient_key text not null,
  subject text not null,
  body text not null,
  is_read boolean not null default false,
  parent_id uuid references public.messages (id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists messages_recipient_idx on public.messages (recipient_key, created_at desc);

create table if not exists public.claims (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members (id) on delete set null,
  member_number text,
  member_name text,
  category text,
  subject text not null,
  body text not null,
  status text not null default 'open',
  priority text default 'normal',
  resolution text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.surveys (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'draft',
  questions jsonb not null default '[]'::jsonb,
  starts_at timestamptz,
  ends_at timestamptz,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys (id) on delete cascade,
  member_id uuid references public.members (id) on delete set null,
  member_number text,
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (survey_id, member_number)
);

create table if not exists public.news_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text,
  body text,
  image_url text,
  category text,
  is_published boolean not null default true,
  event_date date,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.news_rsvps (
  id uuid primary key default gen_random_uuid(),
  news_id uuid not null references public.news_posts (id) on delete cascade,
  member_id uuid references public.members (id) on delete set null,
  member_number text,
  member_name text,
  status text not null default 'going',
  created_at timestamptz not null default now(),
  unique (news_id, member_number)
);

-- -----------------------------------------------------------------------------
-- Concesiones
-- -----------------------------------------------------------------------------
create table if not exists public.concession_spaces (
  id text primary key,
  name text not null,
  area text,
  meta jsonb not null default '{}'::jsonb
);

create table if not exists public.concessions (
  id uuid primary key default gen_random_uuid(),
  space_id text references public.concession_spaces (id),
  name text not null,
  concession_type text,
  status text not null default 'active',
  holder_name text,
  holder_cuit text,
  holder_email text,
  holder_phone text,
  start_date date,
  end_date date,
  monthly_canon numeric(14, 2) not null default 0,
  portal_code text unique,
  checklist jsonb not null default '[]'::jsonb,
  documents jsonb not null default '[]'::jsonb,
  renewal_history jsonb not null default '[]'::jsonb,
  notes text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.canon_payments (
  id uuid primary key default gen_random_uuid(),
  concession_id uuid not null references public.concessions (id) on delete cascade,
  period_label text,
  amount numeric(14, 2) not null default 0,
  paid_at date not null default current_date,
  method text,
  concept text,
  journal_entry_id uuid references public.journal_entries (id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Tesorería
-- -----------------------------------------------------------------------------
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cuit text,
  category text,
  email text,
  phone text,
  status text not null default 'active',
  notes text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.unidentified_collections (
  id uuid primary key default gen_random_uuid(),
  amount numeric(14, 2) not null default 0,
  received_on date not null default current_date,
  reference text,
  status text not null default 'pending',
  notes text,
  member_id uuid references public.members (id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.galicia_debits (
  id uuid primary key default gen_random_uuid(),
  member_number text,
  member_name text,
  amount numeric(14, 2) not null default 0,
  debit_date date,
  status text not null default 'pending',
  reference text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.fixed_expenses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  amount numeric(14, 2) not null default 0,
  cadence text default 'monthly',
  next_due date,
  account_code text,
  status text not null default 'active',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.fixed_discounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  amount numeric(14, 2) not null default 0,
  member_number text,
  cadence text default 'monthly',
  status text not null default 'active',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  beneficiary text not null,
  amount numeric(14, 2) not null default 0,
  due_date date,
  status text not null default 'pending',
  concept text,
  supplier_id uuid references public.suppliers (id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- RR.HH. novedades
-- -----------------------------------------------------------------------------
create table if not exists public.employee_hr_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees (id) on delete cascade,
  employee_code text,
  record_type text not null,
  title text,
  details text,
  starts_on date,
  ends_on date,
  amount numeric(14, 2),
  status text not null default 'open',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Settings (zonda, etc.)
-- -----------------------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

-- -----------------------------------------------------------------------------
-- Triggers updated_at
-- -----------------------------------------------------------------------------
drop trigger if exists reservations_updated_at on public.reservations;
create trigger reservations_updated_at before update on public.reservations
for each row execute function public.set_updated_at();

drop trigger if exists claims_updated_at on public.claims;
create trigger claims_updated_at before update on public.claims
for each row execute function public.set_updated_at();

drop trigger if exists surveys_updated_at on public.surveys;
create trigger surveys_updated_at before update on public.surveys
for each row execute function public.set_updated_at();

drop trigger if exists news_updated_at on public.news_posts;
create trigger news_updated_at before update on public.news_posts
for each row execute function public.set_updated_at();

drop trigger if exists concessions_updated_at on public.concessions;
create trigger concessions_updated_at before update on public.concessions
for each row execute function public.set_updated_at();

drop trigger if exists suppliers_updated_at on public.suppliers;
create trigger suppliers_updated_at before update on public.suppliers
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.member_payments enable row level security;
alter table public.facilities enable row level security;
alter table public.reservations enable row level security;
alter table public.reservation_waitlist enable row level security;
alter table public.access_logs enable row level security;
alter table public.guest_passes enable row level security;
alter table public.messages enable row level security;
alter table public.claims enable row level security;
alter table public.surveys enable row level security;
alter table public.survey_responses enable row level security;
alter table public.news_posts enable row level security;
alter table public.news_rsvps enable row level security;
alter table public.concession_spaces enable row level security;
alter table public.concessions enable row level security;
alter table public.canon_payments enable row level security;
alter table public.suppliers enable row level security;
alter table public.unidentified_collections enable row level security;
alter table public.galicia_debits enable row level security;
alter table public.fixed_expenses enable row level security;
alter table public.fixed_discounts enable row level security;
alter table public.payment_orders enable row level security;
alter table public.employee_hr_records enable row level security;
alter table public.app_settings enable row level security;

-- Payments
drop policy if exists member_payments_select on public.member_payments;
create policy member_payments_select on public.member_payments for select using (
  public.has_staff_access()
  or exists (select 1 from public.members m where m.id = member_id and m.profile_id = auth.uid())
);
drop policy if exists member_payments_write on public.member_payments;
create policy member_payments_write on public.member_payments for all using (
  public.has_accounting_access() or public.has_admin_access()
) with check (
  public.has_accounting_access() or public.has_admin_access()
);

-- Facilities / reservations
drop policy if exists facilities_select on public.facilities;
create policy facilities_select on public.facilities for select using (auth.uid() is not null);
drop policy if exists facilities_write on public.facilities;
create policy facilities_write on public.facilities for all using (public.has_admin_access())
  with check (public.has_admin_access());

drop policy if exists reservations_select on public.reservations;
-- Todos los autenticados ven turnos (disponibilidad / conflictos)
create policy reservations_select on public.reservations for select using (auth.uid() is not null);
drop policy if exists reservations_insert on public.reservations;
create policy reservations_insert on public.reservations for insert with check (
  public.has_staff_access()
  or exists (select 1 from public.members m where m.id = member_id and m.profile_id = auth.uid())
  or member_number in (select member_number from public.members where profile_id = auth.uid())
);
drop policy if exists reservations_update on public.reservations;
create policy reservations_update on public.reservations for update using (
  public.has_staff_access()
  or exists (select 1 from public.members m where m.id = member_id and m.profile_id = auth.uid())
);
drop policy if exists reservations_delete on public.reservations;
create policy reservations_delete on public.reservations for delete using (public.has_staff_access());

drop policy if exists waitlist_all on public.reservation_waitlist;
create policy waitlist_all on public.reservation_waitlist for all using (
  public.has_staff_access()
  or exists (select 1 from public.members m where m.id = member_id and m.profile_id = auth.uid())
) with check (
  public.has_staff_access()
  or exists (select 1 from public.members m where m.id = member_id and m.profile_id = auth.uid())
);

-- Access
drop policy if exists access_logs_select on public.access_logs;
create policy access_logs_select on public.access_logs for select using (public.has_staff_access());
drop policy if exists access_logs_insert on public.access_logs;
create policy access_logs_insert on public.access_logs for insert with check (public.has_staff_access());

drop policy if exists guest_passes_select on public.guest_passes;
create policy guest_passes_select on public.guest_passes for select using (
  public.has_staff_access()
  or host_member_number in (select member_number from public.members where profile_id = auth.uid())
);
drop policy if exists guest_passes_write on public.guest_passes;
create policy guest_passes_write on public.guest_passes for all using (
  public.has_staff_access()
  or host_member_number in (select member_number from public.members where profile_id = auth.uid())
) with check (
  public.has_staff_access()
  or host_member_number in (select member_number from public.members where profile_id = auth.uid())
);

-- Messages: staff see all; members see own / all / ops handled in app filter but RLS allows own + broadcast
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select using (
  public.has_staff_access()
  or sender_key = auth.uid()::text
  or recipient_key = auth.uid()::text
  or recipient_key = 'all'
  or recipient_key in (select member_number from public.members where profile_id = auth.uid())
  or (recipient_key = 'ops' and public.has_staff_access())
);
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert with check (auth.uid() is not null);
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages for update using (
  public.has_staff_access()
  or recipient_key = auth.uid()::text
  or recipient_key in (select member_number from public.members where profile_id = auth.uid())
);

-- Claims
drop policy if exists claims_select on public.claims;
create policy claims_select on public.claims for select using (
  public.has_staff_access()
  or member_number in (select member_number from public.members where profile_id = auth.uid())
);
drop policy if exists claims_insert on public.claims;
create policy claims_insert on public.claims for insert with check (auth.uid() is not null);
drop policy if exists claims_update on public.claims;
create policy claims_update on public.claims for update using (public.has_staff_access() or public.has_admin_access());

-- Surveys / news
drop policy if exists surveys_select on public.surveys;
create policy surveys_select on public.surveys for select using (
  status = 'open' or status = 'published' or public.has_staff_access()
);
drop policy if exists surveys_write on public.surveys;
create policy surveys_write on public.surveys for all using (public.has_staff_access())
  with check (public.has_staff_access());

drop policy if exists survey_resp_select on public.survey_responses;
create policy survey_resp_select on public.survey_responses for select using (
  public.has_staff_access()
  or member_number in (select member_number from public.members where profile_id = auth.uid())
);
drop policy if exists survey_resp_insert on public.survey_responses;
create policy survey_resp_insert on public.survey_responses for insert with check (auth.uid() is not null);

drop policy if exists news_select on public.news_posts;
create policy news_select on public.news_posts for select using (is_published = true or public.has_staff_access());
drop policy if exists news_write on public.news_posts;
create policy news_write on public.news_posts for all using (public.has_staff_access())
  with check (public.has_staff_access());

drop policy if exists news_rsvp_all on public.news_rsvps;
create policy news_rsvp_all on public.news_rsvps for all using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- Concessions
drop policy if exists concession_spaces_select on public.concession_spaces;
create policy concession_spaces_select on public.concession_spaces for select using (auth.uid() is not null);
drop policy if exists concession_spaces_write on public.concession_spaces;
create policy concession_spaces_write on public.concession_spaces for all using (public.has_admin_access())
  with check (public.has_admin_access());

drop policy if exists concessions_select on public.concessions;
create policy concessions_select on public.concessions for select using (
  public.has_staff_access() or public.has_admin_access() or portal_code is not null
);
drop policy if exists concessions_write on public.concessions;
create policy concessions_write on public.concessions for all using (
  public.has_admin_access() or public.has_accounting_access()
) with check (
  public.has_admin_access() or public.has_accounting_access()
);

drop policy if exists canon_payments_access on public.canon_payments;
create policy canon_payments_access on public.canon_payments for all using (
  public.has_accounting_access() or public.has_admin_access()
) with check (
  public.has_accounting_access() or public.has_admin_access()
);

-- Allow anon portal read by portal_code via security definer RPC later; for now staff/admin.
-- Public portal uses authenticated staff or we add a policy for select by code:
drop policy if exists concessions_portal_select on public.concessions;
create policy concessions_portal_select on public.concessions for select using (true);

-- Treasury
drop policy if exists suppliers_access on public.suppliers;
create policy suppliers_access on public.suppliers for all using (public.has_accounting_access())
  with check (public.has_accounting_access());
drop policy if exists unidentified_access on public.unidentified_collections;
create policy unidentified_access on public.unidentified_collections for all using (public.has_accounting_access())
  with check (public.has_accounting_access());
drop policy if exists galicia_access on public.galicia_debits;
create policy galicia_access on public.galicia_debits for all using (public.has_accounting_access())
  with check (public.has_accounting_access());
drop policy if exists fixed_exp_access on public.fixed_expenses;
create policy fixed_exp_access on public.fixed_expenses for all using (public.has_accounting_access())
  with check (public.has_accounting_access());
drop policy if exists fixed_disc_access on public.fixed_discounts;
create policy fixed_disc_access on public.fixed_discounts for all using (public.has_accounting_access())
  with check (public.has_accounting_access());
drop policy if exists payment_orders_access on public.payment_orders;
create policy payment_orders_access on public.payment_orders for all using (public.has_accounting_access())
  with check (public.has_accounting_access());

-- HR
drop policy if exists hr_records_access on public.employee_hr_records;
create policy hr_records_access on public.employee_hr_records for all using (public.has_staff_access())
  with check (public.has_staff_access());

-- Settings
drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings for select using (auth.uid() is not null);
drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings for all using (public.has_staff_access())
  with check (public.has_staff_access());

-- Also allow cashiers to write members payments already covered.
-- Expand members write for cashier/accountant on balance fields via admin policy already admin-only.
-- Allow accounting to update member balances:
drop policy if exists members_update_accounting on public.members;
create policy members_update_accounting on public.members for update using (
  public.has_accounting_access() or public.has_admin_access()
) with check (
  public.has_accounting_access() or public.has_admin_access()
);

-- -----------------------------------------------------------------------------
-- Seed facilities + spaces + settings + demo members (upsert)
-- -----------------------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('zonda', '{"active": false}'::jsonb)
on conflict (key) do nothing;

insert into public.concession_spaces (id, name, area) values
  ('space-pavilion', 'Pabellón social / Restaurante', 'Social'),
  ('space-proshop', 'Local Proshop tenis/pádel', 'Deportes'),
  ('space-parking-n', 'Estacionamiento Norte', 'Accesos'),
  ('space-equitacion', 'Pistas de adiestramiento', 'Hípica'),
  ('space-cantina-pileta', 'Cantina de pileta', 'Natación'),
  ('space-eventos', 'Salón de eventos', 'Social')
on conflict (id) do nothing;

insert into public.facilities (id, name, category, description, image_url, hours, capacity, slots, guest_limit, is_outdoor) values
  ('rugby_masc', 'Rugby Masculino - Cancha Principal', 'cancha', 'Cancha de césped natural con postes reglamentarios.', 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?q=80&w=600&auto=format&fit=crop', '08:00 - 20:00', 'Equipos / Práctica', '["08:00","10:00","12:00","14:00","16:00","18:00"]'::jsonb, 15, true),
  ('rugby_fem', 'Rugby Femenino & Juveniles - Cancha Auxiliar', 'cancha', 'Cancha auxiliar de césped natural.', 'https://images.unsplash.com/photo-1459865264687-595d652de67e?q=80&w=600&auto=format&fit=crop', '08:00 - 20:00', 'Equipos / Práctica', '["08:30","10:30","12:30","14:30","16:30","18:30"]'::jsonb, 15, true),
  ('hockey_cesped', 'Hockey sobre Césped - Cancha Sintética', 'cancha', 'Superficie sintética.', 'https://images.unsplash.com/photo-1509316975850-ff9c5edd0cd9?q=80&w=600&auto=format&fit=crop', '08:00 - 22:00', 'Equipos / Práctica', '["08:00","09:30","11:00","14:00","15:30","17:00","18:30","20:00"]'::jsonb, 11, true),
  ('tenis_trad', 'Tenis Tradicional - Polvo de Ladrillo', 'cancha', 'Canchas de tierra batida.', 'https://images.unsplash.com/photo-1595435934249-5df7ed86e1c0?q=80&w=600&auto=format&fit=crop', '08:00 - 22:00', 'Singles o Dobles', '["08:00","09:30","11:00","12:30","14:00","15:30","17:00","18:30","20:00"]'::jsonb, 3, true),
  ('padel_vidrio', 'Pádel - Canchas de Vidrio Templado', 'cancha', 'Canchas de cristal templado.', 'https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?q=80&w=600&auto=format&fit=crop', '08:00 - 23:00', 'Dobles', '["08:00","09:30","11:00","12:30","14:00","15:30","17:00","18:30","20:00","21:30"]'::jsonb, 3, true),
  ('futbol_fusion', 'Fútbol - Canchas de Césped y Fusión', 'cancha', 'Césped natural y fusión.', 'https://images.unsplash.com/photo-1579952362202-3ad778536f17?q=80&w=600&auto=format&fit=crop', '08:00 - 22:00', 'Fútbol 5 / 11', '["08:00","10:00","12:00","14:00","16:00","18:00","20:00"]'::jsonb, 10, true),
  ('equitacion_pistas', 'Equitación - Pistas de Adiestramiento', 'hipica', 'Pistas de arena fina.', 'https://images.unsplash.com/photo-1553284965-83fd3e82fa5a?q=80&w=600&auto=format&fit=crop', '08:00 - 18:00', 'Individual / Pareja', '["08:00","09:30","11:00","14:00","15:30","17:00"]'::jsonb, 2, true),
  ('pileta_olimpica', 'Pileta Olímpica', 'natacion', 'Pileta reglamentaria.', 'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?q=80&w=600&auto=format&fit=crop', '07:00 - 21:00', 'Carriles', '["07:00","08:00","09:00","10:00","16:00","17:00","18:00","19:00"]'::jsonb, 5, false),
  ('gimnasio', 'Gimnasio / Fitness', 'fitness', 'Sala de musculación.', 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=600&auto=format&fit=crop', '07:00 - 22:00', 'Cupos', '["07:00","08:00","09:00","10:00","17:00","18:00","19:00","20:00"]'::jsonb, 0, false),
  ('salon_eventos', 'Salón de Eventos', 'social', 'Salón multipropósito.', 'https://images.unsplash.com/photo-1519167758481-83f15083e58f?q=80&w=600&auto=format&fit=crop', '10:00 - 02:00', 'Eventos', '["10:00","14:00","18:00","21:00"]'::jsonb, 50, false)
on conflict (id) do nothing;

-- Demo members (skip if number exists)
insert into public.members (
  member_number, full_name, phone, email, tier, status, outstanding_balance, years_active,
  joined_at, address, city, province, postal_code, document_type, document_number,
  birth_date, gender, marital_status, nationality, emergency_contact, emergency_phone,
  payment_method, billing_name, cuit_cuil, tax_condition, disciplines, next_due_date, overdue_since
)
select * from (values
  ('2026887744320988', 'Alejandro Chávez', '+5492645551234', 'socio@jockey.sj', 'royal'::public.member_tier, 'active'::public.member_status, 32000::numeric, 5,
   '2021-04-10'::date, 'Av. Libertador San Martín 2450', 'Rivadavia', 'San Juan', '5400', 'DNI', '28.445.912',
   '1985-03-14'::date, 'Masculino', 'Casado/a', 'Argentina', 'María Inés de Chávez', '+5492645551002',
   'Débito automático', 'Alejandro Chávez', '20-28445912-3', 'Consumidor Final', array['Tenis','Pádel','Equitación'], '2026-06-01'::date, '2026-06-01'::date),
  ('2020445599881122', 'Victoria Cantoni', '+5492644445678', null, 'platinum'::public.member_tier, 'active'::public.member_status, 0::numeric, 8,
   current_date - 2900, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, array['Hockey','Fitness'], '2026-07-28'::date, null::date),
  ('2018776655443322', 'Adolfo Sarmiento', '+5492646669876', null, 'royal'::public.member_tier, 'active'::public.member_status, 0::numeric, 12,
   current_date - 4000, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, array['Hípica','Golf'], '2026-08-15'::date, null::date),
  ('2022112233445566', 'Bautista Del Carril', '+5492642222333', null, 'gold'::public.member_tier, 'active'::public.member_status, 45000::numeric, 4,
   current_date - 1500, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, array['Rugby','Fútbol'], '2026-05-10'::date, '2026-05-10'::date),
  ('2024990088776655', 'Isabel Albarracín', '+5492649999888', null, 'gold'::public.member_tier, 'active'::public.member_status, 0::numeric, 2,
   current_date - 700, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, array['Natación','Voleibol','Fitness'], '2026-07-30'::date, null::date)
) as v(
  member_number, full_name, phone, email, tier, status, outstanding_balance, years_active,
  joined_at, address, city, province, postal_code, document_type, document_number,
  birth_date, gender, marital_status, nationality, emergency_contact, emergency_phone,
  payment_method, billing_name, cuit_cuil, tax_condition, disciplines, next_due_date, overdue_since
)
where not exists (
  select 1 from public.members m where m.member_number = v.member_number
);

-- Link socio profile if present
update public.members m
set profile_id = p.id,
    email = coalesce(m.email, p.email),
    phone_alt = coalesce(m.phone_alt, '+5492645551299')
from public.profiles p
where p.email = 'socio@jockey.sj'
  and m.member_number = '2026887744320988'
  and m.profile_id is null;

-- Adherents for Alejandro
insert into public.member_adherents (member_id, full_name, relationship, tier, status, outstanding_balance)
select m.id, a.full_name, a.relationship, a.tier::public.member_tier, 'active'::public.member_status, a.bal
from public.members m
cross join (values
  ('Sofía Chávez', 'Hijo/a', 'royal', 0::numeric),
  ('María Inés de Chávez', 'Cónyuge', 'royal', 0::numeric)
) as a(full_name, relationship, tier, bal)
where m.member_number = '2026887744320988'
  and not exists (
    select 1 from public.member_adherents x
    where x.member_id = m.id and x.full_name = a.full_name
  );
