-- Portería, pileta y RR.HH. entran al panel, pero no leen todo.
-- Cada tabla sensible pide la capacidad de su área.

insert into public.role_capabilities (capability, role_key) values
  ('hr.read', 'hr'),
  ('hr.read', 'staff'),
  ('hr.read', 'admin'),
  ('hr.read', 'superadmin'),
  ('payments.read', 'cashier'),
  ('payments.read', 'accountant'),
  ('payments.read', 'admin'),
  ('payments.read', 'admin_employee'),
  ('payments.read', 'superadmin'),
  ('settings.write', 'admin'),
  ('settings.write', 'superadmin')
on conflict (capability, role_key) do nothing;

drop policy if exists hr_records_access on public.employee_hr_records;
create policy hr_records_access on public.employee_hr_records
  for all
  using ((select public.has_capability('hr.read')))
  with check ((select public.has_capability('hr.read')));

drop policy if exists member_payments_select on public.member_payments;
create policy member_payments_select on public.member_payments
  for select
  using (
    (select public.has_capability('payments.read'))
    or exists (
      select 1
      from public.members m
      where m.id = member_id
        and m.profile_id = auth.uid()
    )
  );

drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings
  for all
  using ((select public.has_capability('settings.write')))
  with check ((select public.has_capability('settings.write')));

drop policy if exists group_accounts_access on public.group_accounts;
create policy group_accounts_access on public.group_accounts
  for all
  using ((select public.has_capability('payments.read')))
  with check ((select public.has_capability('payments.read')));

drop policy if exists group_account_lines_access on public.group_account_lines;
create policy group_account_lines_access on public.group_account_lines
  for all
  using ((select public.has_capability('payments.read')))
  with check ((select public.has_capability('payments.read')));

drop policy if exists pool_accesses_access on public.pool_accesses;
create policy pool_accesses_access on public.pool_accesses
  for all
  using ((select public.has_capability('pool.operate')))
  with check ((select public.has_capability('pool.operate')));
