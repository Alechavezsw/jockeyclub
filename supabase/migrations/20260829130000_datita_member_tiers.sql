-- Categorías de socios = padrón real (text). Gold/Platinum dejan de existir como enum.
alter table public.members alter column tier drop default;
alter table public.member_adherents alter column tier drop default;

alter table public.members
  alter column tier type text using tier::text;

alter table public.member_adherents
  alter column tier type text using tier::text;

alter table public.members alter column tier set default 'socio_individual';
alter table public.member_adherents alter column tier set default 'socio_individual';

drop type if exists public.member_tier;

-- Remap desde meta.cuotaCategories (prioridad: membresía > interés/comisión)
create or replace function public._datita_slug_tier(cat text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(
      regexp_replace(
        regexp_replace(
          lower(translate(trim(cat), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
          '\s+', '_', 'g'
        ),
        '[^a-z0-9_]', '', 'g'
      ),
      ''
    ),
    'socio_individual'
  );
$$;

update public.members m
set tier = public._datita_slug_tier(picked.cat)
from (
  select
    m2.id,
    coalesce(
      (
        select c
        from jsonb_array_elements_text(coalesce(m2.meta->'cuotaCategories', '[]'::jsonb)) as t(c)
        where c !~* '^(COMISION|INTERES POR TRANSACC)'
        order by
          case
            when upper(c) = 'FUNDADOR' then 1
            when upper(c) like '%GRUPO FAMILIAR FUNDADOR%' then 2
            when upper(c) like '%VITALICIO%' and upper(c) like '%SOCIO%' then 3
            when upper(c) like '%VITALICIO%' then 4
            when upper(c) like '%SOCIO FAMILIAR%' then 5
            when upper(c) like '%GRUPO FAMILIAR%' then 6
            when upper(c) like '%SOCIO INDIVIDUAL%' or upper(c) ~ '^SOCIO\b' then 7
            when upper(c) = 'TURF' then 8
            when upper(c) like '%ABONO%' then 9
            else 50
          end,
          c
        limit 1
      ),
      (
        select c
        from jsonb_array_elements_text(coalesce(m2.meta->'cuotaCategories', '[]'::jsonb)) as t(c)
        order by c
        limit 1
      ),
      'SOCIO INDIVIDUAL'
    ) as cat
  from public.members m2
  where coalesce(m2.meta->>'source', '') = 'datita'
) picked
where m.id = picked.id;

update public.member_adherents a
set tier = m.tier
from public.members m
where a.member_id = m.id
  and coalesce(m.meta->>'source', '') = 'datita';

-- Catálogo de categorías en app_settings
insert into public.app_settings (key, value, updated_at)
values (
  'member_tiers',
  '[
    {"id":"fundador","name":"FUNDADOR","label":"2266","monthlyDues":0,"color":"#a78bfa","sortOrder":1,"isActive":true},
    {"id":"grupo_familiar_fundador","name":"GRUPO FAMILIAR FUNDADOR","label":"2267","monthlyDues":0,"color":"#8b5cf6","sortOrder":2,"isActive":true},
    {"id":"socio_vitalicio","name":"SOCIO (Vitalicio)","label":"2295","monthlyDues":0,"color":"#6366f1","sortOrder":3,"isActive":true},
    {"id":"grupo_familiar_vitalicio","name":"GRUPO FAMILIAR (Vitalicio)","label":"2294","monthlyDues":0,"color":"#818cf8","sortOrder":4,"isActive":true},
    {"id":"socio_familiar","name":"SOCIO FAMILIAR","label":"2268","monthlyDues":0,"color":"#cfa13a","sortOrder":5,"isActive":true},
    {"id":"socio_familiar_amet","name":"SOCIO FAMILIAR (AMET)","label":"6146","monthlyDues":0,"color":"#d4a574","sortOrder":6,"isActive":true},
    {"id":"grupo_familiar_familiar","name":"GRUPO FAMILIAR (Familiar)","label":"2269","monthlyDues":0,"color":"#f59e0b","sortOrder":7,"isActive":true},
    {"id":"grupo_familiar_amet","name":"GRUPO FAMILIAR (AMET)","label":"6147","monthlyDues":0,"color":"#fbbf24","sortOrder":8,"isActive":true},
    {"id":"socio_individual","name":"SOCIO INDIVIDUAL","label":"2270","monthlyDues":0,"color":"#10b981","sortOrder":9,"isActive":true},
    {"id":"socio_individual_amet","name":"SOCIO INDIVIDUAL (AMET)","label":"6149","monthlyDues":0,"color":"#34d399","sortOrder":10,"isActive":true},
    {"id":"turf","name":"TURF","label":"3523","monthlyDues":0,"color":"#3b82f6","sortOrder":11,"isActive":true},
    {"id":"abono_tenis","name":"ABONO TENIS","label":"2394","monthlyDues":0,"color":"#06b6d4","sortOrder":12,"isActive":true},
    {"id":"comision","name":"COMISION","label":"—","monthlyDues":0,"color":"#94a3b8","sortOrder":90,"isActive":true},
    {"id":"interes_por_transaccion_25_grupo_familiar_amet","name":"INTERES POR TRANSACCIÓN 2,5% GRUPO FAMILIAR (AMET)","label":"6148","monthlyDues":0,"color":"#64748b","sortOrder":91,"isActive":true},
    {"id":"interes_por_transaccion_25_socio_individual_amet","name":"INTERES POR TRANSACCIÓN 2,5% SOCIO INDIVIDUAL (AMET)","label":"6150","monthlyDues":0,"color":"#64748b","sortOrder":92,"isActive":true}
  ]'::jsonb,
  now()
)
on conflict (key) do update
set value = excluded.value, updated_at = now();

drop function if exists public._datita_slug_tier(text);
