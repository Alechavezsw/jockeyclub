-- Alta pública: saber si nombre, DNI o celular ya están en el padrón,
-- sin devolver la ficha (anon no debe listar socios).

create extension if not exists unaccent;

create or replace function public.join_name_key(p text)
returns text
language sql
stable
as $$
  select lower(trim(both from regexp_replace(unaccent(coalesce(p, '')), '\s+', ' ', 'g')));
$$;

create or replace function public.join_phone_key(p text)
returns text
language sql
immutable
as $$
  select case
    when length(d) >= 12 and d like '549%' then right(d, 10)
    when length(d) >= 11 and d like '54%' then right(d, 10)
    when length(d) >= 10 then right(d, 10)
    else d
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) s;
$$;

create or replace function public.check_join_identity_taken(
  p_full_name text,
  p_document text,
  p_phone text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  name_n text := public.join_name_key(p_full_name);
  doc_n text := regexp_replace(coalesce(p_document, ''), '\D', '', 'g');
  phone_n text := public.join_phone_key(p_phone);
  name_taken boolean := false;
  doc_taken boolean := false;
  phone_taken boolean := false;
begin
  if char_length(name_n) >= 5 and array_length(regexp_split_to_array(name_n, '\s+'), 1) >= 2 then
    select exists (
      select 1
      from public.members m
      where public.join_name_key(m.full_name) = name_n
    ) into name_taken;
  end if;

  if char_length(doc_n) >= 6 then
    select exists (
      select 1
      from public.members m
      where regexp_replace(coalesce(m.document_number, ''), '\D', '', 'g') = doc_n
    ) into doc_taken;
    if not doc_taken then
      select exists (
        select 1
        from public.membership_applications a
        where a.status = 'pending'
          and regexp_replace(coalesce(a.document_number, ''), '\D', '', 'g') = doc_n
      ) into doc_taken;
    end if;
  end if;

  if char_length(phone_n) >= 8 then
    select exists (
      select 1
      from public.members m
      where public.join_phone_key(m.phone) = phone_n
    ) into phone_taken;
    if not phone_taken then
      select exists (
        select 1
        from public.membership_applications a
        where a.status = 'pending'
          and public.join_phone_key(a.phone) = phone_n
      ) into phone_taken;
    end if;
  end if;

  return jsonb_build_object(
    'fullName', name_taken,
    'documentNumber', doc_taken,
    'phone', phone_taken
  );
end;
$$;

revoke all on function public.check_join_identity_taken(text, text, text) from public;
grant execute on function public.check_join_identity_taken(text, text, text) to anon, authenticated;

revoke all on function public.join_name_key(text) from public;
revoke all on function public.join_phone_key(text) from public;
grant execute on function public.join_name_key(text) to authenticated;
grant execute on function public.join_phone_key(text) to authenticated;

comment on function public.check_join_identity_taken(text, text, text) is
  'Alta pública: indica si nombre, DNI o celular ya existen. No revela la ficha.';
