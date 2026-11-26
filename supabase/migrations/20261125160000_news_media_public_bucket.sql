-- Revista: fotos en bucket público. concession-docs quedó privado (contratos).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'news-media',
  'news-media',
  true,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists news_media_public_read on storage.objects;
create policy news_media_public_read
  on storage.objects for select
  using (bucket_id = 'news-media');

drop policy if exists news_media_staff_write on storage.objects;
create policy news_media_staff_write
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'news-media' and public.has_staff_access());

drop policy if exists news_media_staff_update on storage.objects;
create policy news_media_staff_update
  on storage.objects for update
  to authenticated
  using (bucket_id = 'news-media' and public.has_staff_access())
  with check (bucket_id = 'news-media' and public.has_staff_access());

drop policy if exists news_media_staff_delete on storage.objects;
create policy news_media_staff_delete
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'news-media' and public.has_staff_access());

-- Fotos viejas en concession-docs/news/ (migración / firmadas).
drop policy if exists concession_docs_news_read on storage.objects;
create policy concession_docs_news_read
  on storage.objects for select
  using (
    bucket_id = 'concession-docs'
    and name like 'news/%'
  );
