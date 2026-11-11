-- El listado del padrón salía cortado en 1000 filas (tope de PostgREST).
-- Devuelve un solo jsonb con todos los socios activos para que la bandeja
-- encuentre la ficha y pueda generar el acceso.

drop function if exists public.list_members_padron(text);

create function public.list_members_padron(p_scope text default 'active')
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  want_inactive boolean := lower(coalesce(p_scope, 'active')) = 'inactive';
  payload jsonb;
begin
  if auth.uid() is null or not public.has_staff_access() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)
    into payload
  from (
    select
      m.id,
      m.profile_id,
      m.member_number,
      m.card_last4 as card_number,
      m.full_name,
      m.phone,
      m.email,
      m.tier,
      m.status::text as status,
      m.outstanding_balance,
      m.next_due_date,
      m.overdue_since,
      m.document_number,
      m.document_type,
      m.meta->>'lastPaymentDate' as last_payment_date,
      m.meta->>'familyPrincipalNumber' as family_principal,
      m.meta->>'familyGroupName' as family_group_name,
      m.meta->'cuotaCategories' as cuota_categories,
      m.meta->>'currentAccountAsOf' as current_account_as_of,
      case when want_inactive then m.meta->>'bajaMotivo' else null end as baja_motivo,
      case when want_inactive then m.meta->>'bajaFecha' else null end as baja_fecha,
      case when want_inactive then m.meta->>'bajaActorName' else null end as baja_actor,
      case when want_inactive then m.meta->>'bajaRegistradaAt' else null end as baja_registrada,
      case when want_inactive then m.meta->>'reactivateActorName' else null end as reactivate_actor,
      case when want_inactive then m.meta->>'reactivateRegistradaAt' else null end as reactivate_registrada,
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
      case
        when m.joined_at is not null and m.joined_at > date '1900-01-01' then m.joined_at
        when coalesce(m.meta->>'fechaAltaRaw', '') ~ '^\d{4}-\d{2}-\d{2}'
          and (left(m.meta->>'fechaAltaRaw', 10))::date > date '1900-01-01'
          then (left(m.meta->>'fechaAltaRaw', 10))::date
        else m.joined_at
      end as joined_at
    from public.members m
    where case
      when want_inactive then m.status is distinct from 'active'::public.member_status
      else m.status = 'active'::public.member_status
    end
  ) t;

  return payload;
end;
$function$;

revoke all on function public.list_members_padron(text) from public;
grant execute on function public.list_members_padron(text) to authenticated, service_role;

notify pgrst, 'reload schema';
