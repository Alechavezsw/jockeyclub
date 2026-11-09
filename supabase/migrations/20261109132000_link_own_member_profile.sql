-- Al login: si el socio abrió la app por DNI/mail pero members.profile_id está vacío, lo vincula.

create or replace function public.link_own_member_profile()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_doc text;
  v_email text;
  v_member_id uuid;
  v_member_number text;
begin
  if uid is null then
    return null;
  end if;

  select m.member_number into v_member_number
  from public.members m
  where m.profile_id = uid
  limit 1;
  if v_member_number is not null then
    return v_member_number;
  end if;

  select
    regexp_replace(coalesce(p.document_number, ''), '\D', '', 'g'),
    lower(coalesce(p.email, ''))
  into v_doc, v_email
  from public.profiles p
  where p.id = uid;

  if coalesce(v_doc, '') = '' and coalesce(v_email, '') = '' then
    return null;
  end if;

  select m.id, m.member_number
    into v_member_id, v_member_number
  from public.members m
  where m.profile_id is null
    and (
      (length(v_doc) >= 7
        and regexp_replace(coalesce(m.document_number, ''), '\D', '', 'g') = v_doc)
      or (v_email <> '' and lower(coalesce(m.email, '')) = v_email)
    )
  order by
    case
      when length(v_doc) >= 7
        and regexp_replace(coalesce(m.document_number, ''), '\D', '', 'g') = v_doc then 0
      else 1
    end
  limit 1;

  if v_member_id is null then
    return null;
  end if;

  if exists (select 1 from public.members x where x.profile_id = uid) then
    select m.member_number into v_member_number
    from public.members m where m.profile_id = uid limit 1;
    return v_member_number;
  end if;

  update public.members
  set profile_id = uid,
      updated_at = now()
  where id = v_member_id
    and profile_id is null;

  return v_member_number;
end;
$$;

revoke all on function public.link_own_member_profile() from public;
grant execute on function public.link_own_member_profile() to authenticated;

comment on function public.link_own_member_profile() is
  'Vincula la ficha del socio al profile del usuario logueado (DNI o mail) si falta profile_id.';
