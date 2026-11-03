-- El typeahead público no entrega el padrón.
-- Sin sesión de personal: sin DNI, hasta 5 filas, al menos 3 letras
-- y 30 búsquedas cada 10 minutos por IP (o por usuario).
-- El listado con documento lo ve solo el personal.

create table if not exists public.member_lookup_rate (
  client_key text primary key,
  window_start timestamptz not null default now(),
  hits integer not null default 0
);

alter table public.member_lookup_rate enable row level security;
revoke all on public.member_lookup_rate from public, anon, authenticated;

create or replace function public.lookup_client_ip()
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  headers jsonb := '{}'::jsonb;
  raw text;
begin
  begin
    headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  exception
    when others then
      headers := '{}'::jsonb;
  end;
  raw := split_part(coalesce(
    headers->>'x-forwarded-for',
    headers->>'x-real-ip',
    headers->>'cf-connecting-ip',
    ''
  ), ',', 1);
  raw := left(btrim(raw), 64);
  if raw = '' then
    return 'anon';
  end if;
  return raw;
end;
$$;

revoke all on function public.lookup_client_ip() from public, anon, authenticated;

create or replace function public.search_members_lookup(p_query text, p_limit integer default 8)
returns table (
  id uuid,
  member_number text,
  full_name text,
  document_number text,
  status text,
  has_portal boolean
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  q text := left(trim(coalesce(p_query, '')), 80);
  folded text;
  digits text;
  letters text;
  like_email text;
  words text[];
  cap integer;
  v_staff boolean := public.has_staff_access();
  v_key text;
  v_hits integer;
  fold_from constant text := 'áéíóúüñàèìòùäëïö';
  fold_to constant text := 'aeiouunaeiouaeioo';
begin
  if q = '' then
    return;
  end if;

  digits := regexp_replace(q, '\D', '', 'g');
  folded := translate(lower(q), fold_from, fold_to);
  letters := regexp_replace(folded, '[^a-z]', '', 'g');

  if v_staff then
    if char_length(q) < 2 and char_length(digits) < 3 then
      return;
    end if;
    cap := least(50, greatest(1, coalesce(p_limit, 8)));
  else
    if char_length(letters) < 3 then
      return;
    end if;
    cap := least(5, greatest(1, coalesce(p_limit, 5)));

    v_key := left(coalesce(auth.uid()::text, public.lookup_client_ip()), 120);
    insert into public.member_lookup_rate as r (client_key, window_start, hits)
    values (v_key, now(), 1)
    on conflict (client_key) do update
      set hits = case
            when r.window_start < now() - interval '10 minutes' then 1
            else r.hits + 1
          end,
          window_start = case
            when r.window_start < now() - interval '10 minutes' then now()
            else r.window_start
          end
    returning r.hits into v_hits;

    if v_hits > 30 then
      raise exception 'Demasiadas búsquedas. Esperá un momento.';
    end if;
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
    case when v_staff then m.document_number::text else null end,
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
      v_staff
      and char_length(digits) >= 3
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
      when v_staff and char_length(digits) >= 3
        and regexp_replace(coalesce(m.document_number, ''), '\D', '', 'g') = digits then 0
      when v_staff
        and regexp_replace(coalesce(m.member_number::text, ''), '\D', '', 'g') = digits
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
  'Typeahead de socios. Sin personal: sin DNI, 5 filas, 3 letras y límite por IP. El padrón completo es del personal.';
