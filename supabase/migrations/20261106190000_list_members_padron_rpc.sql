-- Padrón staff en un solo viaje (SECURITY DEFINER + has_staff_access una vez).
-- Evita N páginas PostgREST con extracción meta->> por fila.

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
  reactivate_registrada text
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
    case when want_inactive then m.meta->>'reactivateRegistradaAt' else null end
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
