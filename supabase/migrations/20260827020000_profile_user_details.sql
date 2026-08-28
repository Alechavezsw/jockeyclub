-- Ficha completa de usuarios del portal + autorizaciones e identificadores

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists document_type text,
  add column if not exists document_number text,
  add column if not exists gender text,
  add column if not exists birth_date date,
  add column if not exists blood_type text,
  add column if not exists health_insurance text,
  add column if not exists emergency_phone text,
  add column if not exists emergency_clinic text,
  add column if not exists address text,
  add column if not exists prisma_id text,
  add column if not exists meta jsonb not null default '{}'::jsonb;

update public.profiles
set
  first_name = coalesce(nullif(first_name, ''), split_part(full_name, ' ', 1)),
  last_name = coalesce(
    nullif(last_name, ''),
    nullif(trim(substring(full_name from length(split_part(full_name, ' ', 1)) + 1)), ''),
    ''
  )
where full_name is not null;

create table if not exists public.profile_authorizations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  role_label text,
  expires_at date,
  pin text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profile_authorizations_profile_idx
  on public.profile_authorizations (profile_id);

create table if not exists public.profile_identifiers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  id_type text not null,
  identifier text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists profile_identifiers_profile_idx
  on public.profile_identifiers (profile_id);

drop trigger if exists profile_authorizations_updated_at on public.profile_authorizations;
create trigger profile_authorizations_updated_at
  before update on public.profile_authorizations
  for each row execute function public.set_updated_at();

alter table public.profile_authorizations enable row level security;
alter table public.profile_identifiers enable row level security;

drop policy if exists profile_authorizations_select on public.profile_authorizations;
create policy profile_authorizations_select on public.profile_authorizations
  for select using (profile_id = auth.uid() or public.has_staff_access());

drop policy if exists profile_authorizations_write on public.profile_authorizations;
create policy profile_authorizations_write on public.profile_authorizations
  for all using (public.has_admin_access()) with check (public.has_admin_access());

drop policy if exists profile_identifiers_select on public.profile_identifiers;
create policy profile_identifiers_select on public.profile_identifiers
  for select using (profile_id = auth.uid() or public.has_staff_access());

drop policy if exists profile_identifiers_write on public.profile_identifiers;
create policy profile_identifiers_write on public.profile_identifiers
  for all using (public.has_admin_access()) with check (public.has_admin_access());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  fname text := coalesce(meta->>'first_name', split_part(coalesce(meta->>'full_name', ''), ' ', 1));
  lname text := coalesce(meta->>'last_name', nullif(trim(substring(coalesce(meta->>'full_name', '') from length(split_part(coalesce(meta->>'full_name', ''), ' ', 1)) + 1)), ''));
  display text := coalesce(nullif(trim(concat_ws(' ', fname, lname)), ''), meta->>'full_name', split_part(new.email, '@', 1));
begin
  insert into public.profiles (
    id, email, full_name, first_name, last_name, role, phone, avatar_url,
    document_type, document_number, gender, birth_date,
    blood_type, health_insurance, emergency_phone, emergency_clinic, address, prisma_id, meta
  )
  values (
    new.id,
    new.email,
    display,
    nullif(fname, ''),
    nullif(lname, ''),
    coalesce((meta->>'role')::public.app_role, 'member'),
    meta->>'phone',
    meta->>'avatar_url',
    meta->>'document_type',
    meta->>'document_number',
    meta->>'gender',
    nullif(meta->>'birth_date', '')::date,
    meta->>'blood_type',
    meta->>'health_insurance',
    meta->>'emergency_phone',
    meta->>'emergency_clinic',
    meta->>'address',
    meta->>'prisma_id',
    coalesce(meta->'profile_meta', '{}'::jsonb)
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    first_name = coalesce(excluded.first_name, public.profiles.first_name),
    last_name = coalesce(excluded.last_name, public.profiles.last_name),
    role = excluded.role,
    updated_at = now();
  return new;
end;
$$;
