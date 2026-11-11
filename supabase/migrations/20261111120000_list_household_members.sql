-- Grupo familiar legible para el titular/integrante (o staff).
-- RLS de members solo deja ver la propia fila; el portal necesita el hogar entero.

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
begin
  if key = '' or v_uid is null then
    return;
  end if;

  if public.has_staff_access() then
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
    m.member_number,
    m.card_number,
    m.full_name,
    m.phone,
    m.email,
    m.tier,
    m.status,
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

alter function public.list_household_members(text) owner to postgres;
revoke all on function public.list_household_members(text) from public;
grant execute on function public.list_household_members(text) to authenticated;
grant execute on function public.list_household_members(text) to service_role;
