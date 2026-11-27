-- PILETA (No socio) y COLONIA (No socio) no liquidan cuota social.
-- Un familiar que también tenga esa categoría sigue pagando la cuota.

create or replace function public.member_is_dues_exempt(m public.members)
returns boolean
language sql
stable
as $$
  select
    coalesce(m.tier::text, '') ~* '(vitalicio|fundador|^comision$)'
    or coalesce(m.meta->>'cuotaCategories', '') ~* '(vitalicio|fundador|comision)'
    or (
      coalesce(m.meta->>'cuotaCategories', '') ~* 'pileta \(no socio\)|pileta_no_socio'
      and coalesce(m.meta->>'cuotaCategories', '') !~* 'socio familiar|socio individual|grupo familiar|fundador|vitalicio|comision|amet|turf'
    )
    or (
      coalesce(m.tier::text, '') ~* '^pileta_no_socio$'
      and coalesce(m.meta->>'cuotaCategories', '') !~* 'socio familiar|socio individual|grupo familiar|fundador|vitalicio|comision|amet|turf'
    )
    or (
      coalesce(m.meta->>'cuotaCategories', '') ~* 'colonia \(no socio\)|colonia_no_socio'
      and coalesce(m.meta->>'cuotaCategories', '') !~* 'socio familiar|socio individual|grupo familiar|fundador|vitalicio|comision|amet|turf'
    )
    or (
      coalesce(m.tier::text, '') ~* '^colonia_no_socio$'
      and coalesce(m.meta->>'cuotaCategories', '') !~* 'socio familiar|socio individual|grupo familiar|fundador|vitalicio|comision|amet|turf'
    );
$$;

comment on function public.member_is_dues_exempt(public.members) is
  'Vitalicio, fundador, comisión, pileta no socio y colonia no socio (sin otra categoría que liquide) no abonan cuota social.';
