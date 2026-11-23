/**
 * Aplica la migración completa 20261123013000 sobre una copia aislada del
 * esquema (tablas, tipos, triggers y ancla real de registrar_cobro).
 * No toca producción ni filas históricas.
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
const schemaSql = readFileSync(join(root, 'supabase/tests/prod_schema_slice.sql'), 'utf8');
const migrationSql = readFileSync(
  join(root, 'supabase/migrations/20261123013000_fix_advance_credit_no_double_count.sql'),
  'utf8',
);

const PORT = 56432 + Math.floor(Math.random() * 800);
let cluster;
let databaseDir;
let pool;
let triggersBefore = [];

async function query(text, params) {
  return pool.query(text, params);
}

function triggerNames(rows) {
  return rows.map((r) => r.name).sort();
}

describe('migración de anticipos sobre esquema aislado', () => {
  beforeAll(async () => {
    databaseDir = mkdtempSync(join(tmpdir(), 'jc-advance-schema-'));
    cluster = new EmbeddedPostgres({
      databaseDir,
      user: 'postgres',
      password: 'postgres',
      port: PORT,
      persistent: false,
      autoRehydrateSymlinks: true,
      initdbFlags: ['--encoding=UTF8', '--locale=C'],
    });
    await cluster.initialise();
    await cluster.start();
    pool = new pg.Pool({
      host: '127.0.0.1',
      port: PORT,
      user: 'postgres',
      password: 'postgres',
      database: 'postgres',
      max: 6,
    });
    await query(schemaSql);
    const before = await query(`
      select c.relname || '.' || t.tgname as name
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not t.tgisinternal
    `);
    triggersBefore = triggerNames(before.rows);
    await query(migrationSql);
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await cluster?.stop().catch(() => {});
    if (databaseDir) rmSync(databaseDir, { recursive: true, force: true });
  }, 90_000);

  async function seed(tier, meta = {}) {
    const id = randomUUID();
    await query(
      `insert into public.members (id, member_number, full_name, tier, status, outstanding_balance, meta)
       values ($1, $2, $3, $4, 'active', 0, $5::jsonb)`,
      [id, 'T-1', 'Socio prueba', tier, JSON.stringify(meta)],
    );
    return id;
  }

  it('parcha el ancla, conserva triggers y deja el execute en authenticated', async () => {
    const def = await query(
      `select pg_get_functiondef('public.registrar_cobro(uuid, numeric, jsonb, text)'::regprocedure) as def`,
    );
    expect(def.rows[0].def).toContain('allocate_advance_cash_chunks_v2');
    expect(def.rows[0].def).not.toContain('no registrar un segundo crédito libre');

    const catalog = await query(
      `select pg_get_functiondef('public.cobro_social_catalog_tariff(public.members)'::regprocedure) as def`,
    );
    expect(catalog.rows[0].def).toContain('return null;');
    expect(catalog.rows[0].def).not.toMatch(/return 70000;\s*end;/);

    const after = await query(`
      select c.relname || '.' || t.tgname as name
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not t.tgisinternal
    `);
    expect(triggerNames(after.rows)).toEqual(triggersBefore);
    expect(triggersBefore).toEqual([
      'dues_imputations.trg_sync_lila_parts_after_imputations',
      'member_dues_periods.trg_sync_dues_open_snapshot',
      'member_payments.member_payments_stamp_tenis_scope',
      'member_payments.trg_member_payment_posts_dues',
      'member_payments.trg_member_payments_idempotency_key',
      'member_payments.trg_reject_waived_surcharge',
      'member_payments.trg_zz_sync_member_due_dates_from_receipt',
      'members.members_updated_at',
      'members.trg_member_dues_balance',
      'members.trg_preserve_verified_member_tenure',
      'members.trg_reject_member_privileged_columns',
      'members.trg_stash_member_card_number',
      'members.trg_zero_exempt_member_dues',
    ]);

    const priv = await query(`
      select
        has_function_privilege('public', 'public.registrar_cobro(uuid, numeric, jsonb, text)', 'execute') as public_exec,
        has_function_privilege('authenticated', 'public.registrar_cobro(uuid, numeric, jsonb, text)', 'execute') as auth_exec,
        has_function_privilege('service_role', 'public.cobro_social_advance_tariff(public.members, date, jsonb)', 'execute') as svc_exec,
        has_function_privilege('public', 'public.cobro_social_catalog_tariff(public.members)', 'execute') as catalog_public
    `);
    expect(priv.rows[0].public_exec).toBe(false);
    expect(priv.rows[0].auth_exec).toBe(true);
    expect(priv.rows[0].svc_exec).toBe(true);
    expect(priv.rows[0].catalog_public).toBe(false);
  });

  it('el segundo apply es idempotente y no duplica el parche', async () => {
    await query(migrationSql);
    const def = await query(
      `select pg_get_functiondef('public.registrar_cobro(uuid, numeric, jsonb, text)'::regprocedure) as def`,
    );
    const hits = def.rows[0].def.split('allocate_advance_cash_chunks_v2').length - 1;
    expect(hits).toBe(1);
  });

  it('rechaza anticipo social en categorías sin tarifario y no deja filas', async () => {
    for (const tier of ['sin_categoria', 'liga_no_socio', 'turf', 'abono_tenis', '']) {
      const id = await seed(tier, { duesAmount: '70000' });
      await expect(query(
        `select public.registrar_cobro($1, 70000, '{}'::jsonb, $2)`,
        [id, randomUUID()],
      )).rejects.toThrow(/tarifa social oficial/i);
      const left = await query(
        `select
           (select count(*)::int from public.member_payments where member_id = $1) as payments,
           (select count(*)::int from public.dues_imputations where member_id = $1) as imps,
           (select count(*)::int from public.member_dues_entries where member_id = $1) as credits`,
        [id],
      );
      expect(left.rows[0]).toEqual({ payments: 0, imps: 0, credits: 0 });
    }
  });

  it('capital de schedule inválido no aborta: usa el tarifario oficial', async () => {
    const id = await seed('socio_familiar');
    const tariff = await query(
      `select public.cobro_social_advance_tariff(m, '2026-12-10'::date, $2::jsonb) as t
       from public.members m where m.id = $1`,
      [id, JSON.stringify([
        { dueOn: '2026-12-10', capital: 'no-es-numero' },
        { dueOn: '2026-12-10', capital: '1e5' },
        { dueOn: '2026-12-10', capital: '' },
        { dueOn: '2026-12-10', capital: '82.000' },
        { dueOn: '2026-12-10', tierId: 'abono_tenis', capital: '12000' },
      ])],
    );
    expect(Number(tariff.rows[0].t)).toBe(70000);

    const peeled = await query(
      `select public.cobro_social_advance_tariff(m, '2026-12-10'::date, $2::jsonb) as t
       from public.members m where m.id = $1`,
      [id, JSON.stringify([{ dueOn: '2026-12-10', capital: '82000' }])],
    );
    expect(Number(peeled.rows[0].t)).toBe(70000);

    await query(
      `select public.registrar_cobro($1, 70000, $2::jsonb, $3)`,
      [id, JSON.stringify({
        schedule: [{ dueOn: '2026-12-10', capital: 'no-es-numero' }],
      }), randomUUID()],
    );
    const imps = await query(
      `select capital::float8 as capital from public.dues_imputations where member_id = $1`,
      [id],
    );
    expect(imps.rows.map((r) => Number(r.capital))).toEqual([70000]);
  });

  it('dos cobros concurrentes imputan meses distintos y el rollback no deja filas', async () => {
    const id = await seed('socio_familiar');
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      await Promise.all([c1, c2].map(async (client, index) => {
        await client.query('begin');
        try {
          if (index === 1) await new Promise((resolve) => setTimeout(resolve, 30));
          await client.query(
            `select public.registrar_cobro($1, 70000, '{}'::jsonb, $2)`,
            [id, randomUUID()],
          );
          await client.query('commit');
        } catch (error) {
          await client.query('rollback');
          throw error;
        }
      }));
    } finally {
      c1.release();
      c2.release();
    }

    const dues = await query(
      `select due_on::text as due_on, capital::float8 as capital
       from public.dues_imputations
       where member_id = $1
       order by due_on`,
      [id],
    );
    expect(dues.rows).toHaveLength(2);
    expect(new Set(dues.rows.map((r) => r.due_on)).size).toBe(2);
    expect(dues.rows.map((r) => Number(r.capital))).toEqual([70000, 70000]);

    const c3 = await pool.connect();
    try {
      await c3.query('begin');
      await c3.query(`select public.registrar_cobro($1, 70000, '{}'::jsonb, $2)`, [id, randomUUID()]);
      await c3.query('rollback');
    } finally {
      c3.release();
    }
    const afterRollback = await query(
      `select count(*)::int as n from public.dues_imputations where member_id = $1`,
      [id],
    );
    expect(afterRollback.rows[0].n).toBe(2);

    const key = randomUUID();
    const first = await query(
      `select public.registrar_cobro($1, 70000, '{}'::jsonb, $2) as r`,
      [id, key],
    );
    const second = await query(
      `select public.registrar_cobro($1, 70000, '{}'::jsonb, $2) as r`,
      [id, key],
    );
    expect(first.rows[0].r.idempotent).toBe(false);
    expect(second.rows[0].r.idempotent).toBe(true);
    const payments = await query(
      `select count(*)::int as n from public.member_payments where member_id = $1 and idempotency_key = $2`,
      [id, key],
    );
    expect(payments.rows[0].n).toBe(1);
  }, 20_000);
});
