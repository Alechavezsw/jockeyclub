-- Solicitudes de alta de socio (padrón). Usuarios registrados viven en public.profiles.

create type public.membership_application_status as enum (
  'pending',
  'approved',
  'rejected',
  'withdrawn'
);

create table if not exists public.membership_applications (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  document_type text,
  document_number text,
  birth_date date,
  address text,
  city text,
  province text,
  notes text,
  requested_tier text,
  status public.membership_application_status not null default 'pending',
  profile_id uuid references public.profiles (id) on delete set null,
  member_id uuid references public.members (id) on delete set null,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists membership_applications_status_idx
  on public.membership_applications (status, created_at desc);

create index if not exists membership_applications_email_idx
  on public.membership_applications (lower(email));

drop trigger if exists membership_applications_updated_at on public.membership_applications;
create trigger membership_applications_updated_at
  before update on public.membership_applications
  for each row execute function public.set_updated_at();

alter table public.membership_applications enable row level security;

drop policy if exists membership_applications_select on public.membership_applications;
create policy membership_applications_select
  on public.membership_applications for select
  using (
    public.has_staff_access()
    or profile_id = auth.uid()
  );

drop policy if exists membership_applications_insert on public.membership_applications;
create policy membership_applications_insert
  on public.membership_applications for insert
  with check (
    public.has_staff_access()
    or profile_id = auth.uid()
    or profile_id is null
  );

drop policy if exists membership_applications_update on public.membership_applications;
create policy membership_applications_update
  on public.membership_applications for update
  using (public.has_staff_access())
  with check (public.has_staff_access());

drop policy if exists membership_applications_delete on public.membership_applications;
create policy membership_applications_delete
  on public.membership_applications for delete
  using (public.has_admin_access());

comment on table public.membership_applications is
  'Solicitudes de ingreso al padrón social (alta de socio).';
