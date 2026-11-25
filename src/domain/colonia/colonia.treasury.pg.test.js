/**
 * Cobro de Colonia → caja del día y asiento. Postgres descartable.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { startEmbeddedPostgres, stopEmbeddedPostgres } from '../../test/embeddedPostgresHarness.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const stripSeeds = (sql) => sql
  .replace(/insert into public\.chart_of_accounts[\s\S]*?on conflict \(code\) do update[\s\S]*?is_active = true;/, '')
  .replace(/insert into public\.role_capabilities[\s\S]*?on conflict do nothing;/g, '');

const mig1 = stripSeeds(readFileSync(join(root, 'supabase/migrations/20261124140000_colonia_verano_module.sql'), 'utf8'));
const mig2 = readFileSync(join(root, 'supabase/migrations/20261124150000_colonia_ops_hardening.sql'), 'utf8');
const mig3 = stripSeeds(readFileSync(join(root, 'supabase/migrations/20261124160000_colonia_prod_readiness.sql'), 'utf8'));
const treasurySql = readFileSync(join(root, 'supabase/migrations/20261124260000_colonia_caja_asientos.sql'), 'utf8');
const mpSql = readFileSync(join(root, 'supabase/migrations/20261124270000_colonia_mercadopago.sql'), 'utf8');

let cluster;
let databaseDir;
let pool;
let actorId;
let enrollmentId;
let sessionId;

const schemaSql = `
create extension if not exists pgcrypto;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create table if not exists public.members (
  id uuid primary key,
  member_number text unique,
  full_name text,
  outstanding_balance numeric(14,2) default 0
);
create table if not exists public.member_dues_entries (
  id uuid primary key default gen_random_uuid(), member_id uuid, amount numeric(14,2)
);
create table if not exists public.dues_imputations (
  id uuid primary key default gen_random_uuid(), member_id uuid, amount numeric(14,2)
);
create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(), member_id uuid, amount numeric(14,2)
);
create or replace function public.has_admin_access()
returns boolean language sql stable as $$
  select coalesce(current_setting('jc.is_admin', true), 'off') = 'on'
$$;
create or replace function public.has_capability(p_cap text)
returns boolean language sql stable as $$
  select coalesce(current_setting('jc.is_admin', true), 'off') = 'on'
$$;

do $$ begin
  create type public.account_type as enum ('asset', 'liability', 'equity', 'income', 'expense');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.entry_status as enum ('draft', 'posted', 'void');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.cash_session_status as enum ('open', 'closed', 'discrepancy');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key
);
create table if not exists public.fiscal_periods (
  id uuid primary key,
  name text not null,
  year integer not null,
  starts_on date not null,
  ends_on date not null,
  is_closed boolean not null default false
);
create table if not exists public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  account_type public.account_type not null,
  parent_id uuid,
  level smallint not null default 3,
  is_postable boolean not null default true,
  is_cash_account boolean not null default false,
  is_active boolean not null default true
);
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_number bigserial,
  fiscal_period_id uuid not null references public.fiscal_periods (id),
  entry_date date not null,
  concept text not null,
  reference text,
  status public.entry_status not null default 'draft',
  source_module text,
  source_id uuid,
  created_by uuid,
  posted_by uuid,
  posted_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists journal_entries_source_uidx
  on public.journal_entries (source_module, source_id)
  where source_id is not null;
create table if not exists public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.journal_entries (id) on delete cascade,
  account_id uuid not null references public.chart_of_accounts (id),
  line_order smallint not null default 1,
  debit numeric(14, 2) not null default 0,
  credit numeric(14, 2) not null default 0,
  memo text
);
create table if not exists public.cash_registers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  account_id uuid not null references public.chart_of_accounts (id),
  is_active boolean not null default true
);
create table if not exists public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  cash_register_id uuid not null references public.cash_registers (id),
  opened_by uuid not null references public.profiles (id),
  opened_at timestamptz not null default now(),
  status public.cash_session_status not null default 'open',
  opening_balance numeric(14,2) not null default 0
);
create table if not exists public.mp_intents (
  id uuid primary key default gen_random_uuid(),
  member_id uuid,
  member_number text,
  kind text,
  status text,
  amount numeric(14,2),
  currency text,
  concept text,
  provider_payment_id text,
  external_reference text,
  applied_at timestamptz,
  updated_at timestamptz,
  meta jsonb not null default '{}'::jsonb
);
create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  cash_session_id uuid not null references public.cash_sessions (id),
  movement_type text not null,
  amount numeric(14,2) not null,
  concept text not null,
  related_account_id uuid,
  member_id uuid,
  created_by uuid,
  journal_entry_id uuid,
  created_at timestamptz not null default now()
);
`;

async function query(sql, params = []) {
  return pool.query(sql, params);
}

async function asAdmin(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [actorId]);
    await client.query(`select set_config('jc.is_admin', 'on', true)`);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    try { await client.query('rollback'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

describe('colonia tesorería', () => {
  beforeAll(async () => {
    ({ cluster, databaseDir, pool } = await startEmbeddedPostgres({ label: 'colonia-caja' }));
    await query(schemaSql);
    await query(mig1);
    await query(mig2);
    await query(mig3);
    actorId = randomUUID();
    await query(`insert into public.profiles (id) values ($1)`, [actorId]);
    await query(
      `insert into public.members (id, member_number, full_name, outstanding_balance)
       values ($1, '88001', 'Socio Caja', 70000)`,
      [randomUUID()],
    );
    await query(
      `insert into public.fiscal_periods (id, name, year, starts_on, ends_on)
       values ($1, '2026', 2026, '2026-01-01', '2026-12-31')`,
      [randomUUID()],
    );
    await query(
      `insert into public.chart_of_accounts (code, name, account_type)
       values ('1.1.01', 'Caja General', 'asset'),
              ('1.1.03', 'Banco Macro', 'asset'),
              ('1.1.08', 'Mercado Pago', 'asset'),
              ('1.1.09', 'Tarjetas a cobrar', 'asset'),
              ('4.1.01', 'Cuotas Sociales', 'income')`,
    );
    const caja = await query(`select id from public.chart_of_accounts where code = '1.1.01'`);
    const register = await query(
      `insert into public.cash_registers (code, name, account_id)
       values ('GEN', 'Caja General', $1) returning id`,
      [caja.rows[0].id],
    );
    const session = await query(
      `insert into public.cash_sessions (cash_register_id, opened_by, status)
       values ($1, $2, 'open') returning id`,
      [register.rows[0].id, actorId],
    );
    sessionId = session.rows[0].id;
    await query(treasurySql);
    await query(mpSql);

    const season = await query(`select id from public.colonia_seasons where code = '2026-2027'`);
    const guardianId = randomUUID();
    const studentId = randomUUID();
    enrollmentId = randomUUID();
    await query(
      `insert into public.colonia_guardians (id, full_name, phone) values ($1, 'Tutor', '2644000000')`,
      [guardianId],
    );
    await query(
      `insert into public.colonia_students (id, full_name, birth_date, member_kind, identity_key)
       values ($1, 'Hijo Caja', '2018-05-01', 'socio', 'dni:60111000')`,
      [studentId],
    );
    await query(
      `insert into public.colonia_enrollments (id, season_id, student_id, guardian_id, plan_key, status)
       values ($1, $2, $3, $4, 'cuota', 'confirmada')`,
      [enrollmentId, season.rows[0].id, studentId, guardianId],
    );
  }, 120_000);

  afterAll(async () => {
    await stopEmbeddedPostgres({ cluster, databaseDir, pool });
  });

  it('el efectivo entra a la caja y al asiento de Colonia, sin tocar la cuota', async () => {
    const pay = await asAdmin((client) => client.query(
      `select public.colonia_record_payment($1, 'efectivo', 50000, 'confirmed', 'EFE-1', 'idem-caja-1', 'Cajero') as r`,
      [enrollmentId],
    ));
    const body = pay.rows[0].r;
    expect(body.journal_entry_id).toBeTruthy();
    expect(body.cash_movement_id).toBeTruthy();

    const lines = await query(
      `select a.code, l.debit, l.credit
       from public.journal_lines l
       join public.chart_of_accounts a on a.id = l.account_id
       where l.journal_entry_id = $1
       order by l.line_order`,
      [body.journal_entry_id],
    );
    expect(lines.rows).toEqual([
      { code: '1.1.01', debit: '50000.00', credit: '0.00' },
      { code: '4.1.06', debit: '0.00', credit: '50000.00' },
    ]);

    const movement = await query(
      `select cash_session_id, movement_type, amount from public.cash_movements where id = $1`,
      [body.cash_movement_id],
    );
    expect(movement.rows[0].cash_session_id).toBe(sessionId);
    expect(movement.rows[0].movement_type).toBe('income');
    expect(Number(movement.rows[0].amount)).toBe(50000);

    const social = await query(`select outstanding_balance from public.members where member_number = '88001'`);
    expect(Number(social.rows[0].outstanding_balance)).toBe(70000);

    const again = await asAdmin((client) => client.query(
      `select public.colonia_record_payment($1, 'efectivo', 50000, 'confirmed', 'EFE-1', 'idem-caja-1', 'Cajero') as r`,
      [enrollmentId],
    ));
    expect(again.rows[0].r.duplicate).toBe(true);
    const journals = await query(
      `select count(*)::int as n from public.journal_entries where source_module = 'colonia'`,
    );
    expect(journals.rows[0].n).toBe(1);
  });

  it('la transferencia asienta en el banco y no mueve la caja', async () => {
    const pending = await asAdmin((client) => client.query(
      `select public.colonia_record_payment($1, 'transferencia', 150000, 'pending', 'TR-1', 'idem-banco-1', 'Cajero') as r`,
      [enrollmentId],
    ));
    expect(pending.rows[0].r.journal_entry_id).toBeFalsy();

    const confirmed = await asAdmin((client) => client.query(
      `select public.colonia_confirm_payment($1, 'Cajero') as r`,
      [pending.rows[0].r.payment.id],
    ));
    const body = confirmed.rows[0].r;
    expect(body.cash_movement_id).toBeFalsy();
    const lines = await query(
      `select a.code, l.debit, l.credit
       from public.journal_lines l
       join public.chart_of_accounts a on a.id = l.account_id
       where l.journal_entry_id = $1
       order by l.line_order`,
      [body.journal_entry_id],
    );
    expect(lines.rows.map((row) => row.code)).toEqual(['1.1.03', '4.1.06']);
    expect(Number(lines.rows[0].debit)).toBe(150000);
  });

  it('la tarjeta asienta en Tarjetas a cobrar', async () => {
    const pay = await asAdmin((client) => client.query(
      `select public.colonia_record_payment($1, 'pos', 77000, 'confirmed', 'POS-1', 'idem-pos-1', 'Cajero') as r`,
      [enrollmentId],
    ));
    const lines = await query(
      `select a.code from public.journal_lines l
       join public.chart_of_accounts a on a.id = l.account_id
       where l.journal_entry_id = $1
       order by l.line_order`,
      [pay.rows[0].r.journal_entry_id],
    );
    expect(lines.rows.map((row) => row.code)).toEqual(['1.1.09', '4.1.06']);
    expect(pay.rows[0].r.cash_movement_id).toBeFalsy();
  });

  it('Mercado Pago acredita Colonia en 1.1.08 y no mueve la cuota ni la caja', async () => {
    const intentId = randomUUID();
    await query(
      `insert into public.mp_intents (id, kind, status, amount, currency, concept, provider_payment_id, meta)
       values ($1, 'colonia', 'approved', 40000, 'ARS', 'Colonia de Verano', 'pay-col-1', $2::jsonb)`,
      [intentId, JSON.stringify({ enrollmentId })],
    );
    const socialBefore = await query(`select outstanding_balance from public.members where member_number = '88001'`);
    const applied = await asAdmin((client) => client.query(
      `select public.colonia_apply_mp_intent($1) as r`,
      [intentId],
    ));
    const body = applied.rows[0].r;
    expect(body.applied).toBe(true);
    const lines = await query(
      `select a.code, l.debit, l.credit
       from public.journal_lines l
       join public.chart_of_accounts a on a.id = l.account_id
       where l.journal_entry_id = $1
       order by l.line_order`,
      [body.journal_entry_id],
    );
    expect(lines.rows.map((row) => row.code)).toEqual(['1.1.08', '4.1.06']);
    expect(Number(lines.rows[0].debit)).toBe(40000);
    const cash = await query(
      `select count(*)::int as n from public.cash_movements m
       join public.journal_entries e on e.id = m.journal_entry_id
       where e.source_id = $1`,
      [body.payment_id],
    );
    expect(cash.rows[0].n).toBe(0);
    const again = await asAdmin((client) => client.query(
      `select public.colonia_apply_mp_intent($1) as r`,
      [intentId],
    ));
    expect(again.rows[0].r.already).toBe(true);
    const journals = await query(
      `select count(*)::int as n from public.journal_entries where source_module = 'colonia' and source_id = $1`,
      [body.payment_id],
    );
    expect(journals.rows[0].n).toBe(1);
    const social = await query(`select outstanding_balance from public.members where member_number = '88001'`);
    expect(social.rows[0].outstanding_balance).toBe(socialBefore.rows[0].outstanding_balance);
  });

  it('sin caja abierta el efectivo no se acredita', async () => {
    await query(`update public.cash_sessions set status = 'closed' where id = $1`, [sessionId]);
    await expect(asAdmin((client) => client.query(
      `select public.colonia_record_payment($1, 'efectivo', 1000, 'confirmed', null, 'idem-cerrada', 'Cajero')`,
      [enrollmentId],
    ))).rejects.toThrow(/caja del día/i);
    const leftover = await query(
      `select count(*)::int as n from public.colonia_payments where idempotency_key = 'idem-cerrada'`,
    );
    expect(leftover.rows[0].n).toBe(0);
  });
});
