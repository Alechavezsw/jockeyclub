-- La búsqueda doblaba el nombre en cada fila y no podía usar el índice trigram.
-- El asiento del cobro hacía seis viajes (cabecera, líneas, publicar, auditar, releer).

create index if not exists members_full_name_fold_trgm_idx
  on public.members using gin (
    (translate(lower(full_name), 'áéíóúüñàèìòùäëïö', 'aeiouunaeiouaeioo')) gin_trgm_ops
  );

create index if not exists members_email_fold_trgm_idx
  on public.members using gin (
    (translate(lower(coalesce(email, '')), 'áéíóúüñàèìòùäëïö', 'aeiouunaeiouaeioo')) gin_trgm_ops
  );

create index if not exists members_phone_digits_trgm_idx
  on public.members using gin (
    (regexp_replace(coalesce(phone, ''), '\D', '', 'g')) gin_trgm_ops
  );

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
as $function$
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
  email_like boolean;
begin
  if q = '' then
    return;
  end if;

  digits := regexp_replace(q, '[^0-9]', '', 'g');
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

  like_email := '%' || replace(replace(replace(folded, chr(92), chr(92) || chr(92)), '%', chr(92) || '%'), '_', chr(92) || '_') || '%';
  email_like := coalesce(position('@' in q) > 0, false)
    or coalesce(position('.' in folded) > 0, false)
    or (
      char_length(folded) >= 5
      and folded ~ '[a-z]'
      and position(' ' in btrim(q)) = 0
    );

  -- Cada rama se planifica sola para que el trigram entre. Un OR con regexp recorría las 7.400 filas.
  if cardinality(words) > 0 then
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
      )
    from public.members m
    where translate(lower(m.full_name), 'áéíóúüñàèìòùäëïö', 'aeiouunaeiouaeioo') like '%' || words[1] || '%'
      and (
        cardinality(words) < 2
        or translate(lower(m.full_name), 'áéíóúüñàèìòùäëïö', 'aeiouunaeiouaeioo') like '%' || words[2] || '%'
      )
      and (
        cardinality(words) < 3
        or translate(lower(m.full_name), 'áéíóúüñàèìòùäëïö', 'aeiouunaeiouaeioo') like '%' || words[3] || '%'
      )
      and (
        cardinality(words) < 4
        or translate(lower(m.full_name), 'áéíóúüñàèìòùäëïö', 'aeiouunaeiouaeioo') like '%' || words[4] || '%'
      )
      and (
        cardinality(words) < 5
        or not exists (
          select 1
          from unnest(words[5:cardinality(words)]) as tok
          where translate(lower(m.full_name), 'áéíóúüñàèìòùäëïö', 'aeiouunaeiouaeioo') not like '%' || tok || '%'
        )
      )
    order by
      case
        when translate(lower(m.full_name), 'áéíóúüñàèìòùäëïö', 'aeiouunaeiouaeioo') like (words[1] || '%') then 3
        else 4
      end,
      m.full_name
    limit cap;
  end if;

  if v_staff and char_length(digits) >= 3 then
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
      )
    from public.members m
    where m.member_number = digits
      or m.member_number like digits || '%'
      or m.document_number like '%' || digits || '%'
    order by
      case
        when regexp_replace(coalesce(m.document_number, ''), '[^0-9]', '', 'g') = digits then 0
        when m.member_number = digits then 1
        else 4
      end,
      m.full_name
    limit cap;
  end if;

  if v_staff and char_length(digits) >= 6 and cardinality(words) = 0 then
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
      )
    from public.members m
    where regexp_replace(coalesce(m.phone, ''), E'\\D', '', 'g') like '%' || digits || '%'
    order by m.full_name
    limit cap;
  end if;

  if email_like then
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
      )
    from public.members m
    where coalesce(m.email, '') <> ''
      and translate(lower(m.email), 'áéíóúüñàèìòùäëïö', 'aeiouunaeiouaeioo') like like_email escape chr(92)
    order by
      case
        when position('@' in q) > 0
          and translate(lower(coalesce(m.email, '')), 'áéíóúüñàèìòùäëïö', 'aeiouunaeiouaeioo') = folded then 2
        else 4
      end,
      m.full_name
    limit cap;
  end if;
end;
$function$;

revoke all on function public.search_members_lookup(text, integer) from public;
grant execute on function public.search_members_lookup(text, integer) to anon, authenticated;

comment on function public.search_members_lookup(text, integer) is
  'Typeahead de socios. Sin personal: sin DNI, 5 filas, 3 letras y límite por IP. El padrón completo es del personal.';

-- Un solo viaje: borrador, líneas, publicación y auditoría.
create or replace function public.post_journal_entry(p_entry jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_id uuid;
  v_entry public.journal_entries%rowtype;
  v_lines jsonb;
  v_created uuid;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;

  begin
    v_created := nullif(p_entry->>'createdBy', '')::uuid;
  exception
    when others then
      v_created := null;
  end;

  insert into public.journal_entries (
    fiscal_period_id,
    entry_date,
    concept,
    reference,
    status,
    source_module,
    created_by
  ) values (
    (p_entry->>'fiscalPeriodId')::uuid,
    coalesce(nullif(p_entry->>'date', '')::date, current_date),
    coalesce(nullif(p_entry->>'concept', ''), 'Asiento'),
    nullif(p_entry->>'reference', ''),
    'draft',
    coalesce(nullif(p_entry->>'sourceModule', ''), 'manual'),
    coalesce(v_created, auth.uid())
  )
  returning id into v_id;

  insert into public.journal_lines (
    journal_entry_id, account_id, line_order, debit, credit, memo
  )
  select
    v_id,
    (line->>'accountId')::uuid,
    coalesce(nullif(line->>'lineOrder', '')::int, ordinality::int),
    coalesce(nullif(line->>'debit', '')::numeric, 0),
    coalesce(nullif(line->>'credit', '')::numeric, 0),
    nullif(line->>'memo', '')
  from jsonb_array_elements(coalesce(p_entry->'lines', '[]'::jsonb)) with ordinality as t(line, ordinality)
  where coalesce(line->>'accountId', '') <> '';

  if coalesce(nullif(p_entry->>'status', ''), 'posted') is distinct from 'draft' then
    update public.journal_entries
    set status = 'posted',
        posted_at = now(),
        posted_by = coalesce(v_created, auth.uid())
    where id = v_id;
  end if;

  select * into v_entry from public.journal_entries where id = v_id;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.line_order), '[]'::jsonb)
    into v_lines
  from public.journal_lines l
  where l.journal_entry_id = v_id;

  begin
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    values (auth.uid(), 'create', 'journal_entries', v_id, '{}'::jsonb);
  exception
    when others then
      null;
  end;

  return jsonb_build_object('entry', to_jsonb(v_entry), 'lines', v_lines);
end;
$function$;

revoke all on function public.post_journal_entry(jsonb) from public, anon;
grant execute on function public.post_journal_entry(jsonb) to authenticated;
