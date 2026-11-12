-- Locales reales del club: La Kelita, Paddle, Escuela Santa Teresita, Escuela Fanzolato.

insert into public.concession_spaces (id, name, area)
values
  ('space-kelita', 'La Kelita', 'Gastronomía'),
  ('space-paddle', 'Paddle', 'Deportes'),
  ('space-santa-teresita', 'Escuela Santa Teresita', 'Educación'),
  ('space-fanzolato', 'Escuela Fanzolato', 'Educación')
on conflict (id) do update
set
  name = excluded.name,
  area = excluded.area;

insert into public.concessions (
  space_id,
  name,
  concession_type,
  status,
  holder_name,
  start_date,
  end_date,
  monthly_canon,
  portal_code,
  checklist,
  documents,
  renewal_history,
  notes,
  meta
)
select
  v.space_id,
  v.name,
  v.concession_type,
  'active',
  v.holder_name,
  '2026-01-01'::date,
  '2026-12-31'::date,
  0,
  v.portal_code,
  '{}'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  'Canon mensual: se carga al cobrar (fecha, hora y quién lo registró quedan en trazabilidad y caja).',
  jsonb_build_object(
    'location', v.location,
    'noticeDays', 30,
    'revenueSharePct', 0,
    'deposit', 0,
    'autoRenew', true,
    'incomeAccountId', 'coa-4.1.04',
    'concessionaire', v.holder_name
  )
from (
  values
    ('space-kelita', 'La Kelita', 'gastronomia', 'La Kelita', 'KEL-1001', 'La Kelita · Sede Rivadavia'),
    ('space-paddle', 'Paddle', 'deportes', 'Paddle', 'PAD-1002', 'Canchas de pádel'),
    ('space-santa-teresita', 'Escuela Santa Teresita', 'otro', 'Escuela Santa Teresita', 'TER-1003', 'Escuela Santa Teresita'),
    ('space-fanzolato', 'Escuela Fanzolato', 'otro', 'Escuela Fanzolato', 'FAN-1004', 'Escuela Fanzolato')
) as v(space_id, name, concession_type, holder_name, portal_code, location)
where not exists (
  select 1
  from public.concessions c
  where lower(c.name) = lower(v.name)
     or c.portal_code = v.portal_code
);
