-- Typeahead de socios para registro público y puerta.
-- Evita bajar el padrón y el ilike sin índice (RLS + 5k filas).

create extension if not exists pg_trgm;

create index if not exists members_full_name_trgm_idx
  on public.members using gin (full_name gin_trgm_ops);

create index if not exists members_document_number_trgm_idx
  on public.members using gin (document_number gin_trgm_ops);

create or replace function public.search_members_lookup(p_query text, p_limit integer default 8)
returns table (
  id uuid,
  member_number text,
  full_name text,
  document_number text,
  status text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  q text := left(trim(coalesce(p_query, '')), 80);
  digits text := regexp_replace(q, '\D', '', 'g');
  like_q text;
  like_d text;
  prefix_q text;
  cap integer := least(20, greatest(1, coalesce(p_limit, 8)));
begin
  if char_length(q) < 2 and char_length(digits) < 3 then
    return;
  end if;

  like_q := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  prefix_q := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  like_d := '%' || digits || '%';

  return query
  select
    m.id,
    m.member_number::text,
    m.full_name,
    m.document_number::text,
    m.status::text
  from public.members m
  where
    (char_length(q) >= 2 and m.full_name ilike like_q escape '\')
    or (
      char_length(digits) >= 3
      and (
        m.member_number::text = digits
        or m.document_number = digits
        or m.member_number::text ilike like_d
        or m.document_number ilike like_d
      )
    )
  order by
    case
      when char_length(digits) >= 3 and m.document_number = digits then 0
      when char_length(digits) >= 3 and m.member_number::text = digits then 1
      when char_length(q) >= 2 and m.full_name ilike prefix_q escape '\' then 2
      else 3
    end,
    m.full_name
  limit cap;
end;
$$;

revoke all on function public.search_members_lookup(text, integer) from public;
grant execute on function public.search_members_lookup(text, integer) to anon, authenticated;

comment on function public.search_members_lookup(text, integer) is
  'Typeahead de socios (registro público y puerta): pocas columnas, sin RLS por fila.';
