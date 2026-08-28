-- Evita ambigüedad PostgREST: profiles ↔ profile_roles tenía 2 FKs (profile_id y granted_by).
alter table public.profile_roles
  drop constraint if exists profile_roles_granted_by_fkey;

comment on column public.profile_roles.granted_by is
  'UUID del otorgante (profiles.id). Sin FK para no romper embeds PostgREST.';
