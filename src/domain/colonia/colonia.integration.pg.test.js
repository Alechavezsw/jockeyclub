/**
 * Integración portal + aislamiento financiero esencial ($70k social vs Colonia).
 * Postgres descartable — no toca producción.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { startEmbeddedPostgres, stopEmbeddedPostgres } from '../../test/embeddedPostgresHarness.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const migrationSql = readFileSync(join(root, 'supabase/migrations/20261124140000_colonia_verano_module.sql'), 'utf8')
  .replace(/insert into public\.chart_of_accounts[\s\S]*?on conflict \(code\) do update[\s\S]*?is_active = true;/, '')
  .replace(/insert into public\.role_capabilities[\s\S]*?on conflict do nothing;/, '');
const hardenSql = readFileSync(join(root, 'supabase/migrations/20261124150000_colonia_ops_hardening.sql'), 'utf8');
const readySql = readFileSync(join(root, 'supabase/migrations/20261124160000_colonia_prod_readiness.sql'), 'utf8')
  .replace(/insert into public\.role_capabilities[\s\S]*?on conflict do nothing;/g, '');
const portalSql = readFileSync(join(root, 'supabase/migrations/20261124170000_colonia_portal_integration.sql'), 'utf8');

let cluster;
let databaseDir;
let pool;
let actorId;
let memberId;
let profileId;

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
  outstanding_balance numeric(14,2) default 0,
  profile_id uuid,
  meta jsonb default '{}'::jsonb
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

async function asMember(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [profileId]);
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

describe('colonia portal integration + financial isolation', () => {
  beforeAll(async () => {
    ({ cluster, databaseDir, pool } = await startEmbeddedPostgres({ label: 'colonia-portal' }));
    await query(schemaSql);
    await query(migrationSql);
    await query(hardenSql);
    await query(readySql);
    await query(portalSql);
    actorId = randomUUID();
    profileId = randomUUID();
    memberId = randomUUID();

    await query(
      `insert into public.members (id, member_number, full_name, outstanding_balance, profile_id)
       values ($1, '88001', 'Titular Deudor', 70000, $2)`,
      [memberId, profileId],
    );
    await query(`insert into public.member_dues_entries (member_id, amount) values ($1, 70000)`, [memberId]);
    await query(`insert into public.dues_imputations (member_id, amount) values ($1, 0)`, [memberId]);
    await query(`insert into public.reservations (member_id, amount) values ($1, 12000)`, [memberId]);
  }, 180_000);

  afterAll(async () => {
    await stopEmbeddedPostgres({ cluster, databaseDir, pool });
  });

  it('inscripción portal + pago Colonia deja deuda social en 70000 y Colonia en 0', async () => {
    await query(`
      update public.colonia_seasons
      set enrollment_opens_on = (current_date - 1),
          enrollment_closes_on = (current_date + 30)
      where code = '2026-2027'
    `);
    const season = await query(`select id from public.colonia_seasons where code = '2026-2027'`);
    const seasonId = season.rows[0].id;

    const submitted = await asMember((client) => client.query(
      `select public.colonia_submit_portal_enrollment(
        $1,
        $2::jsonb,
        $3::jsonb,
        'cuota',
        $4,
        'idem-portal-1'
      ) as result`,
      [
        seasonId,
        JSON.stringify({
          full_name: 'Hijo Portal',
          document_number: '50999888',
          birth_date: '2015-04-10',
          member_kind: 'socio',
          member_number: '88002',
          shirt_size: '10',
        }),
        JSON.stringify({
          full_name: 'Titular Deudor',
          phone: '2644000001',
          email: 'titular@example.com',
          relationship: 'Padre',
          emergency_contact: 'Abuela 2644',
          authorized_pickup: 'Abuela',
        }),
        memberId,
      ],
    ));

    const enrollment = submitted.rows[0].result.enrollment;
    expect(enrollment.source).toBe('portal');
    expect(enrollment.status).toBe('pendiente');

    const enrollId = enrollment.id;

    await asAdmin((client) => client.query(
      `select public.colonia_post_charge($1, 'colonia_inscripcion', null, 50000, 'Inscripcion')`,
      [enrollId],
    ));
    await asAdmin((client) => client.query(
      `select public.colonia_post_charge($1, 'colonia_cuota', 'cuota', 150000, 'Plan')`,
      [enrollId],
    ));
    await asAdmin((client) => client.query(
      `select public.colonia_record_payment($1, 'efectivo', 200000, 'confirmed', 'CAJA-1', 'idem-pay-full', 'Cajero')`,
      [enrollId],
    ));

    const member = await query(`select outstanding_balance from public.members where id = $1`, [memberId]);
    expect(Number(member.rows[0].outstanding_balance)).toBe(70000);

    const dues = await query(`select count(*)::int as n, coalesce(sum(amount),0) as total from public.member_dues_entries where member_id = $1`, [memberId]);
    expect(dues.rows[0].n).toBe(1);
    expect(Number(dues.rows[0].total)).toBe(70000);

    const imputations = await query(`select count(*)::int as n from public.dues_imputations where member_id = $1`, [memberId]);
    expect(imputations.rows[0].n).toBe(1);

    const reservations = await query(`select amount from public.reservations where member_id = $1`, [memberId]);
    expect(Number(reservations.rows[0].amount)).toBe(12000);

    const coloniaBalance = await query(
      `select
         coalesce((select sum(amount) from public.colonia_charges where enrollment_id = $1 and status = 'posted'),0)
         - coalesce((select sum(amount) from public.colonia_payments where enrollment_id = $1 and status = 'confirmed'),0)
         as balance`,
      [enrollId],
    );
    expect(Number(coloniaBalance.rows[0].balance)).toBe(0);

    const payments = await query(
      `select count(*)::int as n from public.colonia_payments where enrollment_id = $1 and status = 'confirmed'`,
      [enrollId],
    );
    expect(payments.rows[0].n).toBe(1);

    const listed = await asMember((client) => client.query(
      `select public.colonia_list_for_member($1) as result`,
      [memberId],
    ));
    expect(listed.rows[0].result.ok).toBe(true);
    expect((listed.rows[0].result.enrollments || []).length).toBeGreaterThanOrEqual(1);

    // Idempotencia del submit portal
    const dup = await asMember((client) => client.query(
      `select public.colonia_submit_portal_enrollment(
        $1, $2::jsonb, $3::jsonb, 'cuota', $4, 'idem-portal-1'
      ) as result`,
      [
        seasonId,
        JSON.stringify({
          full_name: 'Hijo Portal',
          document_number: '50999888',
          birth_date: '2015-04-10',
          member_kind: 'socio',
          shirt_size: '10',
        }),
        JSON.stringify({
          full_name: 'Titular Deudor',
          phone: '2644000001',
          emergency_contact: 'Abuela',
          authorized_pickup: 'Abuela',
        }),
        memberId,
      ],
    ));
    expect(dup.rows[0].result.duplicate).toBe(true);
  });

  it('transferencia portal queda pending y no acredita sola', async () => {
    const enroll = await query(
      `select id from public.colonia_enrollments where source = 'portal' limit 1`,
    );
    const enrollId = enroll.rows[0].id;

    const res = await asMember((client) => client.query(
      `select public.colonia_report_portal_transfer($1, 50000, 'TRX-ABC', null, 'idem-tr-1') as result`,
      [enrollId],
    ));
    expect(res.rows[0].result.payment.status).toBe('pending');

    const member = await query(`select outstanding_balance from public.members where id = $1`, [memberId]);
    expect(Number(member.rows[0].outstanding_balance)).toBe(70000);
  });

  it('bloquea planes promo ambiguos en portal', async () => {
    const season = await query(`select id from public.colonia_seasons where code = '2026-2027'`);
    await expect(asMember((client) => client.query(
      `select public.colonia_submit_portal_enrollment(
        $1,
        '{"full_name":"Otro","document_number":"50111000","birth_date":"2014-01-01","member_kind":"socio","shirt_size":"8"}'::jsonb,
        '{"full_name":"Titular","phone":"1","emergency_contact":"x","authorized_pickup":"y"}'::jsonb,
        'promo_2',
        $2,
        'idem-promo-block'
      )`,
      [season.rows[0].id, memberId],
    ))).rejects.toThrow(/Plan no habilitado|promo/i);
  });
});
