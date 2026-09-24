-- El padrón (~5k) evaluaba has_staff_access() por cada fila.
-- Esa función hace varias lecturas de roles, así que el conteo y cada
-- página tardaban decenas de segundos. (select fn()) la corre una vez.

create or replace function public.has_staff_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profile_roles pr
    where pr.profile_id = auth.uid()
      and pr.revoked_at is null
      and lower(pr.role_key) in (
        'staff', 'cashier', 'accountant', 'admin', 'superadmin',
        'gate_operator', 'admin_employee', 'hr'
      )
  )
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in (
        'staff', 'cashier', 'accountant', 'admin', 'superadmin',
        'gate_operator', 'admin_employee', 'hr'
      )
  );
$$;

drop policy if exists members_select on public.members;
create policy members_select
  on public.members for select
  using (
    profile_id = (select auth.uid())
    or (select public.has_staff_access())
  );

drop policy if exists members_write_staff on public.members;
create policy members_write_staff
  on public.members for all
  using ((select public.has_staff_access()))
  with check ((select public.has_staff_access()));
