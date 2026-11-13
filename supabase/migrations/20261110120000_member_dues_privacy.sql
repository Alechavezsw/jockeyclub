-- Un socio logueado podía leer la deuda de todo el padrón:
-- la política de member_dues_entries era USING (true), la vista
-- member_dues_balances corre como dueña (salta RLS) y member_dues_balance(uuid)
-- es security definer con EXECUTE para authenticated.
-- Cada socio sigue viendo los movimientos de su propia ficha.
-- El personal (staff, contabilidad, cobranzas) sigue viendo el padrón.
-- Los triggers que recalculan el saldo son security definer y no necesitan
-- que authenticated ejecute member_dues_balance.

drop policy if exists member_dues_entries_read on public.member_dues_entries;

create policy member_dues_entries_read
  on public.member_dues_entries
  for select
  to authenticated
  using (
    public.has_staff_access()
    or public.has_accounting_access()
    or public.has_capability('payments.read')
    or exists (
      select 1
      from public.members m
      where m.id = member_dues_entries.member_id
        and m.profile_id = auth.uid()
    )
  );

revoke insert, update, delete, truncate, references, trigger
  on public.member_dues_entries
  from public, anon, authenticated;

revoke select on public.member_dues_entries from public, anon;
grant select on public.member_dues_entries to authenticated;

revoke all on table public.member_dues_balances from public, anon, authenticated;

alter view public.member_dues_balances set (security_invoker = true);

grant select on public.member_dues_balances to authenticated;

revoke all on function public.member_dues_balance(uuid) from public, anon, authenticated;
