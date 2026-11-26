/**
 * Ajuste administrativo por período sobre PostgreSQL vacío.
 * Esquema mínimo de prueba; no lee ni escribe la base del club.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startEmbeddedPostgres, stopEmbeddedPostgres } from '../../test/embeddedPostgresHarness.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const migrationSql = readFileSync(
  join(root, 'supabase/migrations/20261125170000_dues_period_adjustments.sql'),
  'utf8',
);

const ADMIN = '11111111-1111-4111-8111-111111111111';
const EMPLOYEE = '22222222-2222-4222-8222-222222222222';
const MEMBER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let cluster;
let databaseDir;
let pool;

async function asUser(uid, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('test.uid', $1, true)`, [uid || '']);
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  const ctx = await startEmbeddedPostgres({ label: 'jockey-dues-adjust' });
  cluster = ctx.cluster;
  databaseDir = ctx.databaseDir;
  pool = ctx.pool;

  await pool.query(`
    do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
    create extension if not exists pgcrypto;
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid
    $$;

    create table public.profiles (id uuid primary key, email text, full_name text not null, role text not null);
    insert into public.profiles values
      ('${ADMIN}', 'ana@example.test', 'Ana Admin', 'admin'),
      ('${EMPLOYEE}', 'emp@example.test', 'Empleado Caja', 'admin_employee');

    create function public.current_role() returns text language sql stable as $$
      select role from public.profiles where id = auth.uid()
    $$;
    create function public.user_has_role(p text) returns boolean language sql stable as $$ select false $$;
    create function public.has_staff_access() returns boolean language sql stable as $$ select auth.uid() is not null $$;
    create function public.club_today() returns date language sql stable as $$ select date '2026-11-25' $$;

    create table public.members (
      id uuid primary key,
      member_number text,
      tier text,
      outstanding_balance numeric(14,2) not null default 0,
      meta jsonb not null default '{}'::jsonb
    );
    insert into public.members (id, member_number, tier, outstanding_balance)
      values ('${MEMBER}', '100001', 'socio_familiar', 140000);

    create table public.member_payments (
      id uuid primary key default gen_random_uuid(),
      member_id uuid not null references public.members(id),
      amount numeric(14,2) not null,
      meta jsonb not null default '{}'::jsonb
    );
    create table public.member_dues_periods (
      member_id uuid not null references public.members(id),
      due_on date not null,
      capital numeric(14,2) not null check (capital >= 0),
      capital_open numeric(14,2) not null check (capital_open >= 0),
      late_base numeric(14,2) not null default 0,
      primary key (member_id, due_on)
    );
    create table public.dues_imputations (
      id uuid primary key default gen_random_uuid(),
      payment_id uuid not null references public.member_payments(id),
      member_id uuid not null references public.members(id),
      due_on date not null,
      capital numeric(14,2) not null default 0,
      voided_at timestamptz
    );
    create table public.audit_logs (
      id uuid primary key default gen_random_uuid(),
      actor_id uuid,
      action text not null,
      entity_type text not null,
      entity_id uuid,
      payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
    insert into public.member_dues_periods values
      ('${MEMBER}', '2026-10-10', 70000, 70000, 70000),
      ('${MEMBER}', '2026-11-10', 70000, 70000, 70000),
      ('${MEMBER}', '2026-07-10', 70000, 0, 0);
    insert into public.member_payments (id, member_id, amount, meta)
      values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${MEMBER}', 70000, '{"periodDueOns":["2026-07-10"]}');
  `);
  await pool.query(migrationSql);
}, 180000);

afterAll(async () => {
  await stopEmbeddedPostgres({ pool, cluster, databaseDir });
});

const adjust = (client, due, action, capital, reason = 'Nivelación migración LILA') => client.query(
  'select public.ajustar_cuota_periodo($1, $2, $3, $4, $5) as row',
  [MEMBER, due, action, capital, reason],
);

describe('ajustar_cuota_periodo', () => {
  it('solo un administrador puede corregir', async () => {
    await expect(asUser(EMPLOYEE, (c) => adjust(c, '2026-10-10', 'set', 40000)))
      .rejects.toThrow(/Solo un administrador/);
    await expect(asUser(null, (c) => adjust(c, '2026-10-10', 'set', 40000)))
      .rejects.toThrow(/logueado/);
  });

  it('corrige el capital del mes, guarda quién y no toca el saldo de la ficha', async () => {
    const { rows } = await asUser(ADMIN, (c) => adjust(c, '2026-10-01', 'set', 40000));
    const row = rows[0].row;
    expect(row).toMatchObject({
      due_on: '2026-10-10',
      action: 'set',
      capital: 40000,
      previous_capital_open: 70000,
      created_by: ADMIN,
      created_by_name: 'Ana Admin',
    });
    const period = await pool.query(
      `select capital_open::float, late_base::float from public.member_dues_periods where member_id = $1 and due_on = '2026-10-10'`,
      [MEMBER],
    );
    expect(period.rows[0]).toEqual({ capital_open: 40000, late_base: 40000 });
    const member = await pool.query('select outstanding_balance::float as b from public.members where id = $1', [MEMBER]);
    expect(member.rows[0].b).toBe(140000);
    const audit = await pool.query(`select actor_id, payload from public.audit_logs where action = 'dues_period_adjust'`);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].actor_id).toBe(ADMIN);
    expect(audit.rows[0].payload).toMatchObject({ dueOn: '2026-10-10', capital: 40000, by: 'Ana Admin' });
  });

  it('un ajuste nuevo del mismo mes reemplaza al anterior sin borrarlo', async () => {
    await asUser(ADMIN, (c) => adjust(c, '2026-10-10', 'set', 45000));
    const all = await pool.query(
      `select capital::float, voided_at is not null as voided, void_reason from public.dues_period_adjustments
       where due_on = '2026-10-10' order by created_at, capital`,
    );
    expect(all.rows).toEqual([
      { capital: 40000, voided: true, void_reason: 'Reemplazado por un ajuste nuevo' },
      { capital: 45000, voided: false, void_reason: null },
    ]);
  });

  it('agrega un mes pasado que faltaba (nivelar la migración)', async () => {
    await asUser(ADMIN, (c) => adjust(c, '2026-08-10', 'set', 63000));
    const period = await pool.query(
      `select capital::float, capital_open::float from public.member_dues_periods where member_id = $1 and due_on = '2026-08-10'`,
      [MEMBER],
    );
    expect(period.rows[0]).toEqual({ capital: 63000, capital_open: 63000 });
  });

  it('no crea un mes que no empezó, no reabre un mes pago y exige motivo', async () => {
    await expect(asUser(ADMIN, (c) => adjust(c, '2026-12-10', 'set', 70000)))
      .rejects.toThrow(/no empezó/);
    await expect(asUser(ADMIN, (c) => adjust(c, '2026-07-10', 'set', 70000)))
      .rejects.toThrow(/ya está pago/);
    await expect(asUser(ADMIN, (c) => adjust(c, '2026-09-10', 'set', 70000, 'corto')))
      .rejects.toThrow(/motivo/);
    await expect(asUser(ADMIN, (c) => adjust(c, '2026-09-10', 'set', 0)))
      .rejects.toThrow(/mayor que cero/);
  });

  it('marca un mes como no adeudado', async () => {
    await asUser(ADMIN, (c) => adjust(c, '2026-11-10', 'remove', null, 'Noviembre bonificado por comisión'));
    const period = await pool.query(
      `select capital_open::float from public.member_dues_periods where member_id = $1 and due_on = '2026-11-10'`,
      [MEMBER],
    );
    expect(period.rows[0].capital_open).toBe(0);
  });
});

describe('el cobro lleva el ajuste', () => {
  it('el servidor escribe el ajuste en el pago y lo marca como cobrado', async () => {
    const pay = await pool.query(
      `insert into public.member_payments (member_id, amount, meta)
       values ($1, 49500, '{"periodDueOns":["2026-10-10"],"periodAdjustments":[{"id":"x","capital":1}]}')
       returning id, meta`,
      [MEMBER],
    );
    const adjustments = pay.rows[0].meta.periodAdjustments;
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]).toMatchObject({ dueOn: '2026-10-10', capital: 45000, by: 'Ana Admin' });
    const applied = await pool.query(
      `select applied_payment_ids from public.dues_period_adjustments where id = $1`,
      [adjustments[0].id],
    );
    expect(applied.rows[0].applied_payment_ids).toEqual([pay.rows[0].id]);
  });

  it('el navegador no puede inventar un ajuste en un mes sin ajuste', async () => {
    const pay = await pool.query(
      `insert into public.member_payments (member_id, amount, meta)
       values ($1, 1, '{"periodDueOns":["2026-09-10"],"periodAdjustments":[{"id":"x","capital":1}]}')
       returning meta`,
      [MEMBER],
    );
    expect(pay.rows[0].meta.periodAdjustments).toBeUndefined();
  });
});

describe('anular_ajuste_cuota_periodo', () => {
  it('no anula un ajuste ya cobrado', async () => {
    const id = (await pool.query(
      `select id from public.dues_period_adjustments where due_on = '2026-10-10' and voided_at is null`,
    )).rows[0].id;
    await expect(asUser(ADMIN, (c) => c.query(
      'select public.anular_ajuste_cuota_periodo($1, $2)', [id, 'Me equivoqué de mes'],
    ))).rejects.toThrow(/ya se cobró/);
  });

  it('anula y el mes vuelve a como estaba', async () => {
    const id = (await pool.query(
      `select id from public.dues_period_adjustments where due_on = '2026-11-10' and voided_at is null`,
    )).rows[0].id;
    await expect(asUser(EMPLOYEE, (c) => c.query(
      'select public.anular_ajuste_cuota_periodo($1, $2)', [id, 'Me equivoqué de mes'],
    ))).rejects.toThrow(/Solo un administrador/);
    const { rows } = await asUser(ADMIN, (c) => c.query(
      'select public.anular_ajuste_cuota_periodo($1, $2) as row', [id, 'Me equivoqué de mes'],
    ));
    expect(rows[0].row).toMatchObject({ voided_by_name: 'Ana Admin', void_reason: 'Me equivoqué de mes' });
    const period = await pool.query(
      `select capital_open::float from public.member_dues_periods where member_id = $1 and due_on = '2026-11-10'`,
      [MEMBER],
    );
    expect(period.rows[0].capital_open).toBe(70000);

    const added = (await pool.query(
      `select id from public.dues_period_adjustments where due_on = '2026-08-10' and voided_at is null`,
    )).rows[0].id;
    await asUser(ADMIN, (c) => c.query('select public.anular_ajuste_cuota_periodo($1, $2)', [added, 'Agosto no correspondía']));
    const gone = await pool.query(
      `select count(*)::int as n from public.member_dues_periods where member_id = $1 and due_on = '2026-08-10'`,
      [MEMBER],
    );
    expect(gone.rows[0].n).toBe(0);
  });
});
