-- Acelera el listado del padrón activo (eq status + order id + range).
create index if not exists members_status_id_idx
  on public.members (status, id);
