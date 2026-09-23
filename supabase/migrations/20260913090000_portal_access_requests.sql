-- Pedidos públicos de usuario / contraseña. Secretaría los resuelve a mano.

create type public.portal_access_reason as enum (
  'first_access',
  'forgot_password'
);

create type public.portal_access_status as enum (
  'pending',
  'approved',
  'rejected'
);

create table if not exists public.portal_access_requests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  document_number text,
  member_number text,
  phone text,
  email text,
  reason public.portal_access_reason not null default 'first_access',
  status public.portal_access_status not null default 'pending',
  notes text,
  member_id uuid references public.members (id) on delete set null,
  profile_id uuid references public.profiles (id) on delete set null,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists portal_access_requests_status_idx
  on public.portal_access_requests (status, created_at desc);

create index if not exists portal_access_requests_member_number_idx
  on public.portal_access_requests (member_number);

drop trigger if exists portal_access_requests_updated_at on public.portal_access_requests;
create trigger portal_access_requests_updated_at
  before update on public.portal_access_requests
  for each row execute function public.set_updated_at();

alter table public.portal_access_requests enable row level security;

drop policy if exists portal_access_requests_select on public.portal_access_requests;
create policy portal_access_requests_select
  on public.portal_access_requests for select
  using (public.has_staff_access());

drop policy if exists portal_access_requests_insert on public.portal_access_requests;
create policy portal_access_requests_insert
  on public.portal_access_requests for insert
  with check (
    public.has_staff_access()
    or profile_id is null
  );

drop policy if exists portal_access_requests_update on public.portal_access_requests;
create policy portal_access_requests_update
  on public.portal_access_requests for update
  using (public.has_staff_access())
  with check (public.has_staff_access());

drop policy if exists portal_access_requests_delete on public.portal_access_requests;
create policy portal_access_requests_delete
  on public.portal_access_requests for delete
  using (public.has_admin_access());

grant insert on public.portal_access_requests to anon, authenticated;
grant select, update, delete on public.portal_access_requests to authenticated;
grant insert on public.membership_applications to anon, authenticated;

comment on table public.portal_access_requests is
  'Pedidos públicos de acceso al portal (usuario / contraseña). Secretaría contacta al socio.';
