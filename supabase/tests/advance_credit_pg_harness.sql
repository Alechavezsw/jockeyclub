-- Harness aislado para pruebas de anticipos (no toca padrón real).
-- Se ejecuta en embedded-postgres / DB de test.

create schema if not exists advance_test;
set search_path to advance_test, public;

create table if not exists advance_test.members (
  id uuid primary key,
  tier text not null default 'socio_familiar',
  meta jsonb not null default '{}'::jsonb,
  outstanding_balance numeric not null default 0
);

create table if not exists advance_test.dues_imputations (
  id bigserial primary key,
  payment_id uuid not null,
  member_id uuid not null references advance_test.members(id),
  due_on date not null,
  capital numeric not null default 0,
  surcharge numeric not null default 0,
  capital_open numeric not null default 0,
  surcharge_open numeric not null default 0,
  late_base_taken numeric not null default 0,
  kind text not null default 'adelanto',
  voided_at timestamptz
);

create table if not exists advance_test.member_dues_entries (
  id bigserial primary key,
  member_id uuid not null references advance_test.members(id),
  amount numeric not null,
  kind text not null,
  source text
);

create table if not exists advance_test.member_dues_periods (
  member_id uuid not null references advance_test.members(id),
  due_on date not null,
  capital numeric not null default 0,
  primary key (member_id, due_on)
);

create or replace function advance_test.member_is_dues_exempt(m advance_test.members)
returns boolean
language sql stable as $$
  select lower(coalesce(m.tier, '')) ~ '(vitalicio|fundador|comision|comisión)';
$$;

create or replace function advance_test.member_is_amet_dues(m advance_test.members)
returns boolean
language sql stable as $$
  select lower(coalesce(m.tier, '')) like '%amet%';
$$;

create or replace function advance_test.cobro_social_meta_numeric(p_meta jsonb, p_key text)
returns numeric
language plpgsql stable as $$
declare
  v_raw text := nullif(trim(coalesce(p_meta ->> p_key, '')), '');
  v_num numeric;
begin
  if v_raw is null then return null; end if;
  if v_raw !~ '^[0-9]+([.][0-9]+)?$' then return null; end if;
  begin
    v_num := v_raw::numeric;
  exception when others then
    return null;
  end;
  if v_num is null or v_num <= 0.01 then return null; end if;
  return round(v_num, 2);
end;
$$;

create or replace function advance_test.cobro_social_catalog_tariff(p_member advance_test.members)
returns numeric
language plpgsql stable as $$
declare
  v_tier text := lower(coalesce(p_member.tier, ''));
  v_meta numeric;
begin
  if advance_test.member_is_dues_exempt(p_member) then return 0; end if;
  v_meta := advance_test.cobro_social_meta_numeric(p_member.meta, 'duesAmount');
  if v_meta is not null then return v_meta; end if;
  v_meta := advance_test.cobro_social_meta_numeric(p_member.meta, 'monthlyDues');
  if v_meta is not null then return v_meta; end if;
  v_meta := advance_test.cobro_social_meta_numeric(p_member.meta, 'socialQuota');
  if v_meta is not null then return v_meta; end if;
  if advance_test.member_is_amet_dues(p_member) then
    if v_tier like '%individual%' then return 39000; end if;
    return 68250;
  end if;
  if v_tier like '%individual%' then return 40000; end if;
  if v_tier ~ '(familiar|grupo)' then return 70000; end if;
  return 70000;
end;
$$;

create or replace function advance_test.cobro_social_advance_tariff(
  p_member advance_test.members,
  p_due date default null,
  p_schedule jsonb default '[]'::jsonb
)
returns numeric
language plpgsql stable as $$
declare
  v_due date := coalesce(p_due, date '2026-12-10');
  v_catalog numeric := advance_test.cobro_social_catalog_tariff(p_member);
  v_from_sched numeric := 0;
begin
  if coalesce(v_catalog, 0) <= 0.01 then return 0; end if;

  select round(coalesce(sum((value->>'capital')::numeric), 0), 2)
    into v_from_sched
  from jsonb_array_elements(
    case when jsonb_typeof(coalesce(p_schedule, '[]'::jsonb)) = 'array' then p_schedule
         else '[]'::jsonb end
  ) as t(value)
  where left(coalesce(value->>'dueOn', ''), 10) = to_char(v_due, 'YYYY-MM-DD')
    and coalesce((value->>'capital')::numeric, 0) > 0
    and coalesce(value->>'tierId', value->>'tier', value->>'chargeScope', '')
      !~* 'abono_tenis|tenis|addon';

  if coalesce(v_from_sched, 0) > 0.01 then
    if abs(v_from_sched - v_catalog) <= 0.02 then return v_catalog; end if;
    if abs(v_from_sched - (v_catalog + 12000)) <= 0.02 then return v_catalog; end if;
  end if;

  return v_catalog;
end;
$$;

-- Imputa adelanto con lock por socio (concurrencia real).
create or replace function advance_test.allocate_advance(
  p_member_id uuid,
  p_payment_id uuid,
  p_cash numeric,
  p_start_due date,
  p_schedule jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_member advance_test.members;
  v_cash numeric := round(coalesce(p_cash, 0), 2);
  v_due date := p_start_due;
  v_tariff numeric;
  v_take numeric;
  v_loops int := 0;
  v_due_day int := 10;
  v_last date := null;
  v_advances jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(87001126, hashtext(p_member_id::text));

  select * into v_member from advance_test.members where id = p_member_id for update;
  if not found then
    raise exception 'member missing';
  end if;

  if advance_test.member_is_amet_dues(v_member) then
    v_due_day := 18;
  end if;

  while round(v_cash, 2) > 0.01 and v_loops < 24 loop
    v_loops := v_loops + 1;
    if v_due is null or v_due <= date '1900-01-10' then exit; end if;

    v_tariff := advance_test.cobro_social_advance_tariff(v_member, v_due, p_schedule);
    if v_tariff <= 0.01 then exit; end if;

    select coalesce(sum(i.capital), 0) into v_take
    from advance_test.dues_imputations i
    where i.member_id = p_member_id
      and i.due_on = v_due
      and i.voided_at is null
      and coalesce(i.kind, 'cobro') in ('cobro', 'adelanto');

    if v_take + 0.01 >= v_tariff then
      v_due := (date_trunc('month', v_due) + interval '1 month')::date + (v_due_day - 1);
      continue;
    end if;

    if round(v_cash, 2) + 0.01 < round(v_tariff - v_take, 2) then
      exit;
    end if;

    v_take := round(v_tariff - v_take, 2);
    insert into advance_test.dues_imputations (
      payment_id, member_id, due_on, capital, surcharge, kind
    ) values (
      p_payment_id, p_member_id, v_due, v_take, 0, 'adelanto'
    );
    v_advances := v_advances || jsonb_build_array(jsonb_build_object(
      'dueOn', v_due, 'capital', v_take, 'surcharge', 0
    ));
    v_last := v_due;
    v_cash := round(v_cash - v_take, 2);
    v_due := (date_trunc('month', v_due) + interval '1 month')::date + (v_due_day - 1);
  end loop;

  if round(v_cash, 2) > 0.01 then
    insert into advance_test.member_dues_entries (member_id, amount, kind, source)
    values (p_member_id, round(-v_cash, 2), 'adelanto', 'adelanto:' || p_payment_id::text);
  end if;

  return jsonb_build_object(
    'advances', v_advances,
    'freeCredit', round(greatest(v_cash, 0), 2),
    'lastAdvanceDueOn', v_last,
    'loops', v_loops
  );
end;
$$;

-- Stub de registrar_cobro con el bloque viejo (ancla prod) para probar el patch.
create or replace function advance_test.registrar_cobro_stub(
  p_member_id uuid,
  p_importe numeric,
  p_periodos jsonb,
  p_medio text
)
returns void
language plpgsql
as $$
declare
  v_discount numeric := 0;
  v_cash numeric := round(coalesce(p_importe, 0), 2);
  v_adelanto boolean := false;
  v_last_due date;
  v_advance_due date;
  v_paid date := current_date;
  v_today date := current_date;
  v_payment_id uuid := gen_random_uuid();
begin
  -- Un descuento administrativo no es efectivo ni puede generar saldo a favor.
  if v_discount > 0 then
    v_cash := least(v_cash, greatest(0, round(p_importe, 2)));
  end if;

  if round(v_cash, 2) > 0.01 then

    v_adelanto := true;
    select max(due_on) into v_last_due
    from advance_test.member_dues_periods
    where member_id = p_member_id
      and due_on > date '1900-01-10';
    if v_last_due is null then
      if extract(day from v_paid) <= 10 then
        v_advance_due := (date_trunc('month', v_paid))::date + 9;
      else
        v_advance_due := (date_trunc('month', v_paid) + interval '1 month')::date + 9;
      end if;
    else
      v_advance_due := (date_trunc('month', v_last_due) + interval '1 month')::date + 9;
    end if;
    if v_advance_due > date '2026-11-10' then
      v_advance_due := null;
    else
      insert into advance_test.dues_imputations (
        payment_id, member_id, due_on, capital, surcharge,
        capital_open, surcharge_open, late_base_taken, kind
      ) values (
        v_payment_id, p_member_id, v_advance_due,
        round(v_cash, 2), 0, 0, 0, 0, 'adelanto'
      );
    end if;
    -- Si se imputó el anticipo a un período, no registrar un segundo crédito libre.
    if v_advance_due is null then
      insert into advance_test.member_dues_entries (member_id, amount, kind, source)
      values (p_member_id, round(-v_cash, 2), 'adelanto', 'adelanto:' || v_payment_id::text);
    end if;
    v_cash := 0;
  end if;
  perform 1; -- allocate_advance_cash_chunks_v2 placeholder marker zone
end;
$$;
