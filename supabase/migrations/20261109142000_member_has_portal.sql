-- Detecta acceso al portal aunque members.profile_id todavía no esté vinculado.

create or replace function public.member_has_portal(p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.members m
    where m.id = p_member_id
      and (
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
      )
  );
$$;

revoke all on function public.member_has_portal(uuid) from public;
grant execute on function public.member_has_portal(uuid) to authenticated;

comment on function public.member_has_portal(uuid) is
  'True si el socio ya abrió el portal (profile_id, meta o match DNI/mail).';
