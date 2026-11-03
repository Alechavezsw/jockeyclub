-- El cajero registra un cobro con registrar_cobro y lo anula con motivo.
-- No inserta, edita ni borra member_payments, no actualiza socios ni saldo,
-- no carga descuentos y no lee legajos.

insert into public.role_capabilities (capability, role_key) values
  ('payments.collect', 'cashier'),
  ('payments.collect', 'accountant'),
  ('payments.collect', 'admin'),
  ('payments.collect', 'superadmin'),
  ('payments.collect', 'admin_employee'),
  ('payments.collect', 'gate_operator'),
  ('payments.collect', 'pool_operator'),
  ('payments.void', 'cashier'),
  ('payments.void', 'accountant'),
  ('payments.void', 'superadmin')
on conflict (capability, role_key) do nothing;

delete from public.role_capabilities
where capability = 'pool.operate'
  and role_key = 'cashier';

-- Cajero sin otro rol de administración. Quien también es contador o admin sigue con lo suyo.
create or replace function public.is_cashier_desk()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_has_role('cashier')
    and not public.has_admin_access()
    and not public.user_has_role('accountant')
    and not public.user_has_role('superadmin')
    and not public.has_capability('members.write')
    and public.current_role() not in ('accountant', 'superadmin', 'admin');
$$;

revoke all on function public.is_cashier_desk() from public, anon;
grant execute on function public.is_cashier_desk() to authenticated;

-- registrar_cobro: la capacidad de cobro, no la de editar el padrón.
do $$
declare
  v_sql text;
begin
  v_sql := pg_get_functiondef('public.registrar_cobro(uuid, numeric, jsonb, text)'::regprocedure);
  if position('Sin permiso para registrar el cobro.' in v_sql) = 0 then
    raise exception 'No se encontró el control de registrar_cobro';
  end if;
  v_sql := replace(
    v_sql,
    'not public.has_capability(''members.write'')',
    'not (public.has_capability(''payments.collect'') or public.has_capability(''members.write''))'
  );
  execute v_sql;
end;
$$;

drop function if exists public.revert_dues_payment(uuid);

create or replace function public.revert_dues_payment(p_payment_id uuid, p_reason text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.member_dues_entries%rowtype;
  v_balance numeric;
  v_key text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_meta jsonb;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not (
    public.has_capability('payments.void')
    or public.has_capability('members.write')
    or public.user_has_role('tesorero')
  ) then
    raise exception 'Sin permiso para anular el cobro.';
  end if;
  if char_length(v_reason) < 8 then
    raise exception 'Falta el motivo de la anulación (mínimo 8 caracteres).';
  end if;

  select meta into v_meta
  from public.member_payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'No se encontró el cobro.';
  end if;
  if coalesce(v_meta->>'status', '') = 'void' or coalesce(v_meta->>'voidedAt', '') <> '' then
    raise exception 'Ese cobro ya está anulado.';
  end if;

  update public.member_dues_periods p
  set capital_open = round(p.capital_open + i.capital, 2),
      late_base = round(p.late_base + i.late_base_taken, 2)
  from public.dues_imputations i
  where i.payment_id = p_payment_id
    and i.voided_at is null
    and p.member_id = i.member_id
    and p.due_on = i.due_on;

  update public.dues_imputations
  set voided_at = now()
  where payment_id = p_payment_id
    and voided_at is null;

  update public.member_payments
  set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
    'status', 'void',
    'voidReason', v_reason,
    'voidedAt', now(),
    'voidedBy', auth.uid()
  )
  where id = p_payment_id;

  select * into v_entry
  from public.member_dues_entries
  where source = 'payment:' || p_payment_id::text;

  if found then
    insert into public.member_dues_entries (member_id, amount, kind, source)
    values (v_entry.member_id, round(-v_entry.amount, 2), 'void', 'void:' || p_payment_id::text)
    on conflict (source) where source <> '' do nothing;

    select meta->>'idempotencyKey' into v_key
    from public.member_payments
    where id = p_payment_id;

    if coalesce(v_key, '') <> '' and exists (
      select 1 from public.member_dues_entries
      where source = 'impute:' || v_key
    ) and not exists (
      select 1 from public.member_dues_entries
      where source = 'void-impute:' || p_payment_id::text
    ) then
      insert into public.member_dues_entries (member_id, amount, kind, source)
      select member_id, round(-amount, 2), 'void', 'void-impute:' || p_payment_id::text
      from public.member_dues_entries
      where source = 'impute:' || v_key;
    end if;

    update public.members
    set updated_at = now()
    where id = v_entry.member_id
    returning outstanding_balance into v_balance;
    return coalesce(v_balance, 0);
  end if;

  select m.outstanding_balance into v_balance
  from public.member_payments p
  join public.members m on m.id = p.member_id
  where p.id = p_payment_id;
  return coalesce(v_balance, 0);
end;
$$;

revoke all on function public.revert_dues_payment(uuid, text) from public, anon;
grant execute on function public.revert_dues_payment(uuid, text) to authenticated;

-- Cobros: el cajero no escribe la tabla. El recibo entra por la RPC.
drop policy if exists member_payments_insert on public.member_payments;
drop policy if exists member_payments_update on public.member_payments;
drop policy if exists member_payments_delete on public.member_payments;

create policy member_payments_insert on public.member_payments
  for insert
  with check (
    (public.has_accounting_access() or public.has_admin_access())
    and not public.is_cashier_desk()
  );

create policy member_payments_update on public.member_payments
  for update
  using (
    (public.has_accounting_access() or public.has_admin_access())
    and not public.is_cashier_desk()
  )
  with check (
    (public.has_accounting_access() or public.has_admin_access())
    and not public.is_cashier_desk()
  );

create policy member_payments_delete on public.member_payments
  for delete
  using (
    (public.has_accounting_access() or public.has_admin_access())
    and not public.is_cashier_desk()
  );

-- Socios y saldo: el cajero lee el padrón para cobrar, no lo edita.
drop policy if exists members_update_accounting on public.members;
create policy members_update_accounting on public.members
  for update
  using (
    (public.has_accounting_access() or public.has_admin_access())
    and not public.is_cashier_desk()
  )
  with check (
    (public.has_accounting_access() or public.has_admin_access())
    and not public.is_cashier_desk()
  );

-- Descuentos: ni leer ni cargar. La escritura ya era solo superadmin.
drop policy if exists discount_rules_read on public.discount_rules;
create policy discount_rules_read on public.discount_rules
  for select
  using (public.has_accounting_access() and not public.is_cashier_desk());

drop policy if exists fixed_discounts_read on public.fixed_discounts;
create policy fixed_discounts_read on public.fixed_discounts
  for select
  using (public.has_accounting_access() and not public.is_cashier_desk());

-- Legajos: el listado de personal y su actividad no salen para el mostrador de caja.
drop policy if exists employees_select_staff on public.employees;
create policy employees_select_staff on public.employees
  for select
  using (
    profile_id = auth.uid()
    or public.has_capability('hr.read')
    or (public.has_staff_access() and not public.is_cashier_desk())
  );

drop policy if exists employee_logs_select on public.employee_activity_logs;
create policy employee_logs_select on public.employee_activity_logs
  for select
  using (
    public.has_capability('hr.read')
    or (public.has_staff_access() and not public.is_cashier_desk())
  );

-- Leer cuentas de grupo no autoriza a reescribirlas.
drop policy if exists group_accounts_access on public.group_accounts;
create policy group_accounts_select on public.group_accounts
  for select
  using ((select public.has_capability('payments.read')));

create policy group_accounts_write on public.group_accounts
  for all
  using (
    (select public.has_capability('payments.read'))
    and not public.is_cashier_desk()
  )
  with check (
    (select public.has_capability('payments.read'))
    and not public.is_cashier_desk()
  );

drop policy if exists group_account_lines_access on public.group_account_lines;
create policy group_account_lines_select on public.group_account_lines
  for select
  using ((select public.has_capability('payments.read')));

create policy group_account_lines_write on public.group_account_lines
  for all
  using (
    (select public.has_capability('payments.read'))
    and not public.is_cashier_desk()
  )
  with check (
    (select public.has_capability('payments.read'))
    and not public.is_cashier_desk()
  );
