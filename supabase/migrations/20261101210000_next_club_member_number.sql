-- Correlativo de Nº de socio (1–6 dígitos). Ignora altas random tipo tarjeta.
create or replace function public.next_club_member_number()
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    (
      select (max(member_number::bigint) + 1)::text
      from public.members
      where member_number ~ '^[0-9]{1,6}$'
    ),
    '10001'
  );
$$;

revoke all on function public.next_club_member_number() from public;
grant execute on function public.next_club_member_number() to authenticated;

comment on function public.next_club_member_number() is
  'Próximo Nº de socio institucional (1–6 dígitos). Ignora credenciales random de 13+ dígitos.';
