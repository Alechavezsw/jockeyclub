-- Nuevos roles: gate_operator, admin_employee, hr
alter type public.app_role add value if not exists 'gate_operator';
alter type public.app_role add value if not exists 'admin_employee';
alter type public.app_role add value if not exists 'hr';
