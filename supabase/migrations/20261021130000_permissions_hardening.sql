-- Permisos: una sola lista por capacidad en la base, y las tablas sensibles dejan de confiar
-- en «es personal».
--
-- Qué arregla:
--   1. Un administrador podía darse a sí mismo (por API) roles como contador o cajero: el
--      trigger solo bloqueaba 'admin' y 'superadmin', y solo en altas y cambios, no al borrar.
--      Ahora el administrador solo toca el rol 'teacher' (lo que hace la pestaña Profesores).
--   2. profiles.role solo lo cambia el superadmin; lo demás lo recalcula sync_profile_primary_role.
--   3. members, fee_period_closures y fee_ledger_* exigían solo has_staff_access(), o sea
--      cualquier rol de personal (hr y pool_operator incluidos). Ahora piden la capacidad real.
--   4. record_pool_canon solo validaba «es personal» y que haya caja abierta. Ahora pide
--      pool.operate y que el socio esté activo. is_pool_day_cash_open() deja de depender de
--      leer cash_sessions, que estos roles no pueden ver.
--
-- Orden: aplicar DESPUÉS de 20261021120000_pool_operator_front_desk.sql.
-- Idempotente. Aplicada en vivo (permissions_hardening).
--
-- Marcha atrás: ver el final del archivo.
--
-- Nota: la lista de capacidades de abajo es la fuente de la base. Falta espejarla en
-- src/domain/auth/roles.js (ROLE_CAPABILITIES) con un test que falle si difieren; hasta
-- entonces, cambiar un rol obliga a tocar roles.js y esta tabla a mano.

-- -----------------------------------------------------------------------------
-- 1. Capacidades por rol
-- -----------------------------------------------------------------------------
create table if not exists public.role_capabilities (
  capability text not null,
  role_key text not null,
  primary key (capability, role_key)
);

alter table public.role_capabilities enable row level security;

drop policy if exists role_capabilities_read on public.role_capabilities;
create policy role_capabilities_read on public.role_capabilities
  for select to authenticated using (true);

grant select on public.role_capabilities to authenticated;

delete from public.role_capabilities;

insert into public.role_capabilities (capability, role_key) values
  ('staff.access', 'staff'),
  ('staff.access', 'cashier'),
  ('staff.access', 'accountant'),
  ('staff.access', 'admin'),
  ('staff.access', 'superadmin'),
  ('staff.access', 'gate_operator'),
  ('staff.access', 'pool_operator'),
  ('staff.access', 'admin_employee'),
  ('staff.access', 'hr'),
  ('profiles.manage', 'superadmin'),
  ('teachers.manage', 'admin'),
  ('teachers.manage', 'superadmin'),
  ('dues.liquidate', 'superadmin'),
  ('dues.liquidate', 'accountant'),
  ('members.write', 'superadmin'),
  ('members.write', 'admin'),
  ('members.write', 'accountant'),
  ('members.write', 'cashier'),
  ('members.write', 'gate_operator'),
  ('members.write', 'admin_employee'),
  -- Pileta escribe el apto médico en la ficha; no ve la pestaña Socios.
  ('members.write', 'pool_operator'),
  ('members.write', 'staff'),
  ('pool.operate', 'superadmin'),
  ('pool.operate', 'admin'),
  ('pool.operate', 'cashier'),
  ('pool.operate', 'gate_operator'),
  ('pool.operate', 'pool_operator'),
  ('pool.operate', 'admin_employee'),
  ('pool.operate', 'staff');

create or replace function public.has_capability(p_capability text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.role_capabilities rc
    where rc.capability = p_capability
      and (
        exists (
          select 1
          from public.profile_roles pr
          where pr.profile_id = auth.uid()
            and pr.revoked_at is null
            and lower(pr.role_key) = rc.role_key
        )
        or exists (
          select 1
          from public.profiles p
          where p.id = auth.uid()
            and p.role::text = rc.role_key
        )
      )
  );
$$;

revoke all on function public.has_capability(text) from public, anon;
grant execute on function public.has_capability(text) to authenticated;

-- La lista de roles de personal deja de estar escrita a mano en la función.
create or replace function public.has_staff_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_capability('staff.access');
$$;

-- -----------------------------------------------------------------------------
-- 2. Quién puede dar y quitar roles
-- -----------------------------------------------------------------------------
create or replace function public.protect_privileged_profile_roles()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old text := null;
  v_new text := null;
begin
  -- Sin sesión de usuario (editor SQL, migraciones, scripts de alta) o con la clave de servicio.
  -- Por la API siempre hay un usuario: las políticas ya exigen has_admin_access().
  if auth.role() = 'service_role' or auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op <> 'INSERT' then v_old := lower(old.role_key); end if;
  if tg_op <> 'DELETE' then v_new := lower(new.role_key); end if;

  if public.has_capability('profiles.manage') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- El administrador solo maneja el rol de profesor (pestaña Profesores).
  if public.has_capability('teachers.manage')
     and coalesce(v_old, 'teacher') = 'teacher'
     and coalesce(v_new, 'teacher') = 'teacher' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  raise exception 'Solo un superadmin puede asignar o quitar el rol %', coalesce(v_new, v_old);
end;
$function$;

drop trigger if exists trg_protect_privileged_profile_roles on public.profile_roles;
create trigger trg_protect_privileged_profile_roles
  before insert or update or delete on public.profile_roles
  for each row
  execute function public.protect_privileged_profile_roles();

create or replace function public.protect_privileged_profile_role()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.role() = 'service_role' or auth.uid() is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.role is distinct from old.role then
    -- sync_profile_primary_role lo recalcula cuando cambian los roles, y esos cambios ya
    -- pasaron por el trigger de arriba. Un cambio directo desde la API no.
    if pg_trigger_depth() > 1 then
      return new;
    end if;
    if not public.has_capability('profiles.manage') then
      raise exception 'Solo un superadmin puede cambiar el rol principal (%).', new.role;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_protect_privileged_profile_role on public.profiles;
create trigger trg_protect_privileged_profile_role
  before update of role on public.profiles
  for each row
  execute function public.protect_privileged_profile_role();

-- -----------------------------------------------------------------------------
-- 3. Escritura en padrón, cierres de período y cuentas de cuotas
-- -----------------------------------------------------------------------------
-- Leer sigue como estaba. Borrar socios queda solo para members_write_admin (el cliente
-- nunca borra: la baja es un cambio de estado).
drop policy if exists members_write_staff on public.members;

drop policy if exists members_insert_capability on public.members;
create policy members_insert_capability
  on public.members for insert
  to authenticated
  with check ((select public.has_capability('members.write')));

drop policy if exists members_update_capability on public.members;
create policy members_update_capability
  on public.members for update
  to authenticated
  using ((select public.has_capability('members.write')))
  with check ((select public.has_capability('members.write')));

-- Liquidar el período: contador y superadmin.
drop policy if exists fee_period_closures_insert on public.fee_period_closures;
create policy fee_period_closures_insert
  on public.fee_period_closures for insert
  to authenticated
  with check (public.has_capability('dues.liquidate'));

drop policy if exists fee_period_closures_update on public.fee_period_closures;
create policy fee_period_closures_update
  on public.fee_period_closures for update
  to authenticated
  using (public.has_capability('dues.liquidate'))
  with check (public.has_capability('dues.liquidate'));

-- Cuentas de cuotas: leen contabilidad, administrador, empleado de administración y pileta
-- (mismo mostrador). Escribe quien liquida.
drop policy if exists fee_ledger_accounts_access on public.fee_ledger_accounts;
drop policy if exists fee_ledger_accounts_read on public.fee_ledger_accounts;
create policy fee_ledger_accounts_read
  on public.fee_ledger_accounts for select
  to authenticated
  using (
    public.has_accounting_access()
    or public.has_admin_access()
    or public.user_has_role('admin_employee')
    or public.user_has_role('pool_operator')
  );

drop policy if exists fee_ledger_accounts_write on public.fee_ledger_accounts;
create policy fee_ledger_accounts_write
  on public.fee_ledger_accounts for all
  to authenticated
  using (public.has_capability('dues.liquidate'))
  with check (public.has_capability('dues.liquidate'));

drop policy if exists fee_ledger_lines_access on public.fee_ledger_lines;
drop policy if exists fee_ledger_lines_read on public.fee_ledger_lines;
create policy fee_ledger_lines_read
  on public.fee_ledger_lines for select
  to authenticated
  using (
    public.has_accounting_access()
    or public.has_admin_access()
    or public.user_has_role('admin_employee')
    or public.user_has_role('pool_operator')
  );

drop policy if exists fee_ledger_lines_write on public.fee_ledger_lines;
create policy fee_ledger_lines_write
  on public.fee_ledger_lines for all
  to authenticated
  using (public.has_capability('dues.liquidate'))
  with check (public.has_capability('dues.liquidate'));

-- -----------------------------------------------------------------------------
-- 4. Pileta: permiso, estado del socio y caja del día
-- -----------------------------------------------------------------------------
-- La función original pasa a ser record_pool_canon_impl; record_pool_canon es la puerta.
do $$
begin
  if to_regprocedure('public.record_pool_canon_impl(numeric,text,uuid,date)') is null
     and to_regprocedure('public.record_pool_canon(numeric,text,uuid,date)') is not null then
    alter function public.record_pool_canon(numeric, text, uuid, date)
      rename to record_pool_canon_impl;
  end if;
end $$;

create or replace function public.record_pool_canon(
  p_amount numeric,
  p_concept text,
  p_member_id uuid,
  p_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.member_status;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not public.has_capability('pool.operate') then
    raise exception 'No tenés permiso para habilitar pileta.';
  end if;
  if p_member_id is not null then
    select m.status into v_status from public.members m where m.id = p_member_id;
    if v_status is distinct from 'active'::public.member_status then
      raise exception 'El socio no está habilitado para pileta (estado: %).', coalesce(v_status::text, 'sin ficha');
    end if;
  end if;
  return public.record_pool_canon_impl(p_amount, p_concept, p_member_id, p_date);
end;
$$;

revoke all on function public.record_pool_canon(numeric, text, uuid, date) from public, anon;
grant execute on function public.record_pool_canon(numeric, text, uuid, date) to authenticated;
revoke all on function public.record_pool_canon_impl(numeric, text, uuid, date) from public, anon, authenticated;

create or replace function public.is_pool_day_cash_open()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_capability('pool.operate')
    and exists (
      select 1
      from public.cash_sessions s
      join public.cash_registers r on r.id = s.cash_register_id
      join public.chart_of_accounts a on a.id = r.account_id
      where s.status = 'open'
        and r.is_active is true
        and (a.code = '1.1.01' or a.name = 'Caja General')
    );
$$;

revoke all on function public.is_pool_day_cash_open() from public, anon;
grant execute on function public.is_pool_day_cash_open() to authenticated;

-- -----------------------------------------------------------------------------
-- Marcha atrás (copiar y correr si algo falla; las policies viejas eran has_staff_access()):
--   drop policy members_insert_capability on public.members;
--   drop policy members_update_capability on public.members;
--   create policy members_write_staff on public.members for all
--     using ((select public.has_staff_access())) with check ((select public.has_staff_access()));
--   drop policy fee_period_closures_insert on public.fee_period_closures;
--   drop policy fee_period_closures_update on public.fee_period_closures;
--   create policy fee_period_closures_insert on public.fee_period_closures for insert
--     to authenticated with check (public.has_staff_access());
--   create policy fee_period_closures_update on public.fee_period_closures for update
--     to authenticated using (public.has_staff_access()) with check (public.has_staff_access());
--   drop policy fee_ledger_accounts_read on public.fee_ledger_accounts;
--   drop policy fee_ledger_accounts_write on public.fee_ledger_accounts;
--   drop policy fee_ledger_lines_read on public.fee_ledger_lines;
--   drop policy fee_ledger_lines_write on public.fee_ledger_lines;
--   (y volver a crear fee_ledger_accounts_access / fee_ledger_lines_access como en
--    20261002150000_fee_ledger_accounts.sql)
--   drop function public.record_pool_canon(numeric, text, uuid, date);
--   alter function public.record_pool_canon_impl(numeric, text, uuid, date) rename to record_pool_canon;
--   grant execute on function public.record_pool_canon(numeric, text, uuid, date) to authenticated;
-- -----------------------------------------------------------------------------
