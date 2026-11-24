/**
 * Circuito administrativo completo Colonia — Postgres descartable.
 * Temporada → tarifas → responsable → inscripción → cargos → pago →
 * comprobante → grupo → asistencia → actividad → dashboard.
 * No toca producción.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { startEmbeddedPostgres, stopEmbeddedPostgres } from '../../test/embeddedPostgresHarness.js';
import { buildColoniaReceipt } from './coloniaLedger.js';
import { COLONIA_OFFICIAL_TARIFFS_2026_2027, inscriptionAmount, planAmountFor } from './coloniaTariffs.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const baseMigration = readFileSync(
  join(root, 'supabase/migrations/20261124140000_colonia_verano_module.sql'),
  'utf8',
)
  .replace(/insert into public\.chart_of_accounts[\s\S]*?on conflict \(code\) do update[\s\S]*?is_active = true;/, '')
  .replace(/insert into public\.role_capabilities[\s\S]*?on conflict do nothing;/, '');
const hardenMigration = readFileSync(
  join(root, 'supabase/migrations/20261124150000_colonia_ops_hardening.sql'),
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

describe('colonia administrative journey', () => {
  beforeAll(async () => {
    ({ cluster, databaseDir, pool } = await startEmbeddedPostgres({ label: 'colonia-journey' }));
    await query(schemaSql);
    await query(baseMigration);
    await query(hardenMigration);
    actorId = randomUUID();

    const memberId = randomUUID();
    await query(
      `insert into public.members (id, member_number, full_name, outstanding_balance)
       values ($1, '88001', 'Socio Journey', 70000)`,
      [memberId],
    );
    await query(`insert into public.member_dues_entries (member_id, amount) values ($1, 70000)`, [memberId]);
    await query(`insert into public.dues_imputations (member_id, amount) values ($1, 0)`, [memberId]);
    await query(`insert into public.reservations (member_id, amount) values ($1, 12000)`, [memberId]);
  }, 180_000);

  afterAll(async () => {
    await stopEmbeddedPostgres({ cluster, databaseDir, pool });
  });

  it('recorrido completo sin tocar cuota social ni padrón', async () => {
    const season = await query(`select id, code, name from public.colonia_seasons where code = '2026-2027'`);
    expect(season.rows[0]).toBeTruthy();
    const seasonId = season.rows[0].id;

    const guardianId = randomUUID();
    const studentId = randomUUID();
    const enrollmentId = randomUUID();

    await query(
      `insert into public.colonia_guardians (id, full_name, phone, email, emergency_contact)
       values ($1, 'Responsable Journey', '2644111222', 'resp@example.com', 'Abuela 2644000')`,
      [guardianId],
    );
    await query(
      `insert into public.colonia_students (id, full_name, document_number, birth_date, member_kind, identity_key)
       values ($1, 'Alumno No Socio', '55999888', '2018-06-15', 'no_socio', 'dni:55999888')`,
      [studentId],
    );
    // No socio: no debe existir fila en members.
    const padrones = await query(`select count(*)::int as n from public.members where full_name = 'Alumno No Socio'`);
    expect(padrones.rows[0].n).toBe(0);

    await query(
      `insert into public.colonia_enrollments (id, season_id, student_id, guardian_id, plan_key, status)
       values ($1, $2, $3, $4, 'cuota', 'pendiente')`,
      [enrollmentId, seasonId, studentId, guardianId],
    );

    const inscripcion = inscriptionAmount(COLONIA_OFFICIAL_TARIFFS_2026_2027);
    const cuota = planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'no_socio', 'cuota');
    expect(inscripcion).toBe(50000);
    expect(cuota).toBe(180000);

    await asAdmin((client) => client.query(
      `select public.colonia_post_charge($1, 'colonia_inscripcion', 'inscripcion', $2, 'Inscripción')`,
      [enrollmentId, inscripcion],
    ));
    await asAdmin((client) => client.query(
      `select public.colonia_post_charge($1, 'colonia_cuota', 'cuota', $2, 'Cuota')`,
      [enrollmentId, cuota],
    ));

    // Pago parcial efectivo
    const pay1 = await asAdmin((client) => client.query(
      `select public.colonia_record_payment($1, 'efectivo', 50000, 'confirmed', 'CASH-1', 'idem-j1', 'Cajero A') as r`,
      [enrollmentId],
    ));
    expect(pay1.rows[0].r.ok).toBe(true);
    expect(pay1.rows[0].r.payment.status).toBe('confirmed');

    // Duplicado por idempotencia
    const payDup = await asAdmin((client) => client.query(
      `select public.colonia_record_payment($1, 'efectivo', 50000, 'confirmed', 'CASH-1', 'idem-j1', 'Cajero B') as r`,
      [enrollmentId],
    ));
    expect(payDup.rows[0].r.duplicate).toBe(true);

    // Transferencia pendiente (no acredita)
    const payPending = await asAdmin((client) => client.query(
      `select public.colonia_record_payment($1, 'transferencia', 180000, 'pending', 'TRX-99', 'idem-j2', 'Cajero A') as r`,
      [enrollmentId],
    ));
    expect(payPending.rows[0].r.payment.status).toBe('pending');
    const pendingId = payPending.rows[0].r.payment.id;

    // Confirmar transferencia
    const confirmed = await asAdmin((client) => client.query(
      `select public.colonia_confirm_payment($1, 'Cajero A') as r`,
      [pendingId],
    ));
    expect(confirmed.rows[0].r.payment.status).toBe('confirmed');

    const receipt = buildColoniaReceipt({
      payment: confirmed.rows[0].r.payment,
      student: { full_name: 'Alumno No Socio' },
      guardian: { full_name: 'Responsable Journey' },
      season: season.rows[0],
    });
    expect(receipt).toBeTruthy();
    expect(receipt.amount).toBe(180000);
    expect(receipt.operationId).toBe(pendingId);
    expect(receipt.fiscalClaim).toBe(false);

    // MP no se acredita
    await expect(asAdmin((client) => client.query(
      `select public.colonia_record_payment($1, 'mercadopago', 1000, 'confirmed', null, 'idem-mp', null)`,
      [enrollmentId],
    ))).rejects.toThrow(/Mercado Pago/i);

    // Grupo + asignación
    const group = await asAdmin((client) => client.query(
      `select public.colonia_create_group($1, 'Grupo Journey', 6, 10, 20, 'Profe') as r`,
      [seasonId],
    ));
    const groupId = group.rows[0].r.group.id;
    await asAdmin((client) => client.query(
      `select public.colonia_update_enrollment($1, null, 'confirmada', $2, null) as r`,
      [enrollmentId, groupId],
    ));

    // Asistencia presente + cambio a justificada (upsert)
    await asAdmin((client) => client.query(
      `select public.colonia_upsert_attendance($1, '2026-12-01', 'presente', 'Profe', null)`,
      [enrollmentId],
    ));
    await asAdmin((client) => client.query(
      `select public.colonia_upsert_attendance($1, '2026-12-01', 'justificada', 'Profe', 'Médico')`,
      [enrollmentId],
    ));
    const att = await query(
      `select status from public.colonia_attendance where enrollment_id = $1 and day = '2026-12-01'`,
      [enrollmentId],
    );
    expect(att.rows[0].status).toBe('justificada');

    // Actividad + autorización
    const act = await asAdmin((client) => client.query(
      `select public.colonia_create_activity($1, 'excursion', 'Salida al río', '2026-12-15', 'San Juan', null, null) as r`,
      [seasonId],
    ));
    await asAdmin((client) => client.query(
      `select public.colonia_set_authorization($1, 'excursion', true, $2, 'Responsable', null) as r`,
      [enrollmentId, act.rows[0].r.activity.id],
    ));

    const dash = await asAdmin((client) => client.query(
      `select public.colonia_dashboard_stats($1) as r`,
      [seasonId],
    ));
    expect(Number(dash.rows[0].r.enrolled)).toBeGreaterThanOrEqual(1);
    expect(Number(dash.rows[0].r.payments_confirmed)).toBeGreaterThanOrEqual(230000);

    // Aislamiento financiero
    const member = await query(`select outstanding_balance from public.members where member_number = '88001'`);
    expect(Number(member.rows[0].outstanding_balance)).toBe(70000);
    const dues = await query(`select count(*)::int as n from public.member_dues_entries`);
    expect(dues.rows[0].n).toBe(1);
    const reserva = await query(`select amount from public.reservations`);
    expect(Number(reserva.rows[0].amount)).toBe(12000);

    // Void de cargo + cancelación
    const charge = await query(
      `select id from public.colonia_charges where enrollment_id = $1 and concept = 'colonia_cuota' limit 1`,
      [enrollmentId],
    );
    await asAdmin((client) => client.query(
      `select public.colonia_void_charge($1, 'Ajuste autorizado prueba') as r`,
      [charge.rows[0].id],
    ));
    await asAdmin((client) => client.query(
      `select public.colonia_cancel_enrollment($1, 'Fin de prueba de circuito') as r`,
      [enrollmentId],
    ));
    const canceled = await query(`select status from public.colonia_enrollments where id = $1`, [enrollmentId]);
    expect(canceled.rows[0].status).toBe('cancelada');
  });

  it('rechaza cobro sin permiso (profesor / rol no autorizado)', async () => {
    const enrollment = await query(`select id from public.colonia_enrollments limit 1`);
    const charge = await query(`select id from public.colonia_charges limit 1`);
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [randomUUID()]);
      await client.query(`select set_config('jc.is_admin', 'off', true)`);

      await client.query('savepoint sp_pay');
      await expect(client.query(
        `select public.colonia_record_payment($1, 'efectivo', 1000, 'confirmed', null, null, null)`,
        [enrollment.rows[0].id],
      )).rejects.toThrow(/permiso/i);
      await client.query('rollback to savepoint sp_pay');

      await client.query('savepoint sp_void');
      await expect(client.query(
        `select public.colonia_void_charge($1, 'motivo largo suficiente')`,
        [charge.rows[0].id],
      )).rejects.toThrow(/permiso/i);
      await client.query('rollback to savepoint sp_void');

      await client.query('rollback');
    } finally {
      client.release();
    }
  });

  it('trigger bloquea tocar outstanding_balance durante colonia_tx', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [actorId]);
      await client.query(`select set_config('jc.is_admin', 'on', true)`);
      await client.query(`select set_config('jc.colonia_tx', 'on', true)`);
      await expect(client.query(
        `update public.members set outstanding_balance = 1 where member_number = '88001'`,
      )).rejects.toThrow(/outstanding_balance/i);
      await client.query('rollback');
    } finally {
      client.release();
    }
  });
});
