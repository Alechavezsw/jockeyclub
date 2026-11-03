-- La policy de escritura era FOR ALL, así que también dejaba leer.
-- has_accounting_access() incluye al portero: seguía viendo todos los pagos.
-- Leer queda en payments.read o en el propio socio. Escribir no abre el listado.

drop policy if exists member_payments_write on public.member_payments;

create policy member_payments_insert on public.member_payments
  for insert
  with check (public.has_accounting_access() or public.has_admin_access());

create policy member_payments_update on public.member_payments
  for update
  using (public.has_accounting_access() or public.has_admin_access())
  with check (public.has_accounting_access() or public.has_admin_access());

create policy member_payments_delete on public.member_payments
  for delete
  using (public.has_accounting_access() or public.has_admin_access());
