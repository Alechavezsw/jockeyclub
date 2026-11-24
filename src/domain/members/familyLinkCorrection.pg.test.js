/**
 * RPC de corrección de vínculo sobre Postgres embebido. No toca producción.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { startEmbeddedPostgres, stopEmbeddedPostgres } from '../../test/embeddedPostgresHarness.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const migrationSql = readFileSync(
  join(root, 'supabase/migrations/20261124120000_family_link_assisted_fix.sql'),
  'utf8',
);

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
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select jsonb_build_object('email', current_setting('request.jwt.claim.email', true))
$$;

do $$ begin
  create type public.member_status as enum ('active', 'suspended', 'inactive', 'pending');
exception when duplicate_object then null;
end $$;

create table if not exists public.members (
  id uuid primary key,
  member_number text unique,
  full_name text,
  status public.member_status default 'active',
  outstanding_balance numeric(14,2) default 0,
  meta jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.profiles (
  id uuid primary key,
  full_name text,
  email text
);

create table if not exists public.audit_logs (
  id bigserial primary key,
  actor_id uuid,
  action text,
  entity_type text,
  entity_id uuid,
  payload jsonb
);

create or replace function public.has_admin_access()
returns boolean
language sql stable as $$
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
    await client.query(`select set_config('request.jwt.claim.email', $1, true)`, ['admin@test.local']);
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

async function asMember(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [randomUUID()]);
    await client.query(`select set_config('jc.is_admin', 'off', true)`);
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

describe('family link assisted fix RPC', () => {
  beforeAll(async () => {
    ({ cluster, databaseDir, pool } = await startEmbeddedPostgres({ label: 'family-link' }));
    await query(schemaSql);
    await query(migrationSql);
    actorId = randomUUID();
    await query(
      `insert into public.profiles (id, full_name, email) values ($1, 'Admin Test', 'admin@test.local')`,
      [actorId],
    );
    const titular = randomUUID();
    const orphan = randomUUID();
    const inactive = randomUUID();
    const circular = randomUUID();
    await query(
      `insert into public.members (id, member_number, full_name, status, outstanding_balance, meta) values
        ($1, '10009', 'Titular Ok', 'active', 0, '{"familyPrincipalNumber":"10009","familyGroupName":"GF Ok"}'),
        ($2, '12087', 'Luisiana', 'active', 70000, '{"familyPrincipalNumber":"12086"}'),
        ($3, '20001', 'Titular Baja', 'inactive', 0, '{"familyPrincipalNumber":"20001","bajaFecha":"2020-01-01"}'),
        ($4, '30001', 'Ciclo A', 'active', 0, '{"familyPrincipalNumber":"30002"}')`,
      [titular, orphan, inactive, circular],
    );
    await query(
      `insert into public.members (id, member_number, full_name, status, outstanding_balance, meta)
       values ($1, '30002', 'Ciclo B', 'active', 0, '{"familyPrincipalNumber":"30001"}')`,
      [randomUUID()],
    );
  }, 120_000);

  afterAll(async () => {
    await stopEmbeddedPostgres({ cluster, databaseDir, pool });
  });

  it('aplica cambio válido y preserva saldo', async () => {
    const result = await asAdmin(async (client) => {
      const preview = await client.query(
        `select public.preview_family_link_change('12087', '10009') as data`,
      );
      expect(preview.rows[0].data.ok).toBe(true);
      const applied = await client.query(
        `select public.apply_family_link_change('12087', '12086', '10009', $1, false) as data`,
        ['Reasignación con evidencia de prueba unitaria'],
      );
      return applied.rows[0].data;
    });
    expect(result.ok).toBe(true);
    expect(result.newPrincipal).toBe('10009');
    expect(Number(result.outstandingBalance)).toBe(70000);

    const row = await query(
      `select meta->>'familyPrincipalNumber' as principal, outstanding_balance
       from public.members where member_number = '12087'`,
    );
    expect(row.rows[0].principal).toBe('10009');
    expect(Number(row.rows[0].outstanding_balance)).toBe(70000);

    const audits = await asAdmin((client) => client.query(
      `select * from public.list_family_link_audits('12087', 10)`,
    ));
    expect(audits.rows.length).toBeGreaterThan(0);
    expect(audits.rows[0].reason).toMatch(/evidencia/i);
  });

  it('rechaza titular inexistente, ciclo y usuario sin permiso', async () => {
    await expect(asAdmin((client) => client.query(
      `select public.apply_family_link_change('12087', '10009', '99999', 'Motivo suficiente de prueba', false)`,
    ))).rejects.toThrow(/no existe/i);

    // 30002 ya apunta a 30001 → reasignar 30001 bajo 30002 formaría un ciclo.
    await query(
      `update public.members
       set meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{familyPrincipalNumber}', '"10009"')
       where member_number = '30001'`,
    );
    await expect(asAdmin((client) => client.query(
      `select public.apply_family_link_change('30001', '10009', '30002', 'Motivo suficiente de prueba', false)`,
    ))).rejects.toThrow(/ciclo/i);

    await expect(asMember((client) => client.query(
      `select public.preview_family_link_change('12087', '10009')`,
    ))).rejects.toThrow(/permiso/i);
  });

  it('exige ack para titular inactivo y detecta concurrencia', async () => {
    // Restaurar 12087 a principal fantasma para este escenario.
    await query(
      `update public.members
       set meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{familyPrincipalNumber}', '"12086"')
       where member_number = '12087'`,
    );

    await expect(asAdmin((client) => client.query(
      `select public.apply_family_link_change('12087', '12086', '20001', 'Motivo suficiente de prueba', false)`,
    ))).rejects.toThrow(/no está operativo/i);

    const okInactive = await asAdmin((client) => client.query(
      `select public.apply_family_link_change('12087', '12086', '20001', 'Motivo suficiente de prueba', true) as data`,
    ));
    expect(okInactive.rows[0].data.ok).toBe(true);

    await expect(asAdmin((client) => client.query(
      `select public.apply_family_link_change('12087', '12086', '10009', 'Motivo suficiente de prueba', false)`,
    ))).rejects.toThrow(/cambió desde la revisión/i);
  });
});
