-- Copia aislada del esquema real (solo DDL). Sin datos de producción.
-- registrar_cobro incluye el bloque de anticipo vigente en producción
-- (ancla v_old de 20261123013000, verificada con position() sobre
-- pg_get_functiondef de producción). La migración lo parchea acá, no en prod.

create extension if not exists pgcrypto;

do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;

do $$ begin
  create role service_role nologin;
exception when duplicate_object then null;
end $$;

create schema if not exists auth;
create schema if not exists app_private;

create or replace function auth.uid()
returns uuid language sql stable as $$ select '11111111-1111-1111-1111-111111111111'::uuid $$;

do $$ begin
  create type public.member_status as enum ('active', 'suspended', 'inactive', 'pending');
exception when duplicate_object then null;
end $$;

create table if not exists public.members (
  id uuid primary key,
  member_number text,
  full_name text,
  tier text default 'socio_individual',
  status public.member_status default 'active',
  outstanding_balance numeric(14,2) default 0,
  meta jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.member_payments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id),
  amount numeric(14,2) not null,
  paid_at date,
  method text,
  concept text,
  period_label text,
  receipt_number text,
  journal_entry_id uuid,
  recorded_by uuid,
  meta jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  idempotency_key text
);

create unique index if not exists member_payments_member_idempotency_uidx
  on public.member_payments (member_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.dues_imputations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid,
  member_id uuid,
  due_on date,
  capital numeric(14,2) default 0,
  surcharge numeric(14,2) default 0,
  capital_open numeric(14,2) default 0,
  surcharge_open numeric(14,2) default 0,
  late_base_taken numeric(14,2) default 0,
  voided_at timestamptz,
  created_at timestamptz default now(),
  kind text default 'cobro'
);

create table if not exists public.member_dues_entries (
  id uuid primary key default gen_random_uuid(),
  member_id uuid,
  amount numeric(14,2),
  kind text,
  source text,
  created_at timestamptz default now()
);

create table if not exists public.member_dues_periods (
  member_id uuid not null,
  due_on date not null,
  capital numeric(14,2) default 0,
  capital_open numeric(14,2) default 0,
  late_base numeric(14,2) default 0,
  primary key (member_id, due_on)
);

create table if not exists public.fee_ledger_lines (
  id text primary key,
  account_id text,
  member_number text,
  pending numeric,
  collected numeric,
  line_date date
);

create or replace function public.club_today()
returns date language sql stable as $$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date
$$;

create or replace function public.cobro_current_month_due(p_today date default null)
returns date language sql stable as $$
  select (date_trunc('month', coalesce(p_today, public.club_today()))::date + 9)
$$;

create or replace function public.member_is_dues_exempt(p public.members)
returns boolean language sql stable as $$
  select coalesce(p.tier, '') ~* '(vitalicio|fundador|^comision$)'
$$;

create or replace function public.member_is_amet_dues(p public.members)
returns boolean language sql stable as $$
  select coalesce(p.tier, '') ~* '(socio_familiar_amet|socio_individual_amet)'
$$;

create or replace function public.has_capability(cap text)
returns boolean language sql stable as $$ select true $$;

create or replace function public.user_has_role(role text)
returns boolean language sql stable as $$ select true $$;

create or replace function public.dues_method_skips_surcharge(method text)
returns boolean language sql immutable as $$
  select coalesce(method, '') in ('debito', 'debito_automatico', 'galicia')
$$;

-- Disparadores de producción (cuerpos no-op: el test afirma que la migración no los toca).
create or replace function public.sync_lila_parts_after_imputations()
returns trigger language plpgsql as $$ begin return coalesce(new, old); end $$;
create or replace function public.sync_dues_open_snapshot()
returns trigger language plpgsql as $$ begin return coalesce(new, old); end $$;
create or replace function public.member_payments_stamp_tenis_scope()
returns trigger language plpgsql as $$ begin return new; end $$;
create or replace function public.member_payment_posts_dues()
returns trigger language plpgsql as $$ begin return new; end $$;
create or replace function public.member_payments_idempotency_key()
returns trigger language plpgsql as $$ begin return new; end $$;
create or replace function public.reject_waived_surcharge()
returns trigger language plpgsql as $$ begin return new; end $$;
create or replace function app_private.sync_member_dates_from_receipt()
returns trigger language plpgsql as $$ begin return new; end $$;
create or replace function public.members_set_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create or replace function public.keep_member_dues_balance()
returns trigger language plpgsql as $$ begin return new; end $$;
create or replace function public.preserve_verified_member_tenure()
returns trigger language plpgsql as $$ begin return new; end $$;
create or replace function public.reject_member_privileged_columns()
returns trigger language plpgsql as $$ begin return new; end $$;
create or replace function public.stash_member_card_number()
returns trigger language plpgsql as $$ begin return new; end $$;
create or replace function public.zero_exempt_member_dues()
returns trigger language plpgsql as $$ begin return new; end $$;

drop trigger if exists trg_sync_lila_parts_after_imputations on public.dues_imputations;
create trigger trg_sync_lila_parts_after_imputations
  after insert or update or delete on public.dues_imputations
  for each row execute function public.sync_lila_parts_after_imputations();

drop trigger if exists trg_sync_dues_open_snapshot on public.member_dues_periods;
create trigger trg_sync_dues_open_snapshot
  after insert or update or delete on public.member_dues_periods
  for each row execute function public.sync_dues_open_snapshot();

drop trigger if exists member_payments_stamp_tenis_scope on public.member_payments;
create trigger member_payments_stamp_tenis_scope
  before insert or update on public.member_payments
  for each row execute function public.member_payments_stamp_tenis_scope();

drop trigger if exists trg_member_payment_posts_dues on public.member_payments;
create trigger trg_member_payment_posts_dues
  after insert on public.member_payments
  for each row execute function public.member_payment_posts_dues();

drop trigger if exists trg_member_payments_idempotency_key on public.member_payments;
create trigger trg_member_payments_idempotency_key
  before insert on public.member_payments
  for each row execute function public.member_payments_idempotency_key();

drop trigger if exists trg_reject_waived_surcharge on public.member_payments;
create trigger trg_reject_waived_surcharge
  before insert or update on public.member_payments
  for each row execute function public.reject_waived_surcharge();

drop trigger if exists trg_zz_sync_member_due_dates_from_receipt on public.member_payments;
create trigger trg_zz_sync_member_due_dates_from_receipt
  after insert or update on public.member_payments
  for each row execute function app_private.sync_member_dates_from_receipt();

drop trigger if exists members_updated_at on public.members;
create trigger members_updated_at
  before update on public.members
  for each row execute function public.members_set_updated_at();

drop trigger if exists trg_member_dues_balance on public.members;
create trigger trg_member_dues_balance
  before insert or update on public.members
  for each row execute function public.keep_member_dues_balance();

drop trigger if exists trg_preserve_verified_member_tenure on public.members;
create trigger trg_preserve_verified_member_tenure
  before update on public.members
  for each row execute function public.preserve_verified_member_tenure();

drop trigger if exists trg_reject_member_privileged_columns on public.members;
create trigger trg_reject_member_privileged_columns
  before update on public.members
  for each row execute function public.reject_member_privileged_columns();

drop trigger if exists trg_stash_member_card_number on public.members;
create trigger trg_stash_member_card_number
  before insert or update on public.members
  for each row execute function public.stash_member_card_number();

drop trigger if exists trg_zero_exempt_member_dues on public.members;
create trigger trg_zero_exempt_member_dues
  before insert or update on public.members
  for each row execute function public.zero_exempt_member_dues();

-- registrar_cobro de producción (bloque de anticipo = ancla viva). El resto del
-- cuerpo llega hasta ese bloque con las mismas variables que usa el parche.
create or replace function public.registrar_cobro(
  p_member_id uuid,
  p_importe numeric,
  p_periodos jsonb default '[]'::jsonb,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer
set search_path to public
as $function$
declare
  v_member public.members%rowtype;
  v_payment public.member_payments%rowtype;
  v_discount numeric := 0;
  v_cash numeric := 0;
  v_capital_paid numeric := 0;
  v_surcharge_paid numeric := 0;
  v_adelanto boolean := false;
  v_last_due date;
  v_advance_due date;
  v_paid date;
  v_today date;
  v_existing public.member_payments%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not public.has_capability('payments.collect') and not public.user_has_role('admin') then
    raise exception 'Sin permiso para cobrar.';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing
    from public.member_payments
    where member_id = p_member_id and idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('payment', to_jsonb(v_existing), 'idempotent', true);
    end if;
  end if;

  select * into v_member from public.members where id = p_member_id;
  if not found then
    raise exception 'Socio inexistente.';
  end if;

  v_today := public.club_today();
  v_paid := v_today;

  insert into public.member_payments (member_id, amount, paid_at, method, concept, idempotency_key, meta)
  values (
    p_member_id, round(p_importe, 2), v_paid, 'efectivo', 'Cuota social', p_idempotency_key, '{}'::jsonb
  )
  returning * into v_payment;

  v_cash := round(p_importe, 2);

  -- Un descuento administrativo no es efectivo ni puede generar saldo a favor.
  if v_discount > 0 then
    v_cash := least(v_cash, greatest(0, round(p_importe - v_capital_paid - greatest(0, v_surcharge_paid - v_discount), 2)));
  end if;

  if round(v_cash, 2) > 0.01 then

    v_adelanto := true;
    select max(due_on) into v_last_due
    from public.member_dues_periods
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
    if v_advance_due > public.cobro_current_month_due(v_today) then
      v_advance_due := null;
    else
      insert into public.dues_imputations (
        payment_id, member_id, due_on, capital, surcharge,
        capital_open, surcharge_open, late_base_taken, kind
      ) values (
        v_payment.id, p_member_id, v_advance_due,
        round(v_cash, 2), 0, 0, 0, 0, 'adelanto'
      );
    end if;
    -- Si se imputó el anticipo a un período, no registrar un segundo crédito libre.
    if v_advance_due is null then
      insert into public.member_dues_entries (member_id, amount, kind, source)
      values (p_member_id, round(-v_cash, 2), 'adelanto', 'adelanto:' || v_payment.id::text);
    end if;
    update public.member_payments
    set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
      'adelanto', true,
      'advanceDueOn', v_advance_due
    )
    where id = v_payment.id;
    v_cash := 0;
  end if;

  return jsonb_build_object('payment', to_jsonb(v_payment), 'idempotent', false);
end;
$function$;
