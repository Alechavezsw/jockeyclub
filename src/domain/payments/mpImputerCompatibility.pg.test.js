/**
 * La migración reemplaza el imputador de cinco argumentos sin dejar
 * otra firma ejecutable por anon o authenticated.
 * Postgres embebido. No toca la base del club.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const migration = readFileSync(
  join(root, 'supabase/migrations/20261123230000_subscription_pending_and_debit_capital.sql'),
  'utf8',
);
const PORT = 58840 + Math.floor(Math.random() * 80);
const MEMBER = '41414141-4141-4141-8141-414141414141';
const PAYMENT = '42424242-4242-4242-8242-424242424242';
const signature = 'public.impute_dues_account_payment(uuid,uuid,numeric,jsonb,date,boolean)';

let cluster;
let databaseDir;
let pool;

function query(text, params) {
  return pool.query(text, params);
}

describe('compatibilidad y permisos del imputador', () => {
  beforeAll(async () => {
    databaseDir = mkdtempSync(join(tmpdir(), 'jockey-mp-compat-'));
    cluster = new EmbeddedPostgres({
      databaseDir,
      user: 'postgres',
      password: 'postgres',
      port: PORT,
      persistent: false,
    });
    await cluster.initialise();
    await cluster.start();
    pool = new pg.Pool({ connectionString: `postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`, max: 2 });
    await query(`
      do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
      do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
      do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
      grant usage on schema public to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

      create table public.members (
        id uuid primary key,
        outstanding_balance numeric(14,2) not null default 0,
        payment_method text,
        meta jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now()
      );
      create table public.mp_intents (
        id uuid primary key,
        member_id uuid,
        kind text,
        status text,
        amount numeric(14,2),
        preapproval_id text,
        meta jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table public.member_dues_periods (
        member_id uuid not null,
        due_on date not null,
        capital numeric(14,2) not null,
        capital_open numeric(14,2) not null,
        late_base numeric(14,2) not null default 0,
        primary key (member_id, due_on)
      );
      create table public.dues_imputations (
        payment_id uuid,
        member_id uuid,
        due_on date,
        capital numeric(14,2),
        surcharge numeric(14,2),
        capital_open numeric(14,2),
        surcharge_open numeric(14,2),
        late_base_taken numeric(14,2),
        kind text,
        voided_at timestamptz
      );
      create table public.member_dues_entries (
        member_id uuid,
        amount numeric(14,2),
        kind text,
        source text,
        charge_scope text
      );
      create unique index member_dues_entries_source_uidx
        on public.member_dues_entries (source) where source <> '';
      create table public.member_payments (
        id uuid primary key,
        member_id uuid not null,
        amount numeric(14,2) not null,
        method text,
        paid_at date,
        idempotency_key text,
        meta jsonb not null default '{}'::jsonb
      );
      create function public.member_id_is_dues_exempt(mid uuid) returns boolean
      language sql stable as $$ select false $$;

      create function public.impute_dues_account_payment(
        p_member_id uuid, p_payment_id uuid, p_cash numeric, p_schedule jsonb, p_paid date
      ) returns numeric
      language sql security definer set search_path = public as $$ select 1::numeric $$;
      grant execute on function public.impute_dues_account_payment(uuid, uuid, numeric, jsonb, date)
        to public, anon, authenticated;
    `);
    await query(migration);
  }, 60_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await cluster?.stop().catch(() => {});
    if (databaseDir) {
      try { rmSync(databaseDir, { recursive: true, force: true }); } catch { /* el directorio puede seguir un instante en Windows */ }
    }
  }, 60_000);

  it('queda una sola firma y el público no puede ejecutarla', async () => {
    const overloads = await query(`
      select pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'impute_dues_account_payment'
    `);
    expect(overloads.rows.map((row) => row.args)).toEqual([
      'p_member_id uuid, p_payment_id uuid, p_cash numeric, p_schedule jsonb, p_paid date, p_skip_surcharge boolean',
    ]);
    const privileges = await query(`
      select
        has_function_privilege('anon', '${signature}', 'execute') as anon,
        has_function_privilege('authenticated', '${signature}', 'execute') as authenticated,
        has_function_privilege('public', '${signature}', 'execute') as public,
        has_function_privilege('service_role', '${signature}', 'execute') as service
    `);
    expect(privileges.rows[0]).toEqual({
      anon: false,
      authenticated: false,
      public: false,
      service: true,
    });
    const oldSignature = await query(`
      select to_regprocedure('public.impute_dues_account_payment(uuid,uuid,numeric,jsonb,date)') as old_fn
    `);
    expect(oldSignature.rows[0].old_fn).toBeNull();
  });

  it('la llamada de cinco argumentos de caja conserva la mora', async () => {
    await query(
      `insert into public.members (id, outstanding_balance) values ($1, 80000)`,
      [MEMBER],
    );
    await query(
      `insert into public.member_dues_entries (member_id, amount, kind, source, charge_scope)
       values ($1, 80000, 'opening', 'compat-social', 'cuota_social')`,
      [MEMBER],
    );
    await query(
      `insert into public.member_dues_periods (member_id, due_on, capital, capital_open, late_base)
       values ($1, '2026-10-10', 40000, 40000, 40000), ($1, '2026-11-10', 40000, 40000, 40000)`,
      [MEMBER],
    );
    const applied = await query(
      `select public.impute_dues_account_payment($1, $2, 80000, '[]'::jsonb, '2026-11-20') as applied`,
      [MEMBER, PAYMENT],
    );
    expect(Number(applied.rows[0].applied)).toBe(76000);
    const rows = await query(
      `select due_on::text, capital::float, surcharge::float
       from public.dues_imputations where payment_id = $1 order by due_on`,
      [PAYMENT],
    );
    expect(rows.rows[0]).toMatchObject({ due_on: '2026-10-10', capital: 40000, surcharge: 4000 });
    expect(rows.rows[1]).toMatchObject({ due_on: '2026-11-10', capital: 36000, surcharge: 0 });
  });

  it('authenticated no llama al imputador; una función definer de caja sí', async () => {
    await query(`
      create function public.caja_imputa_por_trigger()
      returns numeric language plpgsql security definer set search_path = public as $fn$
      begin
        return public.impute_dues_account_payment(
          '${MEMBER}', '${PAYMENT}', 1, '[]'::jsonb, current_date
        );
      end;
      $fn$;
      grant execute on function public.caja_imputa_por_trigger() to authenticated;
    `);
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role authenticated');
      await client.query('savepoint member_denied');
      await expect(client.query(
        `select public.impute_dues_account_payment($1, $2, 1, '[]'::jsonb, current_date)`,
        [MEMBER, '43434343-4343-4434-8434-434343434343'],
      )).rejects.toThrow(/permission denied/i);
      await client.query('rollback to savepoint member_denied');
      const viaCaja = await client.query('select public.caja_imputa_por_trigger() as applied');
      expect(Number(viaCaja.rows[0].applied)).toBe(0);
      await client.query('rollback');
    } finally {
      await client.query('rollback').catch(() => {});
      client.release();
    }
  });
});
