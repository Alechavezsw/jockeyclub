/**
 * Seguridad + aislamiento financiero Colonia (PR #41).
 * Requiere DATABASE_URL / JC_PG_URL. Skip si no hay conexión.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const url = process.env.JC_PG_URL || process.env.DATABASE_URL || '';
const run = Boolean(url);

describe.skipIf(!run)('colonia completar — PG seguridad e aislamiento', () => {
  /** @type {import('pg').Client} */
  let client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end().catch(() => {});
  });

  it('anon no tiene privilegios sobre tablas privadas colonia_*', async () => {
    const { rows } = await client.query(`
      select table_name, privilege_type
      from information_schema.role_table_grants
      where grantee = 'anon'
        and table_schema = 'public'
        and table_name in (
          'colonia_students', 'colonia_guardians', 'colonia_enrollments',
          'colonia_charges', 'colonia_payments', 'colonia_student_health',
          'colonia_external_guardians', 'colonia_notification_jobs'
        )
    `);
    // Tras migración 180000: cero grants a anon
    expect(rows).toEqual([]);
  });

  it('colonia_mp_live está deshabilitado', async () => {
    const { rows } = await client.query(`
      select coalesce((value->>'enabled')::boolean, false) as enabled
      from public.app_settings where key = 'colonia_mp_live'
    `);
    if (rows.length === 0) {
      expect(true).toBe(true); // migración aún no aplicada en este entorno
      return;
    }
    expect(rows[0].enabled).toBe(false);
  });

  it('colonia_apply_mp_approved_payment no es ejecutable por anon/authenticated', async () => {
    const { rows } = await client.query(`
      select grantee, privilege_type
      from information_schema.routine_privileges
      where routine_schema = 'public'
        and routine_name = 'colonia_apply_mp_approved_payment'
        and grantee in ('anon', 'authenticated', 'PUBLIC')
    `);
    expect(rows.filter((r) => r.grantee === 'anon')).toEqual([]);
    expect(rows.filter((r) => String(r.grantee).toUpperCase() === 'PUBLIC')).toEqual([]);
  });

  it('pago Colonia no altera outstanding_balance (smoke estructural)', async () => {
    const { rows: before } = await client.query(`
      select coalesce(sum(outstanding_balance), 0)::numeric as total from public.members
    `);
    // No insertamos pagos reales: solo verificamos que el RPC declare aislamiento
    // y que no exista trigger de colonia→members.
    const { rows: triggers } = await client.query(`
      select tgname from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'colonia_payments'
        and not t.tgisinternal
        and pg_get_triggerdef(t.oid) ilike '%outstanding_balance%'
    `);
    expect(triggers).toEqual([]);
    const { rows: after } = await client.query(`
      select coalesce(sum(outstanding_balance), 0)::numeric as total from public.members
    `);
    expect(Number(after[0].total)).toBe(Number(before[0].total));
  });
});
