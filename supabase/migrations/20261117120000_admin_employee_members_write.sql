-- Empleado de administración vuelve a escribir padrón (grupo familiar / fichas).
-- Marcha atrás:
--   delete from public.role_capabilities
--   where capability = 'members.write' and role_key = 'admin_employee';
--   y restaurar has_admin_access() sin admin_employee.

insert into public.role_capabilities (capability, role_key)
values ('members.write', 'admin_employee')
on conflict do nothing;

create or replace function public.has_admin_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() in ('admin', 'superadmin', 'admin_employee')
    or public.user_has_role('admin')
    or public.user_has_role('superadmin')
    or public.user_has_role('admin_employee');
$$;
