-- Hotfix PR #13 (seguridad contable): validar dueOns en registrar_cobro.
-- - Respeta meta.adminOperationalClear / adminOperationalClears (exigible ≠ capital_open).
-- - adelanto=true NO saltea la protección (no reabre pagos/clear/reg).
-- - Backup + rollback ejecutable; inyección idempotente sobre ancla productiva.
-- NO aplicar en producción sin autorización explícita.

begin;

-- ---------------------------------------------------------------------------
-- 0) Respaldo de registrar_cobro (para rollback)
-- ---------------------------------------------------------------------------
create table if not exists public.schema_object_backups (
  id bigserial primary key,
  migration_id text not null,
  object_identity text not null,
  definition text not null,
  created_at timestamptz not null default now()
);

comment on table public.schema_object_backups is
  'Definiciones SQL respaldadas antes de parches por pg_get_functiondef.';

revoke all on table public.schema_object_backups from public, anon, authenticated;
grant select, insert on table public.schema_object_backups to service_role;
grant usage, select on sequence public.schema_object_backups_id_seq to service_role;

insert into public.schema_object_backups (migration_id, object_identity, definition)
select
  '20261122153000_registrar_cobro_reject_ineligible_due_ons',
  'public.registrar_cobro(uuid, numeric, jsonb, text)',
  pg_get_functiondef('public.registrar_cobro(uuid, numeric, jsonb, text)'::regprocedure)
where not exists (
  select 1
  from public.schema_object_backups b
  where b.migration_id = '20261122153000_registrar_cobro_reject_ineligible_due_ons'
    and b.object_identity = 'public.registrar_cobro(uuid, numeric, jsonb, text)'
);

-- ---------------------------------------------------------------------------
-- 1) Helpers: clears admin desde meta persistido (no confiar en el cliente)
-- ---------------------------------------------------------------------------
create or replace function public.cobro_admin_clear_rows(p_meta jsonb)
returns table (
  clear_key text,
  amount numeric,
  due_on date,
  through_due date,
  period_due_ons text[]
)
language sql
stable
security definer
set search_path = public
as $$
  with raw as (
    select m.meta->'adminOperationalClear' as item
    from (select p_meta as meta) m
    where m.meta ? 'adminOperationalClear'
      and jsonb_typeof(m.meta->'adminOperationalClear') = 'object'
    union all
    select value
    from jsonb_array_elements(coalesce(p_meta->'adminOperationalClears', '[]'::jsonb)) value
    where jsonb_typeof(value) = 'object'
  ),
  parsed as (
    select
      coalesce(
        nullif(btrim(item->>'id'), ''),
        nullif(btrim(item->>'clearId'), ''),
        md5(item::text)
      ) as clear_key,
      round(coalesce(nullif(item->>'amount', '')::numeric, nullif(item->>'maxAmount', '')::numeric, 0), 2) as amount,
      nullif(left(coalesce(item->>'dueOn', item->>'due_on', ''), 10), '')::date as due_on,
      nullif(left(coalesce(item->>'throughDueOn', item->>'through', ''), 10), '')::date as through_due,
      coalesce(
        (
          select array_agg(distinct left(x, 10))
          from (
            select jsonb_array_elements_text(coalesce(item->'periodDueOns', '[]'::jsonb)) as x
          ) s
          where left(x, 10) ~ '^\d{4}-\d{2}-\d{2}$'
        ),
        '{}'::text[]
      ) as period_due_ons
    from raw
  )
  select clear_key, amount, due_on, through_due, period_due_ons
  from parsed
  where amount > 0.01
    and (due_on is not null or through_due is not null or cardinality(period_due_ons) > 0);
$$;

-- Solo uso interno vía registrar_cobro (owner) / service_role. No authenticated.
revoke all on function public.cobro_admin_clear_rows(jsonb) from public, anon, authenticated;
grant execute on function public.cobro_admin_clear_rows(jsonb) to service_role;

create or replace function public.cobro_clear_covers_due(
  p_due date,
  p_clear_due date,
  p_through date,
  p_period_due_ons text[]
)
returns boolean
language sql
immutable
as $$
  select
    p_due is not null
    and p_due > date '1900-01-10'
    and (
      (p_clear_due is not null and p_clear_due = p_due)
      or (p_through is not null and p_due <= p_through)
      or (p_period_due_ons is not null and to_char(p_due, 'YYYY-MM-DD') = any (p_period_due_ons))
    );
$$;

revoke all on function public.cobro_clear_covers_due(date, date, date, text[]) from public, anon, authenticated;
grant execute on function public.cobro_clear_covers_due(date, date, date, text[]) to service_role;

-- Capital abierto menos clears admin (presupuesto por clear_key).
-- Retorna { uncovered numeric, budget jsonb }.
create or replace function public.cobro_due_uncovered_capital(
  p_member_id uuid,
  p_due date,
  p_clear_budget jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_open numeric := 0;
  v_meta jsonb;
  v_row record;
  v_left numeric;
  v_take numeric;
  v_rem numeric;
  v_budget jsonb := coalesce(p_clear_budget, '{}'::jsonb);
  v_found boolean := false;
begin
  if p_member_id is null or p_due is null or p_due <= date '1900-01-10' then
    return jsonb_build_object('uncovered', 0, 'budget', v_budget);
  end if;

  select coalesce(capital_open, 0)
    into v_open
  from public.member_dues_periods
  where member_id = p_member_id
    and due_on = p_due;
  v_found := found;

  if not v_found then
    return jsonb_build_object('uncovered', 0, 'budget', v_budget);
  end if;
  v_open := round(greatest(v_open, 0), 2);
  if v_open <= 0.01 then
    return jsonb_build_object('uncovered', 0, 'budget', v_budget);
  end if;

  select coalesce(meta, '{}'::jsonb) into v_meta
  from public.members
  where id = p_member_id;

  v_rem := v_open;
  for v_row in
    select *
    from public.cobro_admin_clear_rows(v_meta)
    order by clear_key
  loop
    exit when v_rem <= 0.01;
    if not public.cobro_clear_covers_due(p_due, v_row.due_on, v_row.through_due, v_row.period_due_ons) then
      continue;
    end if;
    v_left := round(coalesce(nullif(v_budget->>v_row.clear_key, '')::numeric, v_row.amount), 2);
    if v_left <= 0.01 then
      continue;
    end if;
    v_take := least(v_rem, v_left);
    v_rem := round(v_rem - v_take, 2);
    v_budget := jsonb_set(
      v_budget,
      array[v_row.clear_key],
      to_jsonb(round(v_left - v_take, 2)),
      true
    );
  end loop;

  return jsonb_build_object(
    'uncovered', round(greatest(v_rem, 0), 2),
    'budget', v_budget
  );
end;
$$;

revoke all on function public.cobro_due_uncovered_capital(uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.cobro_due_uncovered_capital(uuid, date, jsonb) to service_role;

-- Evidencia de cobro (imputación o periodDueOns). No implica “saldo cerrado”:
-- si capital_open > 0 el remanente sigue cobrable.
create or replace function public.cobro_due_has_payment_evidence(p_member_id uuid, p_due date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.dues_imputations i
    join public.member_payments p on p.id = i.payment_id
    where i.member_id = p_member_id
      and i.due_on = p_due
      and i.voided_at is null
      and coalesce(i.capital, 0) > 0.01
      and coalesce(p.meta->>'status', 'paid') not in ('void', 'cancelled')
  )
  or exists (
    select 1
    from public.member_payments p
    where p.member_id = p_member_id
      and coalesce(p.meta->>'status', 'paid') not in ('void', 'cancelled')
      and (
        p.meta->'periodDueOns' @> to_jsonb(array[to_char(p_due, 'YYYY-MM-DD')])
        or exists (
          select 1
          from jsonb_array_elements(coalesce(p.meta->'periodDueOns', '[]'::jsonb)) e
          where left(coalesce(e->>'dueOn', e->>'date', trim(both '"' from e::text)), 10)
            = to_char(p_due, 'YYYY-MM-DD')
        )
      )
  );
$$;

revoke all on function public.cobro_due_has_payment_evidence(uuid, date) from public, anon, authenticated;
grant execute on function public.cobro_due_has_payment_evidence(uuid, date) to service_role;

-- Alias de compatibilidad: “totalmente saldado” = sin capital_open y con evidencia de pago.
create or replace function public.cobro_due_already_paid(p_member_id uuid, p_due date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.cobro_due_has_payment_evidence(p_member_id, p_due)
    and not exists (
      select 1
      from public.member_dues_periods dp
      where dp.member_id = p_member_id
        and dp.due_on = p_due
        and coalesce(dp.capital_open, 0) > 0.01
    );
$$;

revoke all on function public.cobro_due_already_paid(uuid, date) from public, anon, authenticated;
grant execute on function public.cobro_due_already_paid(uuid, date) to service_role;

-- ---------------------------------------------------------------------------
-- 2) Assert principal: sin bypass por adelanto ni dueOns vacíos
-- ---------------------------------------------------------------------------
drop function if exists public.cobro_assert_due_ons_collectable(uuid, jsonb, boolean);

create or replace function public.cobro_assert_due_ons_collectable(
  p_member_id uuid,
  p_due_ons jsonb,
  p_periodos jsonb default '{}'::jsonb,
  p_importe numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_due date;
  v_due_text text;
  v_open numeric;
  v_uncovered numeric;
  v_sched_cap numeric;
  v_clear_budget jsonb := '{}'::jsonb;
  v_unc jsonb;
  v_meta jsonb;
  v_has_open_row boolean;
  v_other_open int;
  v_sum_uncovered numeric := 0;
  v_sum_sched numeric := 0;
  v_adelanto boolean := false;
  v_clear_covers boolean;
  v_effective jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_imputed numeric;
  v_allow_unallocated boolean := false;
  v_uncovered_open int := 0;
begin
  if p_member_id is null then
    return;
  end if;

  -- Nunca confiar en concept/concepto/chargeScope del cliente para saltear controles.
  -- Solo modos explícitos de servidor (método / paymentMode / kind) habilitan cobro
  -- sin períodos cuando no hay deuda exigible abierta.
  v_adelanto := lower(coalesce(p_periodos->>'adelanto', '')) in ('true', 't', '1');
  v_allow_unallocated :=
    lower(coalesce(p_periodos->>'method', p_periodos->>'medio', '')) in ('a_cuenta', 'on_account')
    or lower(coalesce(p_periodos->>'paymentMode', '')) in (
      'a_cuenta', 'on_account', 'unallocated', 'unallocated_credit'
    )
    or lower(coalesce(p_periodos->>'kind', '')) in (
      'pago_a_cuenta', 'a_cuenta', 'on_account'
    );

  select coalesce(meta, '{}'::jsonb) into v_meta
  from public.members
  where id = p_member_id;

  -- Períodos efectivos: dueOns → schedule → filas abiertas con capital_open > 0.
  if jsonb_typeof(p_due_ons) = 'array' and jsonb_array_length(p_due_ons) > 0 then
    v_effective := p_due_ons;
  elsif jsonb_typeof(coalesce(p_periodos->'schedule', 'null'::jsonb)) = 'array'
        and jsonb_array_length(p_periodos->'schedule') > 0 then
    select coalesce(jsonb_agg(to_jsonb(left(coalesce(s.value->>'dueOn', ''), 10))), '[]'::jsonb)
      into v_effective
    from jsonb_array_elements(p_periodos->'schedule') s
    where length(left(coalesce(s.value->>'dueOn', ''), 10)) = 10;
  else
    select coalesce(
      jsonb_agg(to_jsonb(to_char(dp.due_on, 'YYYY-MM-DD')) order by dp.due_on),
      '[]'::jsonb
    )
      into v_effective
    from public.member_dues_periods dp
    where dp.member_id = p_member_id
      and coalesce(dp.capital_open, 0) > 0.01
      and dp.due_on > date '1900-01-10';
  end if;

  if jsonb_typeof(v_effective) is distinct from 'array'
     or jsonb_array_length(v_effective) = 0 then
    if v_adelanto then
      raise exception
        'Anticipo ambiguo: indique dueOns o schedule del período a adelantar.';
    end if;

    if round(coalesce(p_importe, 0), 2) > 0.01 then
      if not v_allow_unallocated then
        raise exception
          'Cobro ambiguo: indique dueOns o schedule. El concepto no autoriza omitir períodos.';
      end if;
      -- Pago a cuenta sin períodos: solo si no hay capital exigible abierto.
      select count(*)::int
        into v_uncovered_open
      from public.member_dues_periods dp
      where dp.member_id = p_member_id
        and coalesce(dp.capital_open, 0) > 0.01
        and dp.due_on > date '1900-01-10'
        and coalesce((
          public.cobro_due_uncovered_capital(p_member_id, dp.due_on, '{}'::jsonb)
            ->>'uncovered'
        )::numeric, 0) > 0.01;
      if coalesce(v_uncovered_open, 0) > 0 then
        raise exception
          'Hay deuda exigible abierta; indique dueOns o schedule para imputar el cobro.';
      end if;
    end if;
    return;
  end if;

  for v_item in select value from jsonb_array_elements(v_effective)
  loop
    begin
      v_due_text := left(coalesce(
        v_item->>'dueOn',
        v_item->>'date',
        trim(both '"' from v_item::text)
      ), 10);
      v_due := v_due_text::date;
    exception when others then
      raise exception 'Período de cobro inválido.';
    end;

    if v_due <= date '1900-01-10' then
      continue;
    end if;
    if v_due_text = any (v_seen) then
      continue;
    end if;
    v_seen := array_append(v_seen, v_due_text);

    select coalesce(capital_open, 0)
      into v_open
    from public.member_dues_periods
    where member_id = p_member_id
      and due_on = v_due;
    v_has_open_row := found;
    v_open := round(coalesce(v_open, 0), 2);

    -- Totalmente saldado (evidencia + sin remanente): rechazar.
    if public.cobro_due_already_paid(p_member_id, v_due) then
      raise exception
        'Ese período ya está pago y no se puede volver a cobrar.';
    end if;

    -- Clear admin que cubre el due aunque no haya fila abierta.
    select exists (
      select 1
      from public.cobro_admin_clear_rows(v_meta) c
      where public.cobro_clear_covers_due(v_due, c.due_on, c.through_due, c.period_due_ons)
    ) into v_clear_covers;

    if v_has_open_row then
      if v_open <= 0.01 then
        raise exception
          'Ese período ya está pago o cerrado y no se puede volver a cobrar.';
      end if;

      v_unc := public.cobro_due_uncovered_capital(p_member_id, v_due, v_clear_budget);
      v_uncovered := round(coalesce((v_unc->>'uncovered')::numeric, 0), 2);
      v_clear_budget := coalesce(v_unc->'budget', v_clear_budget);
      if v_uncovered <= 0.01 then
        raise exception
          'Ese período está autorizado en cero operativo y no se puede cobrar.';
      end if;

      -- Capital ya imputado: el schedule no puede pedir más que remanente (ni la cuota entera).
      select round(coalesce(sum(coalesce(i.capital, 0)), 0), 2)
        into v_imputed
      from public.dues_imputations i
      join public.member_payments p on p.id = i.payment_id
      where i.member_id = p_member_id
        and i.due_on = v_due
        and i.voided_at is null
        and coalesce(p.meta->>'status', 'paid') not in ('void', 'cancelled');

      v_sched_cap := round(coalesce((
        select sum(round(coalesce(nullif(s.value->>'capital', '')::numeric, 0), 2))
        from jsonb_array_elements(coalesce(p_periodos->'schedule', '[]'::jsonb)) s
        where left(coalesce(s.value->>'dueOn', ''), 10) = v_due_text
      ), 0), 2);

      if v_sched_cap > v_uncovered + 0.01 then
        raise exception
          'El capital pedido (%) supera el exigible (%) del período.',
          v_sched_cap, v_uncovered;
      end if;
      -- Defensa extra: si piden capital >= (open + ya imputado) = cuota completa tras parcial → no.
      if v_imputed > 0.01
         and v_sched_cap > 0.01
         and v_sched_cap > v_open + 0.01 then
        raise exception
          'El capital pedido (%) supera el remanente abierto (%) del período.',
          v_sched_cap, v_open;
      end if;

      v_sum_uncovered := round(v_sum_uncovered + v_uncovered, 2);
      if v_sched_cap > 0.01 then
        v_sum_sched := round(v_sum_sched + v_sched_cap, 2);
      else
        v_sum_sched := round(v_sum_sched + v_uncovered, 2);
      end if;
    else
      -- Sin fila abierta: solo adelanto de mes nuevo (no clear, no pago, no sustituir).
      if v_clear_covers then
        raise exception
          'Ese período está autorizado en cero operativo y no se puede cobrar.';
      end if;
      if public.cobro_due_has_payment_evidence(p_member_id, v_due) then
        raise exception
          'Ese período ya está pago y no se puede volver a cobrar.';
      end if;

      select count(*)::int
        into v_other_open
      from public.member_dues_periods dp
      where dp.member_id = p_member_id
        and dp.capital_open > 0.01
        and dp.due_on > date '1900-01-10'
        and dp.due_on is distinct from v_due
        and coalesce((
          public.cobro_due_uncovered_capital(p_member_id, dp.due_on, '{}'::jsonb)
            ->>'uncovered'
        )::numeric, 0) > 0.01;

      if coalesce(v_other_open, 0) > 0 and not v_adelanto then
        raise exception
          'Ese período no es cobrable en este momento. No se sustituye por otro mes.';
      end if;
      if coalesce(v_other_open, 0) > 0 and v_adelanto then
        raise exception
          'Hay deuda exigible abierta; no se registra adelanto de otro período.';
      end if;
    end if;
  end loop;

  -- Tope de importe: no cobrar más que el capital exigible (+10 % mora máx.).
  if v_sum_uncovered > 0.01 and p_importe is not null then
    declare
      v_allowed numeric;
    begin
      v_allowed := case
        when v_sum_sched > 0.01 then least(v_sum_sched, v_sum_uncovered)
        else v_sum_uncovered
      end;
      if round(p_importe, 2) > round(v_allowed * 1.10, 2) + 0.01 then
        raise exception
          'El importe supera el capital exigible de los períodos solicitados.';
      end if;
    end;
  end if;
end;
$$;

-- Ejecutable solo por el owner (SECURITY DEFINER callers) y service_role.
-- authenticated no puede sondear capital_open ajeno vía helpers.
-- registrar_cobro (SECURITY DEFINER, mismo owner) sigue pudiendo llamarlas.
revoke all on function public.cobro_assert_due_ons_collectable(uuid, jsonb, jsonb, numeric)
  from public, anon, authenticated;
grant execute on function public.cobro_assert_due_ons_collectable(uuid, jsonb, jsonb, numeric)
  to service_role;

comment on function public.cobro_assert_due_ons_collectable(uuid, jsonb, jsonb, numeric) is
  'Rechaza dueOns pagos/cerrados/clear; remanente parcial OK; dueOns vacío deriva schedule/abiertos; no confía en concept del cliente; adelanto no saltea.';

-- ---------------------------------------------------------------------------
-- 3) Rollback ejecutable
-- ---------------------------------------------------------------------------
create or replace function public.rollback_20261122153000_registrar_cobro_due_ons()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_def text;
begin
  select definition into v_def
  from public.schema_object_backups
  where migration_id = '20261122153000_registrar_cobro_reject_ineligible_due_ons'
    and object_identity = 'public.registrar_cobro(uuid, numeric, jsonb, text)'
  order by id desc
  limit 1;

  if v_def is null or length(v_def) < 100 then
    raise exception 'No hay backup de registrar_cobro para rollback.';
  end if;

  execute v_def;
  drop function if exists public.cobro_assert_due_ons_collectable(uuid, jsonb, jsonb, numeric);
  drop function if exists public.cobro_assert_due_ons_collectable(uuid, jsonb, boolean);
  drop function if exists public.cobro_due_uncovered_capital(uuid, date, jsonb);
  drop function if exists public.cobro_due_already_paid(uuid, date);
  drop function if exists public.cobro_due_has_payment_evidence(uuid, date);
  drop function if exists public.cobro_admin_clear_rows(jsonb);
  drop function if exists public.cobro_clear_covers_due(date, date, date, text[]);

  return 'rollback_20261122153000_ok';
end;
$$;

revoke all on function public.rollback_20261122153000_registrar_cobro_due_ons()
  from public, anon, authenticated;
grant execute on function public.rollback_20261122153000_registrar_cobro_due_ons()
  to service_role;

-- ---------------------------------------------------------------------------
-- 4) Inyección idempotente en registrar_cobro (ancla productiva verificada)
-- ---------------------------------------------------------------------------
do $inject$
declare
  v_fn text := 'public.registrar_cobro(uuid, numeric, jsonb, text)';
  v_sql text;
  v_anchor text := $a$v_adelanto := lower(coalesce(p_periodos->>'adelanto', '')) in ('true', 't', '1');$a$;
  v_call text := $c$perform public.cobro_assert_due_ons_collectable(p_member_id, v_due_ons, p_periodos, p_importe);$c$;
  v_inject text;
begin
  select pg_get_functiondef(v_fn::regprocedure) into v_sql;
  if v_sql is null then
    raise exception 'No se encontró %', v_fn;
  end if;

  -- Compatibilidad: la ancla debe existir exactamente una vez en prod.
  if position(v_anchor in v_sql) = 0 then
    raise exception
      'Ancla v_adelanto no encontrada en registrar_cobro productivo; abortando (sin cambios).';
  end if;
  if (length(v_sql) - length(replace(v_sql, v_anchor, ''))) / nullif(length(v_anchor), 0) <> 1 then
    raise exception
      'Ancla v_adelanto no es única en registrar_cobro; abortando.';
  end if;

  if position('cobro_assert_due_ons_collectable(p_member_id, v_due_ons, p_periodos, p_importe)' in v_sql) > 0 then
    raise notice 'registrar_cobro ya valida dueOns con importe/schedule';
    return;
  end if;

  -- Quitar inyección vieja (firma boolean) si existiera en algún entorno de prueba.
  v_sql := replace(
    v_sql,
    'perform public.cobro_assert_due_ons_collectable(p_member_id, v_due_ons, v_adelanto);',
    ''
  );

  v_inject := v_anchor || E'\n  ' || v_call;
  v_sql := replace(v_sql, v_anchor, v_inject);

  if position(v_call in v_sql) = 0 then
    raise exception 'No se inyectó cobro_assert_due_ons_collectable en registrar_cobro.';
  end if;

  execute v_sql;
end;
$inject$;

commit;
