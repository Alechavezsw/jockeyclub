-- Conteo exacto de titulares activos (no integrantes de grupo familiar).

create or replace function public.count_active_titulares()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.members m
  where m.status = 'active'::public.member_status
    and (
      coalesce(m.meta->>'familyPrincipalNumber', '') = ''
      or regexp_replace(coalesce(m.meta->>'familyPrincipalNumber', ''), '\D', '', 'g')
         = regexp_replace(coalesce(m.member_number::text, ''), '\D', '', 'g')
    );
$$;

revoke all on function public.count_active_titulares() from public;
grant execute on function public.count_active_titulares() to authenticated;

comment on function public.count_active_titulares() is
  'Titulares activos del padrón (excluye integrantes con principal distinto).';
