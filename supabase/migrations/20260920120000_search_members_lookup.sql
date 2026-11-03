-- Typeahead de socios para registro público y puerta.
-- Evita bajar el padrón y el ilike sin índice (RLS + 5k filas).

create extension if not exists pg_trgm;

create index if not exists members_full_name_trgm_idx
  on public.members using gin (full_name gin_trgm_ops);

create index if not exists members_document_number_trgm_idx
  on public.members using gin (document_number gin_trgm_ops);

-- search_members_lookup vive en 20261103190000_search_members_lookup_public.sql.
-- Acá quedan solo los índices: la función no se redefine en cada migración.
