-- Operario de pileta ve lo mismo que el empleado de administración (pestañas Socios y Cuotas).
-- Padrón y reservas ya le llegan por has_staff_access(); faltaban los snapshots de LILA y las
-- cuentas contables de cuotas, que listaban a admin_employee de forma explícita.
--
-- Solo LECTURA. Escribir o imputar cuentas contables (fee_ledger_*, post_fee_ledger_lines)
-- sigue en contador, admin y empleado de administración: el operario de pileta no liquida.

create or replace function public.has_club_snapshot_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() in (
    'superadmin', 'admin', 'accountant', 'cashier', 'gate_operator', 'admin_employee', 'pool_operator'
  )
  or public.user_has_role('superadmin')
  or public.user_has_role('admin')
  or public.user_has_role('accountant')
  or public.user_has_role('cashier')
  or public.user_has_role('gate_operator')
  or public.user_has_role('admin_employee')
  or public.user_has_role('pool_operator');
$$;

revoke all on function public.has_club_snapshot_access() from public, anon;
grant execute on function public.has_club_snapshot_access() to authenticated;

drop policy if exists fee_ledger_accounts_pool_read on public.fee_ledger_accounts;
create policy fee_ledger_accounts_pool_read
  on public.fee_ledger_accounts for select
  to authenticated
  using (public.user_has_role('pool_operator'));

drop policy if exists fee_ledger_lines_pool_read on public.fee_ledger_lines;
create policy fee_ledger_lines_pool_read
  on public.fee_ledger_lines for select
  to authenticated
  using (public.user_has_role('pool_operator'));
