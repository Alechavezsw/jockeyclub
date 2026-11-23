-- Socios inactivos fuera de los circuitos operativos.
-- No borra fichas, pagos, deuda ni asientos. No se aplica solo: hay que verificar antes.
-- La baja programada sigue operativa hasta el día anterior a meta.bajaFecha.

-- El retorno de la búsqueda y del padrón suma la fecha de baja.
-- CREATE OR REPLACE no puede cambiar el tipo de retorno que ya está en la base.
drop function if exists public.search_members_lookup(text, integer);
drop function if exists public.search_members_reactivate(text, integer);
drop function if exists public.search_members_historical(text, integer);
drop function if exists public.search_members_scoped(text, integer, text);
drop function if exists public.list_members_padron(text);

-- Fecha real. Un texto imposible devuelve null y no aborta el padrón.
create or replace function public.member_calendar_date(p_raw text)
returns date
language plpgsql
immutable
as $fn$
declare
  v text := left(btrim(coalesce(p_raw, '')), 10);
  y int;
  m int;
  d int;
  leap boolean;
begin
  if v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return null;
  end if;
  y := substr(v, 1, 4)::int;
  m := substr(v, 6, 2)::int;
  d := substr(v, 9, 2)::int;
  if m < 1 or m > 12 or d < 1 then
    return null;
  end if;
  if m in (1, 3, 5, 7, 8, 10, 12) then
    if d > 31 then
      return null;
    end if;
  elsif m in (4, 6, 9, 11) then
    if d > 30 then
      return null;
    end if;
  else
    leap := (y % 4 = 0 and y % 100 <> 0) or (y % 400 = 0);
    if d > 29 or (d = 29 and not leap) then
      return null;
    end if;
  end if;
  return make_date(y, m, d);
exception
  when others then
    return null;
end;
$fn$;

create or replace function public.member_baja_fecha_needs_review(p_member public.members)
returns boolean
language sql
stable
as $fn$
  select nullif(left(btrim(coalesce(p_member.meta->>'bajaFecha', '')), 10), '') is not null
    and public.member_calendar_date(p_member.meta->>'bajaFecha') is null;
$fn$;

create or replace function public.member_is_operational(
  p_member public.members,
  p_today date default null
)
returns boolean
language plpgsql
stable
as $fn$
declare
  v_today date := coalesce(
    p_today,
    (now() at time zone 'America/Argentina/Buenos_Aires')::date
  );
  v_status text := lower(coalesce(p_member.status::text, ''));
  v_baja date := public.member_calendar_date(p_member.meta->>'bajaFecha');
begin
  if p_member.id is null then
    return false;
  end if;
  if v_status in ('suspended', 'pending', 'baja') then
    return false;
  end if;
  if v_status = 'inactive' then
    return v_baja is not null and v_baja > v_today;
  end if;
  if v_status = 'active' then
    return v_baja is null or v_baja > v_today;
  end if;
  return false;
end;
$fn$;

create or replace function public.member_is_reactivatable(
  p_member public.members,
  p_today date default null
)
returns boolean
language plpgsql
stable
as $fn$
declare
  v_today date := coalesce(
    p_today,
    (now() at time zone 'America/Argentina/Buenos_Aires')::date
  );
  v_status text := lower(coalesce(p_member.status::text, ''));
  v_baja date := public.member_calendar_date(p_member.meta->>'bajaFecha');
begin
  if p_member.id is null or public.member_is_operational(p_member, v_today) then
    return false;
  end if;
  if v_status in ('inactive', 'suspended') then
    return true;
  end if;
  return v_status = 'active'
    and v_baja is not null
    and v_baja <= v_today;
end;
$fn$;

revoke all on function public.member_calendar_date(text) from public;
revoke all on function public.member_baja_fecha_needs_review(public.members) from public;
revoke all on function public.member_is_operational(public.members, date) from public;
revoke all on function public.member_is_reactivatable(public.members, date) from public;
grant execute on function public.member_calendar_date(text) to anon, authenticated, service_role;
grant execute on function public.member_baja_fecha_needs_review(public.members) to anon, authenticated, service_role;
grant execute on function public.member_is_operational(public.members, date) to anon, authenticated, service_role;
grant execute on function public.member_is_reactivatable(public.members, date) to anon, authenticated, service_role;

-- Búsqueda única. El alcance lo elige el wrapper.
create or replace function public.search_members_scoped(
  p_query text,
  p_limit integer,
  p_scope text
)
returns table (
  id uuid,
  member_number text,
  full_name text,
  document_number text,
  status text,
  has_portal boolean,
  tier text,
  outstanding_balance numeric,
  next_due_date date,
  cuota_categories jsonb,
  baja_fecha text,
  pending_baja text
)
language plpgsql
security definer
set search_path to 'public'
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
  v_scope text := lower(coalesce(nullif(btrim(p_scope), ''), 'operational'));
  v_key text;
  v_hits integer;
  fold_from constant text := 'áéíóúüñàèìòùäëïö';
  fold_to constant text := 'aeiouunaeiouaeioo';
begin
  if q = '' then
    return;
  end if;
  if v_scope not in ('operational', 'reactivate', 'historical') then
    v_scope := 'operational';
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
    if v_scope <> 'operational' then
      return;
    end if;
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
      or exists (
        select 1
        from public.profiles p
        where (
          length(regexp_replace(coalesce(m.document_number, ''), '\D', '', 'g')) >= 7
          and regexp_replace(coalesce(p.document_number, ''), '\D', '', 'g')
            = regexp_replace(coalesce(m.document_number, ''), '\D', '', 'g')
        )
        or (
          coalesce(m.email, '') <> ''
          and lower(p.email) = lower(m.email)
        )
      )
    ) as has_portal,
    case when v_staff then m.tier::text else null end,
    case when v_staff then m.outstanding_balance else null end,
    case when v_staff then m.next_due_date else null end,
    case
      when v_staff then coalesce(m.meta->'cuotaCategories', '[]'::jsonb)
      else null
    end as cuota_categories,
    nullif(left(coalesce(m.meta->>'bajaFecha', ''), 10), '') as baja_fecha,
    case
      when coalesce(m.meta->>'pendingBaja', '') in ('true', 't', '1') then 'true'
      else null
    end as pending_baja
  from public.members m
  where
    (
      case v_scope
        when 'reactivate' then public.member_is_reactivatable(m)
        when 'historical' then true
        else public.member_is_operational(m)
      end
    )
    and (
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
$function$;

revoke all on function public.search_members_scoped(text, integer, text) from public, anon, authenticated;

create or replace function public.search_members_lookup(p_query text, p_limit integer default 8)
returns table (
  id uuid,
  member_number text,
  full_name text,
  document_number text,
  status text,
  has_portal boolean,
  tier text,
  outstanding_balance numeric,
  next_due_date date,
  cuota_categories jsonb,
  baja_fecha text,
  pending_baja text
)
language sql
security definer
set search_path to 'public'
as $function$
  select * from public.search_members_scoped(p_query, p_limit, 'operational');
$function$;

revoke all on function public.search_members_lookup(text, integer) from public;
grant execute on function public.search_members_lookup(text, integer) to anon, authenticated;

create or replace function public.search_members_reactivate(p_query text, p_limit integer default 20)
returns table (
  id uuid,
  member_number text,
  full_name text,
  document_number text,
  status text,
  has_portal boolean,
  tier text,
  outstanding_balance numeric,
  next_due_date date,
  cuota_categories jsonb,
  baja_fecha text,
  pending_baja text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or coalesce(public.has_staff_access(), false) is not true then
    raise exception 'Sin permiso para buscar socios inactivos.' using errcode = '42501';
  end if;
  return query
  select * from public.search_members_scoped(p_query, p_limit, 'reactivate');
end;
$function$;

revoke all on function public.search_members_reactivate(text, integer) from public, anon;
grant execute on function public.search_members_reactivate(text, integer) to authenticated;

create or replace function public.search_members_historical(p_query text, p_limit integer default 20)
returns table (
  id uuid,
  member_number text,
  full_name text,
  document_number text,
  status text,
  has_portal boolean,
  tier text,
  outstanding_balance numeric,
  next_due_date date,
  cuota_categories jsonb,
  baja_fecha text,
  pending_baja text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null
     or not (
       coalesce(public.has_admin_access(), false)
       or coalesce(public.has_capability('members.historical'), false)
     ) then
    raise exception 'Sin permiso para la consulta histórica de socios.' using errcode = '42501';
  end if;
  return query
  select * from public.search_members_scoped(p_query, p_limit, 'historical');
end;
$function$;

revoke all on function public.search_members_historical(text, integer) from public, anon;
grant execute on function public.search_members_historical(text, integer) to authenticated;

insert into public.role_capabilities (capability, role_key)
select v.capability, v.role_key
from (values
  ('members.historical', 'admin'),
  ('members.historical', 'superadmin'),
  ('members.historical', 'accountant')
) as v(capability, role_key)
where not exists (
  select 1
  from public.role_capabilities c
  where c.capability = v.capability
    and c.role_key = v.role_key
);

-- Padrón: activo operativo / resto (inactivos efectivos y suspendidos).
create or replace function public.list_members_padron(p_scope text default 'active')
returns table(
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
  last_payment_date text,
  family_principal text,
  family_group_name text,
  cuota_categories jsonb,
  current_account_as_of text,
  unpaid_capital numeric,
  dues_open_periods jsonb,
  baja_motivo text,
  baja_fecha text,
  baja_actor text,
  baja_registrada text,
  reactivate_actor text,
  reactivate_registrada text,
  has_portal boolean,
  joined_at date,
  dues_free_through text,
  birth_date date,
  pending_baja text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  want_inactive boolean := lower(coalesce(p_scope, 'active')) = 'inactive';
begin
  if auth.uid() is null or not public.has_staff_access() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return query
  select
    m.id,
    m.profile_id,
    m.member_number,
    m.card_last4,
    m.full_name,
    m.phone,
    m.email,
    m.tier,
    m.status::text,
    m.outstanding_balance,
    m.next_due_date,
    m.overdue_since,
    m.document_number,
    m.document_type,
    m.meta->>'lastPaymentDate',
    m.meta->>'familyPrincipalNumber',
    m.meta->>'familyGroupName',
    m.meta->'cuotaCategories',
    m.meta->>'currentAccountAsOf',
    case
      when m.meta ? 'unpaidCapital'
        then coalesce(nullif(m.meta->>'unpaidCapital', '')::numeric, 0)
      else null
    end,
    case
      when m.meta ? 'duesOpenPeriods' then coalesce(m.meta->'duesOpenPeriods', '[]'::jsonb)
      else null
    end,
    case when want_inactive then m.meta->>'bajaMotivo' else null end,
    nullif(left(coalesce(m.meta->>'bajaFecha', ''), 10), ''),
    case when want_inactive then m.meta->>'bajaActorName' else null end,
    case when want_inactive then m.meta->>'bajaRegistradaAt' else null end,
    case when want_inactive then m.meta->>'reactivateActorName' else null end,
    case when want_inactive then m.meta->>'reactivateRegistradaAt' else null end,
    (
      m.profile_id is not null
      or coalesce(m.meta->>'portalProvisionedAt', '') <> ''
      or coalesce(m.meta->>'portalUsername', '') <> ''
      or exists (
        select 1
        from public.profiles p
        where (
          length(regexp_replace(coalesce(m.document_number, ''), '\D', '', 'g')) >= 7
          and regexp_replace(coalesce(p.document_number, ''), '\D', '', 'g')
            = regexp_replace(coalesce(m.document_number, ''), '\D', '', 'g')
        )
        or (
          coalesce(m.email, '') <> ''
          and lower(p.email) = lower(m.email)
        )
      )
    ),
    case
      when m.joined_at is not null and m.joined_at > date '1900-01-01' then m.joined_at
      when public.member_calendar_date(m.meta->>'fechaAltaRaw') > date '1900-01-01'
        then public.member_calendar_date(m.meta->>'fechaAltaRaw')
      else m.joined_at
    end,
    nullif(left(coalesce(m.meta->>'duesFreeThrough', ''), 7), ''),
    m.birth_date,
    case
      when coalesce(m.meta->>'pendingBaja', '') in ('true', 't', '1') then 'true'
      else null
    end
  from public.members m
  where case
    when want_inactive then not public.member_is_operational(m)
    else public.member_is_operational(m)
  end
  order by
    exists (
      select 1
      from public.portal_access_requests r
      where r.created_at > now() - interval '8 days'
        and (
          r.member_id = m.id
          or (
            coalesce(r.member_number, '') <> ''
            and r.member_number = m.member_number
          )
        )
    ) desc,
    m.id;
end;
$function$;

revoke all on function public.list_members_padron(text) from public, anon;
grant execute on function public.list_members_padron(text) to authenticated, service_role;

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
    m.document_number::text,
    m.document_type::text,
    m.joined_at,
    m.birth_date,
    m.photo_url::text,
    m.disciplines,
    m.meta->>'familyPrincipalNumber',
    m.meta->>'familyGroupName',
    m.meta->'cuotaCategories',
    m.meta->>'lastPaymentDate',
    m.meta->>'currentAccountAsOf',
    nullif(m.meta->>'unpaidCapital', '')::numeric,
    m.meta->>'fechaAltaRaw'
  from public.members m
  where (
      regexp_replace(coalesce(m.member_number, ''), '\D', '', 'g') = key
      or regexp_replace(coalesce(m.meta->>'familyPrincipalNumber', ''), '\D', '', 'g') = key
    )
    and public.member_is_operational(m)
  order by
    case when regexp_replace(coalesce(m.member_number, ''), '\D', '', 'g') = key then 0 else 1 end,
    m.member_number;
end;
$$;

revoke all on function public.list_household_members(text) from public;
grant execute on function public.list_household_members(text) to authenticated, service_role;

create or replace function public.reject_nonoperational_member_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.members;
begin
  if new.member_id is null then
    return new;
  end if;
  select * into v_member from public.members where id = new.member_id;
  if not found or public.member_is_operational(v_member) then
    return new;
  end if;
  raise exception 'El socio está inactivo y no entra en los circuitos operativos.'
    using errcode = 'P0001';
end;
$$;

create or replace function public.reject_automatic_notice_to_inactive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auto boolean;
  v_member public.members;
  v_key text;
begin
  v_auto := coalesce(new.meta->>'automatic', '') in ('true', 't', '1')
    or coalesce(new.meta->>'broadcast', '') in ('true', 't', '1')
    or coalesce(new.meta->>'kind', '') in ('campaign', 'broadcast', 'dues_mora', 'dues_notice')
    or nullif(new.meta->>'campaignId', '') is not null;
  if not v_auto then
    return new;
  end if;
  v_key := nullif(btrim(coalesce(new.recipient_key, '')), '');
  if v_key is null then
    return new;
  end if;
  select * into v_member
  from public.members m
  where m.id::text = v_key
     or (
       regexp_replace(v_key, '\D', '', 'g') <> ''
       and regexp_replace(coalesce(m.member_number, ''), '\D', '', 'g')
         = regexp_replace(v_key, '\D', '', 'g')
     )
  limit 1;
  if found and not public.member_is_operational(v_member) then
    raise exception 'No se envían avisos automáticos a un socio inactivo.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reject_inactive_member_payment on public.member_payments;
create trigger trg_reject_inactive_member_payment
  before insert on public.member_payments
  for each row execute function public.reject_nonoperational_member_write();

drop trigger if exists trg_reject_inactive_reservation on public.reservations;
create trigger trg_reject_inactive_reservation
  before insert on public.reservations
  for each row execute function public.reject_nonoperational_member_write();

drop trigger if exists trg_reject_inactive_waitlist on public.reservation_waitlist;
create trigger trg_reject_inactive_waitlist
  before insert on public.reservation_waitlist
  for each row execute function public.reject_nonoperational_member_write();

drop trigger if exists trg_reject_inactive_access on public.access_logs;
create trigger trg_reject_inactive_access
  before insert on public.access_logs
  for each row execute function public.reject_nonoperational_member_write();

create or replace function public.reject_inactive_guest_pass()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.members;
begin
  if new.host_member_id is null then
    return new;
  end if;
  select * into v_member from public.members where id = new.host_member_id;
  if not found or public.member_is_operational(v_member) then
    return new;
  end if;
  raise exception 'El socio está inactivo y no entra en los circuitos operativos.'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists trg_reject_inactive_guest_pass on public.guest_passes;
create trigger trg_reject_inactive_guest_pass
  before insert on public.guest_passes
  for each row execute function public.reject_inactive_guest_pass();

drop trigger if exists trg_reject_inactive_automatic_message on public.messages;
create trigger trg_reject_inactive_automatic_message
  before insert on public.messages
  for each row execute function public.reject_automatic_notice_to_inactive();

-- Un socio común o anónimo no lee fichas inactivas por la tabla.
-- El personal sigue viendo el padrón; Reactivar e histórico pasan por su RPC.
drop policy if exists members_select on public.members;
create policy members_select on public.members
for select
to public
using (
  profile_id = (select auth.uid())
  or (select public.has_staff_access())
  or (
    public.member_in_viewer_household(member_number, meta)
    and public.member_is_operational(members)
  )
);

notify pgrst, 'reload schema';
