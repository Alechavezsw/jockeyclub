-- Padrón: «Con app» si ya abrió el portal (profile_id, meta, o match por DNI/mail).
-- Antes solo miraba profile_id; muchos socios entran por DNI sin vínculo en members.

drop function if exists public.list_members_padron(text);

create or replace function public.list_members_padron(p_scope text default 'active')
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
  has_portal boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
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
    m.card_number,
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
    ) as has_portal
  from public.members m
  where case
    when want_inactive then m.status is distinct from 'active'::public.member_status
    else m.status = 'active'::public.member_status
  end
  order by m.id;
end;
$$;

revoke all on function public.list_members_padron(text) from public;
grant execute on function public.list_members_padron(text) to authenticated;

comment on function public.list_members_padron(text) is
  'Padrón staff (activo/inactivo) con has_portal alineado al login por DNI/mail.';

-- Vincula fichas 1:1 por DNI cuando el socio ya tiene cuenta y falta profile_id.
with candidates as (
  select
    m2.id as member_id,
    p.id as profile_id,
    count(*) over (partition by m2.id) as profiles_for_member,
    count(*) over (partition by p.id) as members_for_profile
  from public.members m2
  join public.profiles p
    on length(regexp_replace(coalesce(m2.document_number, ''), '\D', '', 'g')) >= 7
   and regexp_replace(coalesce(p.document_number, ''), '\D', '', 'g')
     = regexp_replace(coalesce(m2.document_number, ''), '\D', '', 'g')
  where m2.profile_id is null
)
update public.members m
set profile_id = c.profile_id,
    updated_at = now()
from candidates c
where m.id = c.member_id
  and c.profiles_for_member = 1
  and c.members_for_profile = 1
  and m.profile_id is null
  and not exists (
    select 1 from public.members x
    where x.profile_id = c.profile_id
  );
