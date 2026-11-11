-- El panel publicado pide el padrón de una vez y PostgREST corta en 1000 filas.
-- Esas 1000 son las de menor id, y las solicitudes de acceso quedan afuera:
-- la bandeja dice «Sin ficha automática» aunque la ficha exista.
-- Las fichas con un pedido de los últimos 8 días van primero, así entran en ese corte.
-- Si solo se priorizan los pendientes, al aprobar el acceso la ficha sale de la lista
-- y el botón «Entregar acceso» deja de encontrarla.

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
  baja_motivo text,
  baja_fecha text,
  baja_actor text,
  baja_registrada text,
  reactivate_actor text,
  reactivate_registrada text,
  has_portal boolean,
  joined_at date
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
    case when want_inactive then m.meta->>'bajaMotivo' else null end,
    case when want_inactive then m.meta->>'bajaFecha' else null end,
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
      when coalesce(m.meta->>'fechaAltaRaw', '') ~ '^\d{4}-\d{2}-\d{2}'
        and (left(m.meta->>'fechaAltaRaw', 10))::date > date '1900-01-01'
        then (left(m.meta->>'fechaAltaRaw', 10))::date
      else m.joined_at
    end
  from public.members m
  where case
    when want_inactive then m.status is distinct from 'active'::public.member_status
    else m.status = 'active'::public.member_status
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

notify pgrst, 'reload schema';
