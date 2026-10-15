-- El typeahead público no puede filtrar profile_id (UUID).
-- has_portal dice si esa ficha ya tiene usuario, sin filtrar el id.

drop function if exists public.search_members_lookup(text, integer);

create function public.search_members_lookup(p_query text, p_limit integer default 8)
returns table (
  id uuid,
  member_number text,
  full_name text,
  document_number text,
  status text,
  has_portal boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  q text := left(trim(coalesce(p_query, '')), 80);
  folded text;
  digits text;
  like_email text;
  words text[];
  cap integer := least(50, greatest(1, coalesce(p_limit, 8)));
  fold_from constant text := 'áéíóúüñàèìòùäëïö';
  fold_to constant text := 'aeiouunaeiouaeioo';
begin
  if q = '' then
    return;
  end if;

  digits := regexp_replace(q, '\D', '', 'g');
  folded := translate(lower(q), fold_from, fold_to);
  if char_length(q) < 2 and char_length(digits) < 3 then
    return;
  end if;

  select coalesce(array_agg(tok), '{}')
    into words
  from (
    select tok
    from unnest(regexp_split_to_array(folded, '[^a-z0-9]+')) as tok
    where char_length(tok) >= 2
      and tok ~ '[a-z]'
  ) tokens;

  like_email := '%' || replace(replace(replace(folded, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select
    m.id,
    m.member_number::text,
    m.full_name,
    m.document_number::text,
    m.status::text,
    (
      m.profile_id is not null
      or coalesce(m.meta->>'portalProvisionedAt', '') <> ''
      or coalesce(m.meta->>'portalUsername', '') <> ''
    ) as has_portal
  from public.members m
  where
    (
      cardinality(words) > 0
      and not exists (
        select 1
        from unnest(words) as tok
        where translate(lower(m.full_name), fold_from, fold_to) not like '%' || tok || '%'
      )
    )
    or (
      char_length(digits) >= 3
      and (
        regexp_replace(coalesce(m.member_number::text, ''), '\D', '', 'g') = digits
        or regexp_replace(coalesce(m.document_number, ''), '\D', '', 'g') = digits
        or regexp_replace(coalesce(m.member_number::text, ''), '\D', '', 'g') like '%' || digits || '%'
        or regexp_replace(coalesce(m.document_number, ''), '\D', '', 'g') like '%' || digits || '%'
        or (
          char_length(digits) >= 6
          and regexp_replace(coalesce(m.phone, ''), '\D', '', 'g') like '%' || digits || '%'
        )
      )
    )
    or (
      coalesce(m.email, '') <> ''
      and (
        position('@' in q) > 0
        or position('.' in folded) > 0
        or (char_length(folded) >= 5 and folded ~ '[a-z]' and position(' ' in btrim(q)) = 0)
      )
      and translate(lower(m.email), fold_from, fold_to) like like_email escape '\'
    )
  order by
    case
      when char_length(digits) >= 3
        and regexp_replace(coalesce(m.document_number, ''), '\D', '', 'g') = digits then 0
      when regexp_replace(coalesce(m.member_number::text, ''), '\D', '', 'g') = digits
        and digits <> '' then 1
      when position('@' in q) > 0
        and translate(lower(coalesce(m.email, '')), fold_from, fold_to) = folded then 2
      when cardinality(words) > 0
        and translate(lower(m.full_name), fold_from, fold_to) like (words[1] || '%') then 3
      else 4
    end,
    m.full_name
  limit cap;
end;
$$;

revoke all on function public.search_members_lookup(text, integer) from public;
grant execute on function public.search_members_lookup(text, integer) to anon, authenticated;

comment on function public.search_members_lookup(text, integer) is
  'Typeahead de socios (registro público y puerta): pocas columnas, has_portal sin UUID.';
