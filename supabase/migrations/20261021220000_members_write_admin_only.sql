-- Padrón: solo admin y superadmin escriben fichas.
-- Contador, cajero, portería, empleado de administración, pileta y personal
-- siguen leyendo; ya no tienen members.write.
--
-- Marcha atrás:
--   insert into public.role_capabilities (capability, role_key) values
--     ('members.write', 'accountant'),
--     ('members.write', 'cashier'),
--     ('members.write', 'gate_operator'),
--     ('members.write', 'admin_employee'),
--     ('members.write', 'pool_operator'),
--     ('members.write', 'staff')
--   on conflict do nothing;

delete from public.role_capabilities
where capability = 'members.write'
  and role_key in (
    'accountant',
    'cashier',
    'gate_operator',
    'admin_employee',
    'pool_operator',
    'staff'
  );
