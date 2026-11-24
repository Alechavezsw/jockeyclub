-- Las fotos de las alertas viven en concession-docs/alerts/.
-- El personal ya puede escribir. Socios y visitas autenticadas pueden verlas.

drop policy if exists concession_docs_alert_read on storage.objects;
create policy concession_docs_alert_read
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'concession-docs'
    and name like 'alerts/%'
  );
