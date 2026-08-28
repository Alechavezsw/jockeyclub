-- ID público por rol asignado + helpers de acceso

create sequence if not exists public.profile_role_public_id_seq start with 310001 increment by 1;

alter table public.profile_roles
  add column if not exists public_id bigint;

update public.profile_roles
set public_id = nextval('public.profile_role_public_id_seq')
where public_id is null;

alter table public.profile_roles
  alter column public_id set default nextval('public.profile_role_public_id_seq');

create unique index if not exists profile_roles_public_id_uidx
  on public.profile_roles (public_id);

create or replace function public.role_rank(role_key text)
returns integer
language sql
immutable
as $$
  select case lower(coalesce(role_key, 'member'))
    when 'superadmin' then 60
    when 'admin' then 50
    when 'accountant' then 40
    when 'cashier' then 32
    when 'gate_operator' then 31
    when 'admin_employee' then 25
    when 'hr' then 23
    when 'staff' then 20
    when 'member' then 10
    else 0
  end;
$$;

create or replace function public.has_staff_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() in (
    'staff', 'cashier', 'accountant', 'admin', 'superadmin',
    'gate_operator', 'admin_employee', 'hr'
  )
  or public.user_has_role('staff')
  or public.user_has_role('cashier')
  or public.user_has_role('accountant')
  or public.user_has_role('admin')
  or public.user_has_role('superadmin')
  or public.user_has_role('gate_operator')
  or public.user_has_role('admin_employee')
  or public.user_has_role('hr');
$$;

create or replace function public.has_admin_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() in ('admin', 'superadmin')
    or public.user_has_role('admin')
    or public.user_has_role('superadmin');
$$;

create or replace function public.has_accounting_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() in ('accountant', 'superadmin', 'cashier', 'gate_operator')
    or public.user_has_role('accountant')
    or public.user_has_role('superadmin')
    or public.user_has_role('cashier')
    or public.user_has_role('gate_operator');
$$;
