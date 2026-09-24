insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dues-receipts',
  'dues-receipts',
  false,
  5242880,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists dues_receipts_member_insert on storage.objects;
create policy dues_receipts_member_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'dues-receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists dues_receipts_read on storage.objects;
create policy dues_receipts_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'dues-receipts'
    and (
      public.has_staff_access()
      or (storage.foldername(name))[1] = auth.uid()::text
    )
  );
