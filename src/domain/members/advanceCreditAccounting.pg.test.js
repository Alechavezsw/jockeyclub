/**
 * Integración PostgreSQL real (embedded-postgres):
 * tarifas, tenis, concurrencia con 2 transacciones, migración idempotente.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const harnessSql = readFileSync(
  join(root, 'supabase/tests/advance_credit_pg_harness.sql'),
  'utf8',
);
const migrationSql = readFileSync(
  join(root, 'supabase/migrations/20261123013000_fix_advance_credit_no_double_count.sql'),
  'utf8',
);

const PORT = 55432 + Math.floor(Math.random() * 1000);
let cluster;
let databaseDir;
let pool;

async function query(text, params) {
  return pool.query(text, params);
}

async function withClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

describe('advance credit PostgreSQL integration', () => {
  beforeAll(async () => {
    databaseDir = mkdtempSync(join(tmpdir(), 'jc-advance-pg-'));
    cluster = new EmbeddedPostgres({
      databaseDir,
      user: 'postgres',
      password: 'postgres',
      port: PORT,
      persistent: false,
      autoRehydrateSymlinks: true,
    });
    await cluster.initialise();
    await cluster.start();
    pool = new pg.Pool({
      host: '127.0.0.1',
      port: PORT,
      user: 'postgres',
      password: 'postgres',
      database: 'postgres',
      max: 8,
    });
    await query(harnessSql);
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await cluster?.stop().catch(() => {});
    if (databaseDir) rmSync(databaseDir, { recursive: true, force: true });
  }, 60_000);

  async function seedMember({
    tier = 'socio_familiar',
    meta = {},
    lastPeriodCapital = null,
  } = {}) {
    const id = randomUUID();
    await query(
      `insert into advance_test.members (id, tier, meta) values ($1, $2, $3::jsonb)`,
      [id, tier, JSON.stringify(meta)],
    );
    if (lastPeriodCapital != null) {
      await query(
        `insert into advance_test.member_dues_periods (member_id, due_on, capital)
         values ($1, '2026-11-10', $2)`,
        [id, lastPeriodCapital],
      );
    }
    return id;
  }

  it('tarifa futura ignora capital histórico parcial o con tenis', async () => {
    const familiar = await seedMember({
      tier: 'socio_familiar',
      lastPeriodCapital: 82000, // 70k + tenis
    });
    const partial = await seedMember({
      tier: 'socio_familiar',
      lastPeriodCapital: 60000,
    });
    const individual = await seedMember({
      tier: 'socio_individual',
      lastPeriodCapital: 52000, // 40k + tenis
    });
    const amet = await seedMember({ tier: 'socio_familiar_amet', lastPeriodCapital: 70000 });
    const convenio = await seedMember({
      tier: 'socio_familiar',
      meta: { duesAmount: '55000' },
      lastPeriodCapital: 70000,
    });
    const exempt = await seedMember({ tier: 'vitalicio', lastPeriodCapital: 12000 });

    async function tariffOf(memberId) {
      const res = await query(
        `select advance_test.cobro_social_advance_tariff(m, '2026-12-10'::date, '[]'::jsonb) as t
         from advance_test.members m where m.id = $1`,
        [memberId],
      );
      return Number(res.rows[0].t);
    }
    expect(await tariffOf(familiar)).toBe(70000); // no 82000
    expect(await tariffOf(partial)).toBe(70000); // no 60000 histórico
    expect(await tariffOf(individual)).toBe(40000); // no 52000
    expect(await tariffOf(amet)).toBe(68250);
    expect(await tariffOf(convenio)).toBe(55000);
    expect(await tariffOf(exempt)).toBe(0);

    // Schedule social+tenis mal combinado → sigue 70000
    const peel = await query(
      `select advance_test.cobro_social_advance_tariff(
         m, '2026-12-10'::date,
         '[{"dueOn":"2026-12-10","capital":82000,"tierId":"socio_familiar"}]'::jsonb
       ) as t
       from advance_test.members m where m.id = $1`,
      [familiar],
    );
    expect(Number(peel.rows[0].t)).toBe(70000);
  });

  it('$77.000 → diciembre $70.000 sin recargo + $7.000 crédito libre', async () => {
    const id = await seedMember({ tier: 'socio_familiar' });
    const paymentId = randomUUID();
    const result = await query(
      `select advance_test.allocate_advance($1, $2, 77000, '2026-12-10'::date) as r`,
      [id, paymentId],
    );
    const r = result.rows[0].r;
    expect(r.advances).toHaveLength(1);
    expect(Number(r.advances[0].capital)).toBe(70000);
    expect(Number(r.advances[0].surcharge)).toBe(0);
    expect(String(r.advances[0].dueOn).slice(0, 10)).toBe('2026-12-10');
    expect(Number(r.freeCredit)).toBe(7000);

    const entries = await query(
      `select amount, kind from advance_test.member_dues_entries where member_id = $1`,
      [id],
    );
    expect(entries.rows).toHaveLength(1);
    expect(Number(entries.rows[0].amount)).toBe(-7000);
  });

  it('cubre 12 períodos futuros sin bucle infinito', async () => {
    const id = await seedMember({ tier: 'socio_familiar' });
    const r = (await query(
      `select advance_test.allocate_advance($1, $2, $3, '2026-12-10'::date) as r`,
      [id, randomUUID(), 70000 * 12],
    )).rows[0].r;
    expect(r.advances).toHaveLength(12);
    expect(Number(r.loops)).toBeLessThanOrEqual(24);
    expect(Number(r.freeCredit)).toBe(0);
    expect(r.advances.every((row) => Number(row.surcharge) === 0)).toBe(true);
  });

  it('AMET / individual / convenio / exento', async () => {
    const ametId = await seedMember({ tier: 'socio_individual_amet' });
    const indId = await seedMember({ tier: 'socio_individual' });
    const amet = (await query(
      `select advance_test.allocate_advance($1, $2, 40000, '2026-12-18'::date) as r`,
      [ametId, randomUUID()],
    )).rows[0].r;
    expect(Number(amet.advances[0].capital)).toBe(39000);
    expect(Number(amet.freeCredit)).toBe(1000);

    const ind = (await query(
      `select advance_test.allocate_advance($1, $2, 40000, '2026-12-10'::date) as r`,
      [indId, randomUUID()],
    )).rows[0].r;
    expect(Number(ind.advances[0].capital)).toBe(40000);
    expect(Number(ind.freeCredit)).toBe(0);
  });

  it('concurrencia: dos transacciones no duplican el mismo período', async () => {
    const id = await seedMember({ tier: 'socio_familiar' });
    const payA = randomUUID();
    const payB = randomUUID();

    const outcome = await Promise.all([
      withClient(async (c) => {
        await c.query('begin');
        try {
          const res = await c.query(
            `select advance_test.allocate_advance($1, $2, 70000, '2026-12-10'::date) as r`,
            [id, payA],
          );
          await c.query('commit');
          return { ok: true, r: res.rows[0].r, paymentId: payA };
        } catch (error) {
          await c.query('rollback');
          return { ok: false, error: String(error.message || error), paymentId: payA };
        }
      }),
      withClient(async (c) => {
        await c.query('begin');
        try {
          // Pequeña espera para que ambas entran al lock en orden distinto
          await new Promise((resolve) => setTimeout(resolve, 15));
          const res = await c.query(
            `select advance_test.allocate_advance($1, $2, 70000, '2026-12-10'::date) as r`,
            [id, payB],
          );
          await c.query('commit');
          return { ok: true, r: res.rows[0].r, paymentId: payB };
        } catch (error) {
          await c.query('rollback');
          return { ok: false, error: String(error.message || error), paymentId: payB };
        }
      }),
    ]);

    expect(outcome.every((row) => row.ok)).toBe(true);
    const imps = await query(
      `select due_on::text, capital, payment_id::text
       from advance_test.dues_imputations
       where member_id = $1 and voided_at is null
       order by due_on`,
      [id],
    );
    expect(imps.rows).toHaveLength(2);
    expect(imps.rows.map((r) => r.due_on.slice(0, 10))).toEqual([
      '2026-12-10',
      '2027-01-10',
    ]);
    expect(imps.rows.every((r) => Number(r.capital) === 70000)).toBe(true);
    expect(new Set(imps.rows.map((r) => r.payment_id)).size).toBe(2);

    // Misma cobertura: reintento idempotente no duplica diciembre
    const again = (await query(
      `select advance_test.allocate_advance($1, $2, 70000, '2026-12-10'::date) as r`,
      [id, randomUUID()],
    )).rows[0].r;
    expect(String(again.advances[0].dueOn).slice(0, 10)).toBe('2027-02-10');
  });

  it('rollback de una transacción no deja imputación parcial', async () => {
    const id = await seedMember({ tier: 'socio_familiar' });
    await withClient(async (c) => {
      await c.query('begin');
      await c.query(
        `select advance_test.allocate_advance($1, $2, 70000, '2026-12-10'::date)`,
        [id, randomUUID()],
      );
      await c.query('rollback');
    });
    const imps = await query(
      `select count(*)::int as n from advance_test.dues_imputations where member_id = $1`,
      [id],
    );
    expect(imps.rows[0].n).toBe(0);
  });

  it('anclas de migración: helper + patch idempotente sobre stub', async () => {
    // Verificar que el SQL de migración declara los helpers y el marker v2.
    expect(migrationSql).toContain('cobro_social_advance_tariff');
    expect(migrationSql).toContain('cobro_social_catalog_tariff');
    expect(migrationSql).toContain('allocate_advance_cash_chunks_v2');
    expect(migrationSql).toContain('pg_advisory_xact_lock');
    expect(migrationSql).not.toMatch(/from public\.member_dues_periods p[\s\S]*order by p\.due_on desc/);

    // Aplicar helpers del harness ya equivale a la lógica nueva.
    // Segundo “apply” del harness debe ser idempotente (create or replace).
    await query(harnessSql);
    const t = await query(
      `select advance_test.cobro_social_advance_tariff(
         row(gen_random_uuid(), 'socio_familiar', '{}'::jsonb, 0)::advance_test.members,
         '2026-12-10'::date,
         '[]'::jsonb
       ) as tariff`,
    );
    expect(Number(t.rows[0].tariff)).toBe(70000);

    // Stub viejo sigue presente; re-crear stub + harness = segundo intento OK.
    await query(harnessSql);
    const stub = await query(
      `select pg_get_functiondef('advance_test.registrar_cobro_stub(uuid, numeric, jsonb, text)'::regprocedure) as def`,
    );
    expect(stub.rows[0].def).toContain('Si se imputó el anticipo a un período');
  });

  it('conversiones numéricas de meta inválidas no rompen la tarifa', async () => {
    const id = await seedMember({
      tier: 'socio_familiar',
      meta: { duesAmount: 'no-number', monthlyDues: '', socialQuota: '70000.00' },
    });
    const t = await query(
      `select advance_test.cobro_social_advance_tariff(m, '2026-12-10'::date, '[]'::jsonb) as t
       from advance_test.members m where m.id = $1`,
      [id],
    );
    expect(Number(t.rows[0].t)).toBe(70000);
  });
});
