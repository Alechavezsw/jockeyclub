/**
 * Aislamiento financiero Colonia vs cuota social — Postgres descartable.
 * No toca producción.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { startEmbeddedPostgres, stopEmbeddedPostgres } from '../../test/embeddedPostgresHarness.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const migrationSql = readFileSync(join(root, 'supabase/migrations/20261124140000_colonia_verano_module.sql'), 'utf8')
  // El seed COA / role_capabilities depende de tablas productivas; el test usa stubs.
  .replace(/insert into public\.chart_of_accounts[\s\S]*?on conflict \(code\) do update[\s\S]*?is_active = true;/, '')
  .replace(/insert into public\.role_capabilities[\s\S]*?on conflict do nothing;/, '');
const hardenSql = readFileSync(join(root, 'supabase/migrations/20261124150000_colonia_ops_hardening.sql'), 'utf8');

let cluster;
let databaseDir;
let pool;
let actorId;

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
  id uuid primary key default gen_random_uuid(),
  member_id uuid,
  amount numeric(14,2)
);

create table if not exists public.dues_imputations (
  id uuid primary key default gen_random_uuid(),
  member_id uuid,
  amount numeric(14,2)
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  member_id uuid,
  amount numeric(14,2)
);

create or replace function public.has_admin_access()
returns boolean language sql stable as $$
  select coalesce(current_setting('jc.is_admin', true), 'off') = 'on'
$$;

create or replace function public.has_capability(p_cap text)
returns boolean language sql stable as $$
  select coalesce(current_setting('jc.is_admin', true), 'off') = 'on'
$$;
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

describe('colonia finance isolation', () => {
  beforeAll(async () => {
    ({ cluster, databaseDir, pool } = await startEmbeddedPostgres({ label: 'colonia' }));
    await query(schemaSql);
    await query(migrationSql);
    await query(hardenSql);
    actorId = randomUUID();

    const memberId = randomUUID();
    await query(
      `insert into public.members (id, member_number, full_name, outstanding_balance)
       values ($1, '99001', 'Socio Isolation', 70000)`,
      [memberId],
    );
    await query(
      `insert into public.member_dues_entries (member_id, amount) values ($1, 70000)`,
      [memberId],
    );
    await query(
      `insert into public.dues_imputations (member_id, amount) values ($1, 0)`,
      [memberId],
    );
    await query(
      `insert into public.reservations (member_id, amount) values ($1, 25000)`,
      [memberId],
    );
  }, 120_000);

  afterAll(async () => {
    await stopEmbeddedPostgres({ cluster, databaseDir, pool });
  });

  it('cargo y pago Colonia no mueven deuda social ni reservas', async () => {
    const season = await query(`select id from public.colonia_seasons where code = '2026-2027'`);
    const seasonId = season.rows[0].id;

    const guardianId = randomUUID();
    const studentId = randomUUID();
    const enrollmentId = randomUUID();

    await query(
      `insert into public.colonia_guardians (id, full_name, phone) values ($1, 'Tutor', '2644000000')`,
      [guardianId],
    );
    await query(
      `insert into public.colonia_students (id, full_name, birth_date, member_kind, identity_key)
       values ($1, 'Hijo Colonia', '2018-05-01', 'socio', 'dni:50111999')`,
      [studentId],
    );
    await query(
      `insert into public.colonia_enrollments (id, season_id, student_id, guardian_id, plan_key, status)
       values ($1, $2, $3, $4, 'cuota', 'confirmada')`,
      [enrollmentId, seasonId, studentId, guardianId],
    );

    await asAdmin((client) => client.query(
      `select public.colonia_post_charge($1, 'colonia_cuota', 'cuota', 150000, 'Cuota test')`,
      [enrollmentId],
    ));
    await asAdmin((client) => client.query(
      `select public.colonia_record_payment($1, 'efectivo', 150000, 'confirmed', 'REC-1', 'idem-colonia-1', 'Cajero')`,
      [enrollmentId],
    ));

    const member = await query(
      `select outstanding_balance from public.members where member_number = '99001'`,
    );
    expect(Number(member.rows[0].outstanding_balance)).toBe(70000);

    const dues = await query(`select count(*)::int as n, coalesce(sum(amount),0) as total from public.member_dues_entries`);
    expect(dues.rows[0].n).toBe(1);
    expect(Number(dues.rows[0].total)).toBe(70000);

    const imputations = await query(`select count(*)::int as n from public.dues_imputations`);
    expect(imputations.rows[0].n).toBe(1);

    const reservations = await query(`select amount from public.reservations`);
    expect(Number(reservations.rows[0].amount)).toBe(25000);

    const coloniaBalance = await query(
      `select
         coalesce((select sum(amount) from public.colonia_charges where enrollment_id = $1 and status = 'posted'),0)
         - coalesce((select sum(amount) from public.colonia_payments where enrollment_id = $1 and status = 'confirmed'),0)
         as balance`,
      [enrollmentId],
    );
    expect(Number(coloniaBalance.rows[0].balance)).toBe(0);

    // Prueba inversa: un "pago social" simulado no toca Colonia.
    await query(`update public.members set outstanding_balance = 50000 where member_number = '99001'`);
    const coloniaAfterSocial = await query(
      `select coalesce(sum(amount),0) as charged from public.colonia_charges where enrollment_id = $1`,
      [enrollmentId],
    );
    expect(Number(coloniaAfterSocial.rows[0].charged)).toBe(150000);
  });

  it('rechaza usuario sin permiso', async () => {
    const enrollment = await query(`select id from public.colonia_enrollments limit 1`);
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [randomUUID()]);
      await client.query(`select set_config('jc.is_admin', 'off', true)`);
      await expect(client.query(
        `select public.colonia_record_payment($1, 'efectivo', 1000, 'confirmed', null, null, null)`,
        [enrollment.rows[0].id],
      )).rejects.toThrow(/permiso/i);
      await client.query('rollback');
    } finally {
      client.release();
    }
  });
});
