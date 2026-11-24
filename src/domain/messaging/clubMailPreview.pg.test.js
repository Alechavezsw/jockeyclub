/**
 * Permisos de la revisión de comunicados, en una base vacía.
 * No toca producción.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const migrationSql = readFileSync(
  join(root, 'supabase/migrations/20261124013000_club_mail_preview.sql'),
  'utf8',
);
const PORT = 57640 + Math.floor(Math.random() * 400);
let cluster;
let databaseDir;
let pool;

async function query(text, params) {
  return pool.query(text, params);
}

beforeAll(async () => {
  databaseDir = mkdtempSync(join(tmpdir(), 'jockey-mail-preview-'));
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
    max: 2,
  });
  await query(`
    do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
    create or replace function public.has_staff_access() returns boolean language sql stable as $$ select false $$;
  `);
  await query(migrationSql);
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await cluster?.stop();
  if (databaseDir) {
    try {
      rmSync(databaseDir, { recursive: true, force: true });
    } catch {
      /* Windows puede retener el directorio un instante. */
    }
  }
});

describe('permisos de la revisión de mail', () => {
  it('anon y authenticated no pueden escribir la revisión ni la campaña', async () => {
    const anon = await query(`
      select
        has_table_privilege('anon', 'public.club_mail_previews', 'select') as anon_select,
        has_table_privilege('anon', 'public.club_mail_previews', 'insert') as anon_insert,
        has_table_privilege('authenticated', 'public.club_mail_previews', 'select') as auth_select,
        has_table_privilege('authenticated', 'public.club_mail_previews', 'insert') as auth_insert,
        has_table_privilege('authenticated', 'public.club_mail_previews', 'update') as auth_update,
        has_table_privilege('service_role', 'public.club_mail_campaigns', 'insert') as service_insert
    `);
    expect(anon.rows[0]).toEqual({
      anon_select: false,
      anon_insert: false,
      auth_select: true,
      auth_insert: false,
      auth_update: false,
      service_insert: true,
    });
  });

  it('una revisión solo se consume una vez', async () => {
    const inserted = await query(`
      insert into public.club_mail_previews (
        audience, subject, body_sha256, audience_sha256, counts, expires_at
      ) values (
        'all', 'Aviso', 'body', 'audience', '{"recipients": 1}'::jsonb, now() + interval '30 minutes'
      ) returning id
    `);
    const id = inserted.rows[0].id;
    const first = await query(
      `update public.club_mail_previews
       set consumed_at = now(), campaign_id = $2
       where id = $1 and consumed_at is null
       returning id`,
      [id, '11111111-1111-1111-1111-111111111111'],
    );
    const second = await query(
      `update public.club_mail_previews
       set consumed_at = now(), campaign_id = $2
       where id = $1 and consumed_at is null
       returning id`,
      [id, '22222222-2222-2222-2222-222222222222'],
    );
    expect(first.rowCount).toBe(1);
    expect(second.rowCount).toBe(0);
  });
});
