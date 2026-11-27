-- Un correo y un DNI de fichas distintas no pueden quedar en la misma cuenta.
-- La vinculación nueva exige una sola ficha, el mismo DNI y el mismo correo.
-- No reescribe vínculos que ya existían.

create or replace function public.portal_identity_block_reason(
  p_member_id uuid,
  p_email text default null,
  p_document_number text default null,
  p_profile_id uuid default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_member public.members%rowtype;
  v_profile public.profiles%rowtype;
  v_auth_email text;
  v_banned timestamptz;
  v_deleted timestamptz;
  v_member_dni text;
  v_account_dni text;
  v_member_email text;
  v_account_email text;
  v_other_email text;
  v_other_dni text;
  v_shared int;
begin
  if p_member_id is null then
    return 'Conflicto de identidad: falta la ficha del socio.';
  end if;

  select * into v_member from public.members where id = p_member_id;
  if not found then
    return 'Conflicto de identidad: el socio no existe.';
  end if;
  if v_member.status::text <> 'active' then
    return 'Conflicto de identidad: el socio no está activo.';
  end if;

  v_member_dni := regexp_replace(coalesce(v_member.document_number, ''), '\D', '', 'g');
  v_member_email := lower(trim(coalesce(v_member.email, '')));
  v_account_dni := regexp_replace(coalesce(p_document_number, ''), '\D', '', 'g');
  v_account_email := lower(trim(coalesce(p_email, '')));

  if p_profile_id is not null then
    select * into v_profile from public.profiles where id = p_profile_id;
    if not found then
      return 'Conflicto de identidad: el perfil no existe.';
    end if;
    if coalesce(v_profile.is_active, false) = false then
      return 'Conflicto de identidad: el perfil está desactivado.';
    end if;

    select lower(trim(coalesce(u.email, ''))), u.banned_until, u.deleted_at
      into v_auth_email, v_banned, v_deleted
    from auth.users u
    where u.id = p_profile_id;
    if not found then
      return 'Conflicto de identidad: la cuenta de acceso no existe.';
    end if;
    if v_deleted is not null or (v_banned is not null and v_banned > now()) then
      return 'Conflicto de identidad: la cuenta está bloqueada.';
    end if;

    if v_account_email = '' then
      v_account_email := v_auth_email;
    end if;
    if v_account_dni = '' then
      v_account_dni := regexp_replace(coalesce(v_profile.document_number, ''), '\D', '', 'g');
    end if;

    select count(*) into v_shared
    from public.members other
    where other.profile_id = p_profile_id
      and other.id <> p_member_id;
    if v_shared > 0 then
      return 'Conflicto de identidad: el perfil ya está vinculado a otro socio.';
    end if;
  end if;

  if v_member_dni <> '' and v_account_dni <> '' and v_member_dni <> v_account_dni then
    return 'Conflicto de identidad: el DNI no es el de la ficha.';
  end if;
  if v_member_email <> '' and v_account_email <> '' and v_member_email <> v_account_email then
    return 'Conflicto de identidad: el correo no es el de la ficha.';
  end if;

  if v_account_email <> '' then
    select m.member_number into v_other_email
    from public.members m
    where m.id <> p_member_id
      and lower(trim(coalesce(m.email, ''))) = v_account_email
    limit 1;
    if v_other_email is not null then
      return 'Conflicto de identidad: el correo pertenece a otra ficha (' || v_other_email || ').';
    end if;
  end if;

  if v_member_dni <> '' then
    select m.member_number into v_other_dni
    from public.members m
    where m.id <> p_member_id
      and m.status::text = 'active'
      and regexp_replace(coalesce(m.document_number, ''), '\D', '', 'g') = v_member_dni
    limit 1;
    if v_other_dni is not null then
      return 'Conflicto de identidad: el DNI pertenece a otra ficha activa (' || v_other_dni || ').';
    end if;
  end if;

  return null;
end;
$$;

revoke all on function public.portal_identity_block_reason(uuid, text, text, uuid) from public;
grant execute on function public.portal_identity_block_reason(uuid, text, text, uuid) to authenticated, service_role;

comment on function public.portal_identity_block_reason(uuid, text, text, uuid) is
  'Texto del conflicto si el socio, el DNI y el correo no son la misma persona. Null si se puede vincular.';

create or replace function public.guard_member_profile_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
begin
  if new.profile_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.profile_id is not distinct from old.profile_id then
    return new;
  end if;

  v_reason := public.portal_identity_block_reason(new.id, null, null, new.profile_id);
  if v_reason is not null then
    raise exception '%', v_reason
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists members_profile_identity_guard on public.members;
create trigger members_profile_identity_guard
  before insert or update of profile_id on public.members
  for each row execute function public.guard_member_profile_identity();

create or replace function public.member_portal_access_state(p_member_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_member public.members%rowtype;
  v_profile public.profiles%rowtype;
  v_banned timestamptz;
  v_deleted timestamptz;
  v_auth_email text;
  v_shared int;
  v_pending int;
begin
  select * into v_member from public.members where id = p_member_id;
  if not found then
    return 'none';
  end if;

  if v_member.profile_id is null then
    select count(*) into v_pending
    from public.portal_access_requests r
    where r.member_id = p_member_id
      and r.status = 'pending';
    if v_pending > 0 then
      return 'pending';
    end if;
    return 'none';
  end if;

  select count(*) into v_shared
  from public.members other
  where other.profile_id = v_member.profile_id
    and other.id <> v_member.id;
  if v_shared > 0 then
    return 'conflict';
  end if;

  select * into v_profile from public.profiles where id = v_member.profile_id;
  if not found then
    return 'unlinked';
  end if;

  select lower(trim(coalesce(u.email, ''))), u.banned_until, u.deleted_at
    into v_auth_email, v_banned, v_deleted
  from auth.users u
  where u.id = v_member.profile_id;
  if not found or v_deleted is not null then
    return 'unlinked';
  end if;
  if coalesce(v_profile.is_active, false) = false
     or (v_banned is not null and v_banned > now()) then
    return 'blocked';
  end if;

  if regexp_replace(coalesce(v_profile.document_number, ''), '\D', '', 'g') <> ''
     and regexp_replace(coalesce(v_member.document_number, ''), '\D', '', 'g') <> ''
     and regexp_replace(coalesce(v_profile.document_number, ''), '\D', '', 'g')
       <> regexp_replace(coalesce(v_member.document_number, ''), '\D', '', 'g') then
    return 'conflict';
  end if;
  if lower(trim(coalesce(v_member.email, ''))) <> ''
     and v_auth_email <> ''
     and lower(trim(v_member.email)) <> v_auth_email then
    return 'conflict';
  end if;

  return 'active';
end;
$$;

revoke all on function public.member_portal_access_state(uuid) from public;
grant execute on function public.member_portal_access_state(uuid) to authenticated, service_role;

create or replace function public.member_has_portal(p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.member_portal_access_state(p_member_id) = 'active';
$$;

comment on function public.member_has_portal(uuid) is
  'True solo con un vínculo activo y coherente entre ficha, perfil y cuenta. El correo o un dato viejo no alcanzan.';

create or replace function public.member_in_viewer_household(
  p_member_number text,
  p_meta jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  my_num text;
  my_principal text;
  household text;
  linked int;
  target_num text := regexp_replace(coalesce(p_member_number, ''), '\D', '', 'g');
  target_principal text := regexp_replace(coalesce(p_meta->>'familyPrincipalNumber', ''), '\D', '', 'g');
begin
  if uid is null or target_num = '' then
    return false;
  end if;

  select count(*) into linked
  from public.members m
  where m.profile_id = uid;
  if linked <> 1 then
    return false;
  end if;

  if exists (
    select 1
    from public.profiles p
    left join auth.users u on u.id = p.id
    where p.id = uid
      and (
        coalesce(p.is_active, false) = false
        or u.id is null
        or u.deleted_at is not null
        or (u.banned_until is not null and u.banned_until > now())
      )
  ) then
    return false;
  end if;

  select
    regexp_replace(coalesce(m.member_number, ''), '\D', '', 'g'),
    regexp_replace(coalesce(m.meta->>'familyPrincipalNumber', ''), '\D', '', 'g')
  into my_num, my_principal
  from public.members m
  where m.profile_id = uid;

  if my_num is null or my_num = '' then
    return false;
  end if;

  if my_principal is not null and my_principal <> '' and my_principal <> my_num then
    household := my_principal;
  else
    household := my_num;
  end if;

  return target_num = household
    or (target_principal <> '' and target_principal = household)
    or target_num = my_num;
end;
$$;

create or replace function public.list_household_members(p_principal text)
returns table (
  id uuid,
  profile_id uuid,
  member_number text,
  card_number text,
  full_name text,
  phone text,
  email text,
  tier text,
  status text,
  outstanding_balance numeric,
  next_due_date date,
  overdue_since date,
  document_number text,
  document_type text,
  joined_at date,
  birth_date date,
  photo_url text,
  disciplines text[],
  family_principal text,
  family_group_name text,
  cuota_categories jsonb,
  last_payment_date text,
  current_account_as_of text,
  unpaid_capital numeric,
  fecha_alta_raw text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  key text := regexp_replace(coalesce(p_principal, ''), '\D', '', 'g');
  v_uid uuid := auth.uid();
  allowed boolean := false;
  staff boolean := false;
  linked int := 0;
begin
  if key = '' or v_uid is null then
    return;
  end if;

  begin
    staff := coalesce(public.has_staff_access(), false);
  exception when others then
    staff := false;
  end;

  if staff then
    allowed := true;
  else
    select count(*) into linked
    from public.members m
    where m.profile_id = v_uid;
    if linked <> 1 then
      return;
    end if;
    select exists (
      select 1
      from public.members m
      where m.profile_id = v_uid
        and (
          regexp_replace(coalesce(m.member_number, ''), '\D', '', 'g') = key
          or regexp_replace(coalesce(m.meta->>'familyPrincipalNumber', ''), '\D', '', 'g') = key
        )
    ) into allowed;
  end if;

  if not allowed then
    return;
  end if;

  return query
  select
    m.id,
    m.profile_id,
    m.member_number::text,
    m.card_number::text,
    m.full_name::text,
    m.phone::text,
    m.email::text,
    m.tier::text,
    m.status::text,
    m.outstanding_balance,
    m.next_due_date,
    m.overdue_since,
    m.document_number,
    m.document_type,
    m.joined_at,
    m.birth_date,
    m.photo_url,
    m.disciplines,
    m.meta->>'familyPrincipalNumber',
    m.meta->>'familyGroupName',
    m.meta->'cuotaCategories',
    m.meta->>'lastPaymentDate',
    m.meta->>'currentAccountAsOf',
    nullif(m.meta->>'unpaidCapital', '')::numeric,
    m.meta->>'fechaAltaRaw'
  from public.members m
  where regexp_replace(coalesce(m.member_number, ''), '\D', '', 'g') = key
     or regexp_replace(coalesce(m.meta->>'familyPrincipalNumber', ''), '\D', '', 'g') = key
  order by
    case when regexp_replace(coalesce(m.member_number, ''), '\D', '', 'g') = key then 0 else 1 end,
    m.member_number;
end;
$$;

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
  v_by_doc uuid;
  v_by_email uuid;
  v_member_id uuid;
  v_member_number text;
  v_linked int;
begin
  if uid is null then
    return null;
  end if;

  select count(*) into v_linked
  from public.members m
  where m.profile_id = uid;
  if v_linked > 1 then
    return null;
  end if;
  if v_linked = 1 then
    select m.member_number into v_member_number
    from public.members m
    where m.profile_id = uid;
    return v_member_number;
  end if;

  select
    regexp_replace(coalesce(p.document_number, ''), '\D', '', 'g'),
    lower(trim(coalesce(p.email, '')))
  into v_doc, v_email
  from public.profiles p
  where p.id = uid
    and coalesce(p.is_active, false);

  if not found then
    return null;
  end if;

  if length(coalesce(v_doc, '')) >= 7 then
    select count(*) into v_linked
    from public.members m
    where m.profile_id is null
      and m.status::text = 'active'
      and regexp_replace(coalesce(m.document_number, ''), '\D', '', 'g') = v_doc;
    if v_linked > 1 then
      return null;
    end if;
    if v_linked = 1 then
      select m.id into v_by_doc
      from public.members m
      where m.profile_id is null
        and m.status::text = 'active'
        and regexp_replace(coalesce(m.document_number, ''), '\D', '', 'g') = v_doc;
    end if;
  end if;

  if coalesce(v_email, '') <> '' then
    select count(*) into v_linked
    from public.members m
    where m.profile_id is null
      and m.status::text = 'active'
      and lower(trim(coalesce(m.email, ''))) = v_email;
    if v_linked > 1 then
      return null;
    end if;
    if v_linked = 1 then
      select m.id into v_by_email
      from public.members m
      where m.profile_id is null
        and m.status::text = 'active'
        and lower(trim(coalesce(m.email, ''))) = v_email;
    end if;
  end if;

  if v_by_doc is not null and v_by_email is not null and v_by_doc <> v_by_email then
    return null;
  end if;

  v_member_id := coalesce(v_by_doc, v_by_email);
  if v_member_id is null then
    return null;
  end if;

  if public.portal_identity_block_reason(v_member_id, v_email, v_doc, uid) is not null then
    return null;
  end if;

  update public.members
  set profile_id = uid,
      updated_at = now()
  where id = v_member_id
    and profile_id is null
  returning member_number into v_member_number;

  return v_member_number;
end;
$$;

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
set search_path = public
as $$
declare
  existing uuid;
  doc_digits text := regexp_replace(coalesce(p_document_number, ''), '\D', '', 'g');
  member_digits text := regexp_replace(coalesce(p_member_number, ''), '\D', '', 'g');
  mail text := lower(trim(coalesce(p_email, '')));
  v_by_number uuid;
  v_by_doc uuid;
  v_by_mail uuid;
  v_number_count int := 0;
  v_doc_count int := 0;
  v_mail_count int := 0;
begin
  if length(trim(coalesce(p_full_name, ''))) < 3 then
    raise exception 'Nombre requerido';
  end if;

  if member_digits <> '' then
    select count(*) into v_number_count
    from public.members m
    where regexp_replace(coalesce(m.member_number, ''), '\D', '', 'g') = member_digits;
    if v_number_count = 1 then
      select m.id into v_by_number
      from public.members m
      where regexp_replace(coalesce(m.member_number, ''), '\D', '', 'g') = member_digits;
    elsif v_number_count > 1 then
      raise exception 'Conflicto de identidad: el número de socio no es único.';
    end if;
  end if;

  if char_length(doc_digits) >= 7 then
    select count(*) into v_doc_count
    from public.members m
    where m.status::text = 'active'
      and regexp_replace(coalesce(m.document_number, ''), '\D', '', 'g') = doc_digits;
    if v_doc_count = 1 then
      select m.id into v_by_doc
      from public.members m
      where m.status::text = 'active'
        and regexp_replace(coalesce(m.document_number, ''), '\D', '', 'g') = doc_digits;
    elsif v_doc_count > 1 then
      raise exception 'Conflicto de identidad: el DNI está en más de una ficha activa.';
    end if;
  end if;

  if mail <> '' then
    select count(*) into v_mail_count
    from public.members m
    where lower(trim(coalesce(m.email, ''))) = mail;
    if v_mail_count = 1 then
      select m.id into v_by_mail
      from public.members m
      where lower(trim(coalesce(m.email, ''))) = mail;
    elsif v_mail_count > 1 then
      raise exception 'Conflicto de identidad: el correo está en más de una ficha.';
    end if;
  end if;

  if v_by_number is not null and v_by_doc is not null and v_by_number <> v_by_doc then
    raise exception 'Conflicto de identidad: el número de socio y el DNI no son de la misma ficha.';
  end if;
  if v_by_number is not null and v_by_mail is not null and v_by_number <> v_by_mail then
    raise exception 'Conflicto de identidad: el correo pertenece a otra ficha.';
  end if;
  if v_by_doc is not null and v_by_mail is not null and v_by_doc <> v_by_mail then
    raise exception 'Conflicto de identidad: el correo y el DNI no son de la misma ficha.';
  end if;
  if p_member_id is not null and v_by_doc is not null and p_member_id <> v_by_doc then
    raise exception 'Conflicto de identidad: el DNI no es el de la ficha indicada.';
  end if;
  if p_member_id is not null and v_by_mail is not null and p_member_id <> v_by_mail then
    raise exception 'Conflicto de identidad: el correo no es el de la ficha indicada.';
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
    coalesce(p_member_id, v_by_number, v_by_doc, v_by_mail),
    'pending'
  )
  returning id into existing;

  return existing;
end;
$$;

notify pgrst, 'reload schema';
