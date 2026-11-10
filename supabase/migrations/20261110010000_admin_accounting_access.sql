-- Administración también opera caja y contabilidad (lectura/escritura RLS).
create or replace function public.has_accounting_access()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.current_role() in ('accountant', 'superadmin', 'admin', 'cashier', 'gate_operator')
    or public.user_has_role('accountant')
    or public.user_has_role('superadmin')
    or public.user_has_role('admin')
    or public.user_has_role('cashier')
    or public.user_has_role('gate_operator');
$function$;
