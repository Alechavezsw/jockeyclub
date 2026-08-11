-- Bucket para contratos y docs de concesiones
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'concession-docs',
  'concession-docs',
  true,
  10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists concession_docs_public_read on storage.objects;
create policy concession_docs_public_read
  on storage.objects for select
  using (bucket_id = 'concession-docs');

drop policy if exists concession_docs_staff_write on storage.objects;
create policy concession_docs_staff_write
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'concession-docs'
    and public.has_staff_access()
  );

drop policy if exists concession_docs_staff_update on storage.objects;
create policy concession_docs_staff_update
  on storage.objects for update
  to authenticated
  using (bucket_id = 'concession-docs' and public.has_staff_access())
  with check (bucket_id = 'concession-docs' and public.has_staff_access());

drop policy if exists concession_docs_staff_delete on storage.objects;
create policy concession_docs_staff_delete
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'concession-docs' and public.has_staff_access());
