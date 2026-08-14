-- Revista digital / CMS: asegura columnas, índices y lectura pública de publicadas.
-- Las fotos viven en storage bucket concession-docs bajo news/ (políticas staff ya existentes).

alter table public.news_posts
  add column if not exists summary text,
  add column if not exists body text,
  add column if not exists image_url text,
  add column if not exists category text,
  add column if not exists is_published boolean not null default true,
  add column if not exists event_date date,
  add column if not exists meta jsonb not null default '{}'::jsonb;

create index if not exists news_posts_published_idx
  on public.news_posts (is_published, created_at desc);

create index if not exists news_posts_category_idx
  on public.news_posts (category);

comment on column public.news_posts.meta is
  'CMS extras: dateLabel, gallery[], isEvent, image';

-- RLS: socios ven publicadas; staff ve/edita todo
alter table public.news_posts enable row level security;

drop policy if exists news_select on public.news_posts;
create policy news_select on public.news_posts
  for select
  using (is_published = true or public.has_staff_access());

drop policy if exists news_write on public.news_posts;
create policy news_write on public.news_posts
  for all
  using (public.has_staff_access())
  with check (public.has_staff_access());

-- Semilla mínima solo si la tabla está vacía
insert into public.news_posts (title, summary, body, image_url, category, is_published, meta)
select
  'Bienvenida a la Revista Digital',
  'Novedades, torneos y vida del club en un solo lugar.',
  'Desde el panel administrativo podés publicar notas con portada, galería y fotos en el texto. Los socios las ven en Revista Digital.',
  'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=1200&auto=format&fit=crop',
  'institucional',
  true,
  jsonb_build_object(
    'dateLabel', to_char(now(), 'DD Mon YYYY'),
    'gallery', '[]'::jsonb,
    'isEvent', false
  )
where not exists (select 1 from public.news_posts limit 1);
