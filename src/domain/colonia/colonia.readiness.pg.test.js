/**
 * Validación final Colonia: 3 migraciones, roles reales, aislamiento, tarifas.
 * Postgres descartable — no toca producción.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { startEmbeddedPostgres, stopEmbeddedPostgres } from '../../test/embeddedPostgresHarness.js';
import {
  COLONIA_OFFICIAL_TARIFFS_2026_2027,
  buildSeasonTariffRows,
  evaluatePromotionCharge,
  inscriptionAmount,
  planAmountFor,
} from './coloniaTariffs.js';
import { buildColoniaReceipt, buildColoniaEnrollmentsCsv } from './coloniaLedger.js';
import { validateColoniaPaymentInput } from './coloniaPayments.js';
import { COLONIA_SEASON_2026_2027 } from './coloniaConstants.js';
import {
  canAccessColonia,
  canAttendColonia,
  canCollectColonia,
  canManageColoniaHealth,
  canViewColoniaFinance,
} from '../auth/roles.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const stripSeeds = (sql) => sql
  .replace(/insert into public\.chart_of_accounts[\s\S]*?on conflict \(code\) do update[\s\S]*?is_active = true;/, '')
  .replace(/insert into public\.role_capabilities[\s\S]*?on conflict do nothing;/g, '');

const mig1 = stripSeeds(readFileSync(join(root, 'supabase/migrations/20261124140000_colonia_verano_module.sql'), 'utf8'));
const mig2 = readFileSync(join(root, 'supabase/migrations/20261124150000_colonia_ops_hardening.sql'), 'utf8');
const mig3 = stripSeeds(readFileSync(join(root, 'supabase/migrations/20261124160000_colonia_prod_readiness.sql'), 'utf8'));
const mig4 = readFileSync(join(root, 'supabase/migrations/20261124250000_colonia_cuarto_hermano.sql'), 'utf8');

let cluster;
let databaseDir;
let pool;

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
create table if not exists public.role_capabilities (
  capability text not null,
  role_key text not null,
  primary key (capability, role_key)
);
create table if not exists public.profiles (
  id uuid primary key,
  role text
);
create table if not exists public.profile_roles (
  profile_id uuid not null,
  role_key text not null,
  revoked_at timestamptz
);
create or replace function public.has_admin_access()
returns boolean language sql stable as $$
  select coalesce(current_setting('jc.is_admin', true), 'off') = 'on'
$$;
create or replace function public.has_capability(p_capability text)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.role_capabilities rc
    where rc.capability = p_capability
      and rc.role_key = coalesce(current_setting('jc.role_key', true), '')
  )
$$;
`;

async function query(sql, params = []) {
  return pool.query(sql, params);
}

async function asRole(roleKey, isAdmin, fn) {
  const uid = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    await client.query(`select set_config('jc.is_admin', $1, true)`, [isAdmin ? 'on' : 'off']);
    await client.query(`select set_config('jc.role_key', $1, true)`, [roleKey || '']);
    const result = await fn(client, uid);
    await client.query('commit');
    return result;
  } catch (err) {
    try { await client.query('rollback'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

describe('colonia production readiness', () => {
  let seasonId;
  let enrollmentId;
  let studentId;
  let memberId;

  beforeAll(async () => {
    ({ cluster, databaseDir, pool } = await startEmbeddedPostgres({ label: 'colonia-ready' }));
    await query(schemaSql);
    await query(mig1);
    await query(mig4);
    await query(mig2);
    await query(mig3);

    // Caps reales (mismo mapa que migración 140000 + 160000)
    await query(`
      insert into public.role_capabilities (capability, role_key) values
        ('colonia.operate', 'admin'),
        ('colonia.operate', 'superadmin'),
        ('colonia.operate', 'accountant'),
        ('colonia.operate', 'admin_employee'),
        ('colonia.collect', 'admin'),
        ('colonia.collect', 'superadmin'),
        ('colonia.collect', 'cashier'),
        ('colonia.collect', 'accountant'),
        ('colonia.attend', 'admin'),
        ('colonia.attend', 'superadmin'),
        ('colonia.attend', 'admin_employee'),
        ('colonia.attend', 'teacher'),
        ('colonia.attend', 'staff'),
        ('colonia.report', 'admin'),
        ('colonia.report', 'superadmin'),
        ('colonia.report', 'accountant')
      on conflict do nothing
    `);

    memberId = randomUUID();
    await query(
      `insert into public.members (id, member_number, full_name, outstanding_balance)
       values ($1, '77001', 'Socio Con Deuda', 140000)`,
      [memberId],
    );
    await query(`insert into public.member_dues_entries (member_id, amount) values ($1, 140000)`, [memberId]);
    await query(`insert into public.dues_imputations (member_id, amount) values ($1, 0)`, [memberId]);
    await query(`insert into public.reservations (member_id, amount) values ($1, 8000)`, [memberId]);

    const season = await query(`select id from public.colonia_seasons where code = '2026-2027'`);
    seasonId = season.rows[0].id;

    const guardianId = randomUUID();
    studentId = randomUUID();
    enrollmentId = randomUUID();
    await query(
      `insert into public.colonia_guardians (id, full_name, phone) values ($1, 'Tutor Ready', '2644000111')`,
      [guardianId],
    );
    await query(
      `insert into public.colonia_students (id, full_name, document_number, birth_date, member_kind, member_number, identity_key)
       values ($1, 'Alumno Socio Deuda', '55888777', '2017-03-01', 'socio', '77001', 'dni:55888777')`,
      [studentId],
    );
    await query(
      `insert into public.colonia_enrollments (id, season_id, student_id, guardian_id, plan_key, status)
       values ($1, $2, $3, $4, 'cuota', 'pendiente')`,
      [enrollmentId, seasonId, studentId, guardianId],
    );
  }, 180_000);

  afterAll(async () => {
    await stopEmbeddedPostgres({ cluster, databaseDir, pool });
  });

  it('tarifas oficiales seed + dominio coinciden', async () => {
    expect(inscriptionAmount()).toBe(50000);
    expect(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'socio', 'cuota')).toBe(150000);
    expect(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'no_socio', 'cuota')).toBe(180000);
    expect(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'socio', 'temporada')).toBe(390000);
    expect(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'no_socio', 'temporada')).toBe(490000);
    expect(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'socio', 'promo_2')).toBe(280000);
    expect(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'no_socio', 'promo_2')).toBe(340000);
    expect(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'socio', 'promo_3')).toBe(410000);
    expect(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'no_socio', 'promo_3')).toBe(500000);
    expect(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'socio', 'hermano_4')).toBe(410000);
    expect(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'no_socio', 'hermano_4')).toBe(500000);

    const rows = await query(
      `select member_kind, plan_key, amount::int as amount from public.colonia_tariffs where season_id = $1`,
      [seasonId],
    );
    const byKey = Object.fromEntries(rows.rows.map((r) => [`${r.member_kind}:${r.plan_key}`, Number(r.amount)]));
    expect(byKey['any:inscripcion']).toBe(50000);
    expect(byKey['socio:cuota']).toBe(150000);
    expect(byKey['no_socio:cuota']).toBe(180000);
    expect(byKey['socio:temporada']).toBe(390000);
    expect(byKey['no_socio:temporada']).toBe(490000);
    expect(byKey['socio:promo_2']).toBe(280000);
    expect(byKey['no_socio:promo_2']).toBe(340000);
    expect(byKey['socio:promo_3']).toBe(410000);
    expect(byKey['no_socio:promo_3']).toBe(500000);
    expect(byKey['socio:hermano_4']).toBe(410000);
    expect(byKey['no_socio:hermano_4']).toBe(500000);
    expect(buildSeasonTariffRows().length).toBeGreaterThanOrEqual(11);

    expect(evaluatePromotionCharge({
      planKey: 'promo_2',
      season: COLONIA_SEASON_2026_2027,
      siblingCount: 2,
      memberKinds: ['socio', 'socio'],
    }).ok).toBe(true);
  });

  it('permisos frontend por rol', () => {
    expect(canAccessColonia('superadmin')).toBe(true);
    expect(canCollectColonia('superadmin')).toBe(true);
    expect(canAccessColonia('admin_employee')).toBe(true);
    expect(canCollectColonia('admin_employee')).toBe(false);
    expect(canViewColoniaFinance('admin_employee')).toBe(true);
    expect(canCollectColonia('cashier')).toBe(true);
    expect(canAttendColonia('teacher')).toBe(true);
    expect(canCollectColonia('teacher')).toBe(false);
    expect(canViewColoniaFinance('teacher')).toBe(false);
    expect(canManageColoniaHealth('teacher')).toBe(false);
    expect(canManageColoniaHealth('admin')).toBe(true);
    expect(canAccessColonia('member')).toBe(false);
    expect(canAccessColonia(null)).toBe(false);
  });

  it('RPC: cajero cobra; profesor asiste; socio y anon denegados', async () => {
    await asRole('cashier', false, (client) => client.query(
      `select public.colonia_post_charge($1, 'colonia_inscripcion', 'inscripcion', 50000, 'Inscripción')`,
      [enrollmentId],
    ));
    await asRole('cashier', false, (client) => client.query(
      `select public.colonia_record_payment($1, 'efectivo', 20000, 'confirmed', 'PART-1', 'ready-idem-1', 'Cajero') as r`,
      [enrollmentId],
    ));

    // Profesor no cobra
    await expect(asRole('teacher', false, (client) => client.query(
      `select public.colonia_record_payment($1, 'efectivo', 1000, 'confirmed', null, null, null)`,
      [enrollmentId],
    ))).rejects.toThrow(/permiso/i);

    // Profesor sí asiste
    await asRole('teacher', false, (client) => client.query(
      `select public.colonia_upsert_attendance($1, '2026-12-02', 'presente', 'Profe', null)`,
      [enrollmentId],
    ));

    // Profesor no void
    const charge = await query(`select id from public.colonia_charges where enrollment_id = $1 limit 1`, [enrollmentId]);
    await expect(asRole('teacher', false, (client) => client.query(
      `select public.colonia_void_charge($1, 'intento indebido de anulación')`,
      [charge.rows[0].id],
    ))).rejects.toThrow(/permiso/i);

    // Profesor no salud
    await expect(asRole('teacher', false, (client) => client.query(
      `select public.colonia_upsert_student_health($1, 'asma', 'polen', null)`,
      [studentId],
    ))).rejects.toThrow(/salud|permiso/i);

    // Admin sí salud
    await asRole('admin', false, (client) => client.query(
      `select public.colonia_upsert_student_health($1, 'controlado', 'polen', null)`,
      [studentId],
    ));

    // Sin auth
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('request.jwt.claim.sub', '', true)`);
      await client.query(`select set_config('jc.is_admin', 'off', true)`);
      await client.query(`select set_config('jc.role_key', '', true)`);
      await expect(client.query(
        `select public.colonia_record_payment($1, 'efectivo', 1000, 'confirmed', null, null, null)`,
        [enrollmentId],
      )).rejects.toThrow(/logueado|permiso/i);
      await client.query('rollback');
    } finally {
      client.release();
    }

    // Deuda social intacta
    const member = await query(`select outstanding_balance from public.members where id = $1`, [memberId]);
    expect(Number(member.rows[0].outstanding_balance)).toBe(140000);
  });

  it('pagos: pending transferencia, card sin confirm, MP bloqueado, recibo solo confirmed, CSV', async () => {
    expect(validateColoniaPaymentInput({
      method: 'pos', amount: 10000, enrollmentId, operatorConfirmed: false,
    }).ok).toBe(false);

    const pending = await asRole('cashier', false, (client) => client.query(
      `select public.colonia_record_payment($1, 'transferencia', 30000, 'pending', 'TRX-READY', 'ready-trx', 'Cajero') as r`,
      [enrollmentId],
    ));
    expect(pending.rows[0].r.payment.status).toBe('pending');
    expect(buildColoniaReceipt({ payment: pending.rows[0].r.payment })).toBeNull();

    const conf = await asRole('cashier', false, (client) => client.query(
      `select public.colonia_confirm_payment($1, 'Cajero') as r`,
      [pending.rows[0].r.payment.id],
    ));
    expect(conf.rows[0].r.payment.status).toBe('confirmed');
    expect(buildColoniaReceipt({
      payment: conf.rows[0].r.payment,
      student: { fullName: 'Alumno' },
      guardian: { fullName: 'Tutor' },
      season: { name: '2026/2027' },
    }).amount).toBe(30000);

    // Confirmación duplicada (idempotente already)
    const again = await asRole('cashier', false, (client) => client.query(
      `select public.colonia_confirm_payment($1, 'Cajero') as r`,
      [pending.rows[0].r.payment.id],
    ));
    expect(again.rows[0].r.already).toBe(true);

    await expect(asRole('cashier', false, (client) => client.query(
      `select public.colonia_record_payment($1, 'mercadopago', 5000, 'confirmed', null, 'ready-mp', null)`,
      [enrollmentId],
    ))).rejects.toThrow(/Mercado Pago/i);

    const csv = buildColoniaEnrollmentsCsv([{
      plan_key: 'cuota', status: 'pendiente',
      student: { full_name: 'Alumno Socio Deuda', document_number: '55888777', member_kind: 'socio' },
      guardian: { full_name: 'Tutor Ready', phone: '264' },
    }]);
    expect(csv).toContain('Alumno Socio Deuda');
    expect(csv).toContain('pendiente');
  });

  it('cancelación con pagos previos y trigger balance', async () => {
    await asRole('admin', false, (client) => client.query(
      `select public.colonia_cancel_enrollment($1, 'Cierre de prueba readiness') as r`,
      [enrollmentId],
    ));
    const st = await query(`select status from public.colonia_enrollments where id = $1`, [enrollmentId]);
    expect(st.rows[0].status).toBe('cancelada');

    const payments = await query(
      `select count(*)::int as n from public.colonia_payments where enrollment_id = $1 and status = 'confirmed'`,
      [enrollmentId],
    );
    expect(payments.rows[0].n).toBeGreaterThanOrEqual(1);

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('jc.colonia_tx', 'on', true)`);
      await expect(client.query(
        `update public.members set outstanding_balance = 0 where id = $1`,
        [memberId],
      )).rejects.toThrow(/outstanding_balance/i);
      await client.query('rollback');
    } finally {
      client.release();
    }

    const member = await query(`select outstanding_balance from public.members where id = $1`, [memberId]);
    expect(Number(member.rows[0].outstanding_balance)).toBe(140000);
  });
});
