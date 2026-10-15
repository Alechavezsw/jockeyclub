-- Un pedido abierto por ficha. Si pide de nuevo en la semana, se actualiza el mismo trazado.

create or replace function public.submit_portal_access_request(
  p_full_name text,
  p_document_number text default null,
  p_member_number text default null,
  p_phone text default null,
  p_email text default null,
  p_reason public.portal_access_reason default 'first_access',
  p_member_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  existing uuid;
  doc_digits text := regexp_replace(coalesce(p_document_number, ''), '\D', '', 'g');
  member_digits text := regexp_replace(coalesce(p_member_number, ''), '\D', '', 'g');
begin
  if length(trim(coalesce(p_full_name, ''))) < 3 then
    raise exception 'Nombre requerido';
  end if;

  select r.id
    into existing
  from public.portal_access_requests r
  where r.status = 'pending'
    and r.created_at >= now() - interval '7 days'
    and (
      (p_member_id is not null and r.member_id = p_member_id)
      or (
        member_digits <> ''
        and regexp_replace(coalesce(r.member_number, ''), '\D', '', 'g') = member_digits
      )
      or (
        char_length(doc_digits) >= 6
        and regexp_replace(coalesce(r.document_number, ''), '\D', '', 'g') = doc_digits
      )
    )
  order by r.created_at desc
  limit 1;

  if existing is not null then
    update public.portal_access_requests
    set
      full_name = trim(p_full_name),
      document_number = coalesce(nullif(trim(coalesce(p_document_number, '')), ''), document_number),
      member_number = coalesce(nullif(trim(coalesce(p_member_number, '')), ''), member_number),
      phone = coalesce(nullif(trim(coalesce(p_phone, '')), ''), phone),
      email = coalesce(nullif(trim(coalesce(p_email, '')), ''), email),
      reason = coalesce(p_reason, reason),
      member_id = coalesce(p_member_id, member_id)
    where id = existing;
    return existing;
  end if;

  insert into public.portal_access_requests (
    full_name, document_number, member_number, phone, email, reason, member_id, status
  ) values (
    trim(p_full_name),
    nullif(trim(coalesce(p_document_number, '')), ''),
    nullif(trim(coalesce(p_member_number, '')), ''),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_email, '')), ''),
    coalesce(p_reason, 'first_access'),
    p_member_id,
    'pending'
  )
  returning id into existing;

  return existing;
end;
$$;

revoke all on function public.submit_portal_access_request(
  text, text, text, text, text, public.portal_access_reason, uuid
) from public;
grant execute on function public.submit_portal_access_request(
  text, text, text, text, text, public.portal_access_reason, uuid
) to anon, authenticated;

comment on function public.submit_portal_access_request(
  text, text, text, text, text, public.portal_access_reason, uuid
) is
  'Pedido público de acceso: un trazado abierto por ficha, vigente 7 días.';
