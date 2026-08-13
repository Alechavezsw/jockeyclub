-- Socios autenticados pueden ver encuestas (abiertas y cerradas con resultados).
drop policy if exists surveys_select on public.surveys;
create policy surveys_select on public.surveys for select using (
  auth.uid() is not null
);

-- Semilla inicial de consultas colectivas visibles en Inicio.
insert into public.surveys (title, description, status, questions, meta)
select
  '¿Qué mejora de infraestructura edilicia consideras prioritaria para la Sede Rivadavia en 2026?',
  'Consulta colectiva a socios activos.',
  'open',
  '[
    {"id":"opt1","text":"Nueva cancha de Pádel techada (vidrio templado)","votes":0},
    {"id":"opt2","text":"Renovación de luces LED en Cancha Auxiliar de Rugby","votes":0},
    {"id":"opt3","text":"Ampliación de vestuarios en sector Hípico","votes":0},
    {"id":"opt4","text":"Cava de vinos de alta gama en The Pavilion","votes":0}
  ]'::jsonb,
  '{
    "question":"¿Qué mejora de infraestructura edilicia consideras prioritaria para la Sede Rivadavia en 2026?",
    "category":"Infraestructura",
    "active":true,
    "votedBy":[],
    "options":[
      {"id":"opt1","text":"Nueva cancha de Pádel techada (vidrio templado)","votes":0},
      {"id":"opt2","text":"Renovación de luces LED en Cancha Auxiliar de Rugby","votes":0},
      {"id":"opt3","text":"Ampliación de vestuarios en sector Hípico","votes":0},
      {"id":"opt4","text":"Cava de vinos de alta gama en The Pavilion","votes":0}
    ]
  }'::jsonb
where not exists (select 1 from public.surveys limit 1);

insert into public.surveys (title, description, status, questions, meta)
select
  '¿Qué disciplina o taller deportivo te gustaría incorporar al club en la próxima temporada?',
  'Consulta colectiva a socios activos.',
  'open',
  '[
    {"id":"opt1","text":"Clases formativas de Vóley de Playa (Cajón de Arena)","votes":0},
    {"id":"opt2","text":"Escuela de Equitación Infantil y Pony Club","votes":0},
    {"id":"opt3","text":"Taller de Iniciación al Yoga y Meditación Outdoor","votes":0},
    {"id":"opt4","text":"Clases intensivas de Boxeo y defensa personal","votes":0}
  ]'::jsonb,
  '{
    "question":"¿Qué disciplina o taller deportivo te gustaría incorporar al club en la próxima temporada?",
    "category":"Deportes",
    "active":true,
    "votedBy":[],
    "options":[
      {"id":"opt1","text":"Clases formativas de Vóley de Playa (Cajón de Arena)","votes":0},
      {"id":"opt2","text":"Escuela de Equitación Infantil y Pony Club","votes":0},
      {"id":"opt3","text":"Taller de Iniciación al Yoga y Meditación Outdoor","votes":0},
      {"id":"opt4","text":"Clases intensivas de Boxeo y defensa personal","votes":0}
    ]
  }'::jsonb
where (select count(*) from public.surveys) < 2;
