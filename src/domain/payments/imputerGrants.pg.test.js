/**
 * Permisos del imputador sobre PostgreSQL vacío.
 * No lee ni escribe la base del club.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startEmbeddedPostgres, stopEmbeddedPostgres } from '../../test/embeddedPostgresHarness.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const grantSql = readFileSync(
  join(root, 'supabase/migrations/20261123210000_imputer_execute_service_only.sql'),
  'utf8',
);
const signature = 'public.impute_dues_account_payment(uuid,uuid,numeric,jsonb,date)';

let cluster;
let databaseDir;
let pool;

function query(text, params) {
  return pool.query(text, params);
}

beforeAll(async () => {
  const ctx = await startEmbeddedPostgres({ label: 'jockey-imputer-grants' });
  cluster = ctx.cluster;
  databaseDir = ctx.databaseDir;
  pool = ctx.pool;

  await query(`
    do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
    grant usage on schema public to anon, authenticated, service_role;

    create or replace function public.impute_dues_account_payment(
      p_member_id uuid,
      p_payment_id uuid,
      p_cash numeric,
      p_schedule jsonb,
      p_paid date
    ) returns numeric
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    begin
      return 7;
    end;
    $fn$;

    grant execute on function ${signature} to public, anon, authenticated, service_role;

    create or replace function public.caja_imputa_por_trigger()
    returns numeric
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    begin
      return public.impute_dues_account_payment(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        1,
        '[]'::jsonb,
        current_date
      );
    end;
    $fn$;
    grant execute on function public.caja_imputa_por_trigger() to authenticated, service_role;
  `);
  await query(grantSql);
}, 120000);

afterAll(async () => {
  await stopEmbeddedPostgres({ pool, cluster, databaseDir });
});

describe('permisos de impute_dues_account_payment', () => {
  it('anon y authenticated no pueden ejecutarlo; service_role sí', async () => {
    const anon = await query(`select has_function_privilege('anon', '${signature}', 'execute') as ok`);
    const user = await query(`select has_function_privilege('authenticated', '${signature}', 'execute') as ok`);
    const service = await query(`select has_function_privilege('service_role', '${signature}', 'execute') as ok`);
    expect(anon.rows[0].ok).toBe(false);
    expect(user.rows[0].ok).toBe(false);
    expect(service.rows[0].ok).toBe(true);
  });

  it('un socio no imputa otra cuenta, y la caja sí entra por una función definer', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role authenticated');
      await client.query('savepoint member_denied');
      await expect(client.query(`
        select public.impute_dues_account_payment(
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          40000, '[]'::jsonb, current_date
        )
      `)).rejects.toThrow(/permission denied/i);
      await client.query('rollback to savepoint member_denied');
      const viaCaja = await client.query('select public.caja_imputa_por_trigger() as applied');
      expect(Number(viaCaja.rows[0].applied)).toBe(7);
      await client.query('rollback');
    } finally {
      await client.query('rollback').catch(() => {});
      client.release();
    }
  });

  it('service_role puede llamarlo y anon no', async () => {
    const service = await pool.connect();
    const anon = await pool.connect();
    try {
      await service.query('begin');
      await service.query('set local role service_role');
      const applied = await service.query(`
        select public.impute_dues_account_payment(
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          1, '[]'::jsonb, current_date
        ) as applied
      `);
      expect(Number(applied.rows[0].applied)).toBe(7);
      await service.query('rollback');

      await anon.query('begin');
      await anon.query('set local role anon');
      await expect(anon.query(`
        select public.impute_dues_account_payment(
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          1, '[]'::jsonb, current_date
        )
      `)).rejects.toThrow(/permission denied/i);
      await anon.query('rollback');
    } finally {
      await service.query('rollback').catch(() => {});
      await anon.query('rollback').catch(() => {});
      service.release();
      anon.release();
    }
  });
});
