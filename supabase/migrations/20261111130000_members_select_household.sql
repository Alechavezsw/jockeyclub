-- El socio ve a todo su grupo familiar (titular + integrantes), no solo su fila.

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
  target_num text := regexp_replace(coalesce(p_member_number, ''), '\D', '', 'g');
  target_principal text := regexp_replace(coalesce(p_meta->>'familyPrincipalNumber', ''), '\D', '', 'g');
begin
  if uid is null or target_num = '' then
    return false;
  end if;

  select
    regexp_replace(coalesce(m.member_number, ''), '\D', '', 'g'),
    regexp_replace(coalesce(m.meta->>'familyPrincipalNumber', ''), '\D', '', 'g')
  into my_num, my_principal
  from public.members m
  where m.profile_id = uid
  limit 1;

  if my_num is null or my_num = '' then
    return false;
  end if;

  if my_principal is not null and my_principal <> '' and my_principal <> my_num then
    household := my_principal;
  else
    household := my_num;
  end if;

  return target_num = household
    or target_principal = household
    or target_num = my_num;
end;
$$;

revoke all on function public.member_in_viewer_household(text, jsonb) from public;
grant execute on function public.member_in_viewer_household(text, jsonb) to authenticated;
grant execute on function public.member_in_viewer_household(text, jsonb) to anon;

drop policy if exists members_select on public.members;
create policy members_select on public.members
for select
to public
using (
  (profile_id = (select auth.uid()))
  or (select public.has_staff_access())
  or public.member_in_viewer_household(member_number, meta)
);

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

notify pgrst, 'reload schema';
