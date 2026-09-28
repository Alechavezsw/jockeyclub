-- El cajero/staff sube el recibo a la carpeta del SOCIO (memberId), no a la propia:
-- la política original solo dejaba subir a la carpeta de auth.uid(), lo que bloqueaba
-- el envío del recibo por Mensajería al cobrar una cuota.
drop policy if exists dues_receipts_member_insert on storage.objects;
create policy dues_receipts_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'dues-receipts'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.has_staff_access()
    )
  );

-- El socio puede leer su propio recibo aunque la carpeta sea su Nº de socio
-- (subido por staff) en vez de su auth.uid() (cuando no tiene usuario de portal).
drop policy if exists dues_receipts_read on storage.objects;
create policy dues_receipts_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'dues-receipts'
    and (
      public.has_staff_access()
      or (storage.foldername(name))[1] = auth.uid()::text
      or (storage.foldername(name))[1] in (
        select member_number from public.members where profile_id = auth.uid()
      )
    )
  );
