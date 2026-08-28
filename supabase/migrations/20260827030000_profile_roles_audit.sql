-- Multi-rol por perfil + auditoría automática de cambios

create table if not exists public.profile_roles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role_key text not null,
  label text not null,
  kind text not null default 'system' check (kind in ('system', 'title')),
  granted_by uuid references public.profiles (id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  meta jsonb not null default '{}'::jsonb
);

create unique index if not exists profile_roles_active_uidx
  on public.profile_roles (profile_id, lower(role_key))
  where revoked_at is null;

create index if not exists profile_roles_profile_idx
  on public.profile_roles (profile_id, created_at desc);

alter table public.profile_roles enable row level security;

drop policy if exists profile_roles_select on public.profile_roles;
create policy profile_roles_select on public.profile_roles
  for select using (profile_id = auth.uid() or public.has_staff_access());

drop policy if exists profile_roles_write on public.profile_roles;
create policy profile_roles_write on public.profile_roles
  for all using (public.has_admin_access()) with check (public.has_admin_access());

insert into public.profile_roles (profile_id, role_key, label, kind)
select
  p.id,
  p.role::text,
  case p.role::text
    when 'superadmin' then 'Superadministrador'
    when 'admin' then 'Administrador'
    when 'accountant' then 'Contador'
    when 'cashier' then 'Cajero'
    when 'staff' then 'Personal'
    else 'Socio'
  end,
  'system'
from public.profiles p
where not exists (
  select 1 from public.profile_roles pr
  where pr.profile_id = p.id and pr.revoked_at is null and lower(pr.role_key) = p.role::text
);

create or replace function public.role_rank(role_key text)
returns integer
language sql
immutable
as $$
  select case lower(coalesce(role_key, 'member'))
    when 'superadmin' then 60
    when 'admin' then 50
    when 'accountant' then 40
    when 'cashier' then 30
    when 'staff' then 20
    when 'member' then 10
    else 0
  end;
$$;

create or replace function public.sync_profile_primary_role(p_profile_id uuid)
returns public.app_role
language plpgsql
security definer
set search_path = public
as $$
declare
  top_role text;
  resolved public.app_role;
begin
  select pr.role_key into top_role
  from public.profile_roles pr
  where pr.profile_id = p_profile_id
    and pr.revoked_at is null
    and public.role_rank(pr.role_key) > 0
  order by public.role_rank(pr.role_key) desc
  limit 1;

  resolved := coalesce(top_role, 'member')::public.app_role;

  update public.profiles
  set role = resolved, updated_at = now()
  where id = p_profile_id
    and role is distinct from resolved;

  return resolved;
end;
$$;

create or replace function public.user_has_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profile_roles pr
    where pr.profile_id = auth.uid()
      and pr.revoked_at is null
      and lower(pr.role_key) = lower(p_role)
  )
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role::text = lower(p_role)
  );
$$;

create or replace function public.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select pr.role_key::public.app_role
      from public.profile_roles pr
      where pr.profile_id = auth.uid()
        and pr.revoked_at is null
        and public.role_rank(pr.role_key) > 0
      order by public.role_rank(pr.role_key) desc
      limit 1
    ),
    (select role from public.profiles where id = auth.uid()),
    'member'::public.app_role
  );
$$;

create or replace function public.trace_profile_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  before_j jsonb;
  after_j jsonb;
  diff jsonb := '{}'::jsonb;
  k text;
begin
  if tg_op = 'UPDATE' then
    before_j := to_jsonb(old);
    after_j := to_jsonb(new);
    for k in select jsonb_object_keys(after_j)
    loop
      if k in ('updated_at') then continue; end if;
      if before_j->k is distinct from after_j->k then
        diff := diff || jsonb_build_object(k, jsonb_build_object('from', before_j->k, 'to', after_j->k));
      end if;
    end loop;
    if diff <> '{}'::jsonb then
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
      values (
        auth.uid(),
        'profile.change',
        'profile',
        new.id,
        jsonb_build_object('diff', diff, 'email', new.email, 'full_name', new.full_name)
      );
    end if;
    return new;
  elsif tg_op = 'INSERT' then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    values (
      auth.uid(),
      'profile.create',
      'profile',
      new.id,
      jsonb_build_object('email', new.email, 'full_name', new.full_name, 'role', new.role)
    );
    return new;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_trace_changes on public.profiles;
create trigger profiles_trace_changes
  after insert or update on public.profiles
  for each row execute function public.trace_profile_changes();

create or replace function public.trace_profile_role_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    values (
      auth.uid(),
      'profile_role.grant',
      'profile',
      new.profile_id,
      jsonb_build_object('role_key', new.role_key, 'label', new.label, 'kind', new.kind, 'role_id', new.id)
    );
    perform public.sync_profile_primary_role(new.profile_id);
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    values (
      auth.uid(),
      case when new.revoked_at is not null and old.revoked_at is null then 'profile_role.revoke' else 'profile_role.update' end,
      'profile',
      new.profile_id,
      jsonb_build_object(
        'role_key', new.role_key,
        'label', new.label,
        'kind', new.kind,
        'role_id', new.id,
        'revoked_at', new.revoked_at,
        'from', to_jsonb(old),
        'to', to_jsonb(new)
      )
    );
    perform public.sync_profile_primary_role(new.profile_id);
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    values (
      auth.uid(),
      'profile_role.delete',
      'profile',
      old.profile_id,
      jsonb_build_object('role_key', old.role_key, 'label', old.label, 'role_id', old.id)
    );
    perform public.sync_profile_primary_role(old.profile_id);
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists profile_roles_trace on public.profile_roles;
create trigger profile_roles_trace
  after insert or update or delete on public.profile_roles
  for each row execute function public.trace_profile_role_changes();

drop policy if exists audit_admin_only on public.audit_logs;
create policy audit_admin_only on public.audit_logs
  for select using (public.has_admin_access());

drop policy if exists audit_insert_authenticated on public.audit_logs;
create policy audit_insert_authenticated on public.audit_logs
  for insert with check (auth.uid() is not null);
