-- Snapshots exportados de LILA/Accessin y Societas: padrón con DNI, cuentas corrientes,
-- caja y proveedores. Antes viajaban dentro del build como src/data/seed/*.js y cualquiera
-- podía descargarlos. Ahora son JSON en un bucket privado que la app baja con la sesión
-- del usuario (src/data/snapshots.js) y que se sube con `npm run upload:snapshots`.
--
-- Lectura: los roles que ven Cuotas o Contabilidad en el panel (superadmin, admin,
-- accountant, cashier, gate_operator, admin_employee). staff, hr, teacher y member no.
-- Escritura: solo superadmin, o el service role (que no pasa por RLS).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'club-snapshots',
  'club-snapshots',
  false,
  20971520,
  array['application/json']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.has_club_snapshot_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() in (
    'superadmin', 'admin', 'accountant', 'cashier', 'gate_operator', 'admin_employee'
  )
  or public.user_has_role('superadmin')
  or public.user_has_role('admin')
  or public.user_has_role('accountant')
  or public.user_has_role('cashier')
  or public.user_has_role('gate_operator')
  or public.user_has_role('admin_employee');
$$;

revoke all on function public.has_club_snapshot_access() from public, anon;
grant execute on function public.has_club_snapshot_access() to authenticated;

drop policy if exists club_snapshots_read on storage.objects;
create policy club_snapshots_read
  on storage.objects for select
  to authenticated
  using (bucket_id = 'club-snapshots' and public.has_club_snapshot_access());

drop policy if exists club_snapshots_superadmin_insert on storage.objects;
create policy club_snapshots_superadmin_insert
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'club-snapshots' and public.user_has_role('superadmin'));

drop policy if exists club_snapshots_superadmin_update on storage.objects;
create policy club_snapshots_superadmin_update
  on storage.objects for update
  to authenticated
  using (bucket_id = 'club-snapshots' and public.user_has_role('superadmin'))
  with check (bucket_id = 'club-snapshots' and public.user_has_role('superadmin'));

drop policy if exists club_snapshots_superadmin_delete on storage.objects;
create policy club_snapshots_superadmin_delete
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'club-snapshots' and public.user_has_role('superadmin'));
