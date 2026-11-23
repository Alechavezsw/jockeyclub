/**
 * Migración de visibilidad sobre una base vacía. No toca producción.
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
const migrationSql = readFileSync(
  join(root, 'supabase/migrations/20261123120000_inactive_members_operational_split.sql'),
  'utf8',
);

const PORT = 57432 + Math.floor(Math.random() * 800);
let cluster;
let databaseDir;
let pool;

const schemaSql = `
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

do $$ begin
  create type public.member_status as enum ('active', 'suspended', 'inactive', 'pending');
exception when duplicate_object then null;
end $$;

create table if not exists public.members (
  id uuid primary key,
  profile_id uuid,
  member_number text,
  card_number text,
  card_last4 text,
  full_name text,
  phone text,
  email text,
  tier text,
  status public.member_status default 'active',
  outstanding_balance numeric(14,2) default 0,
  next_due_date date,
  overdue_since date,
  document_number text,
  document_type text,
  joined_at date,
  birth_date date,
  photo_url text,
  disciplines text[],
  meta jsonb default '{}'::jsonb
);

create table if not exists public.profiles (
  id uuid primary key,
  document_number text,
  email text
);

create table if not exists public.member_lookup_rate (
  client_key text primary key,
  window_start timestamptz not null default now(),
  hits integer not null default 0
);

create table if not exists public.portal_access_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  member_id uuid,
  member_number text
);

create table if not exists public.role_capabilities (
  capability text not null,
  role_key text not null,
  primary key (capability, role_key)
);

create table if not exists public.member_payments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members(id),
  amount numeric(14,2) not null
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  member_id uuid,
  member_name text
);

create table if not exists public.reservation_waitlist (
  id uuid primary key default gen_random_uuid(),
  member_id uuid
);

create table if not exists public.access_logs (
  id uuid primary key default gen_random_uuid(),
  member_id uuid
);

create table if not exists public.guest_passes (
  id text primary key,
  host_member_id uuid,
  host_member_number text,
  guest_name text,
  payload text
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_name text,
  recipient_key text,
  subject text,
  body text,
  meta jsonb default '{}'::jsonb
);

create or replace function public.has_staff_access() returns boolean language sql stable as $$ select false $$;
create or replace function public.has_admin_access() returns boolean language sql stable as $$ select false $$;
create or replace function public.has_capability(p_capability text) returns boolean language sql stable as $$ select false $$;
create or replace function public.lookup_client_ip() returns text language sql stable as $$ select 'test-client' $$;
`;

async function query(text, params) {
  return pool.query(text, params);
}

describe('migración de socios inactivos', () => {
  beforeAll(async () => {
    databaseDir = mkdtempSync(join(tmpdir(), 'jc-inactive-'));
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
      max: 4,
    });
    await query(schemaSql);
    await query(migrationSql);
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await cluster?.stop().catch(() => {});
    if (databaseDir) rmSync(databaseDir, { recursive: true, force: true });
  }, 60_000);

  async function seed(status, name, extra = {}) {
    const id = randomUUID();
    await query(
      `insert into public.members (id, member_number, full_name, document_number, status, outstanding_balance, meta)
       values ($1, $2, $3, $4, $5::public.member_status, $6, $7::jsonb)`,
      [
        id,
        extra.number || '10009',
        name,
        extra.document || '30111222',
        status,
        extra.balance ?? 70000,
        JSON.stringify(extra.meta || {}),
      ],
    );
    return id;
  }

  it('separa padrón, reactivar y no deja escribir cargos nuevos', async () => {
    const live = await seed('active', 'Ana Activa', { number: '10009', document: '30111222', balance: 70000 });
    const gone = await seed('inactive', 'Daniela Rojas', {
      number: '3368',
      document: '29507901',
      balance: 140000,
      meta: { bajaFecha: '2026-10-01', bajaMotivo: 'Renuncia', bajaActorName: 'Secretaría' },
    });
    const scheduled = await seed('inactive', 'Baja Programada', {
      number: '10800',
      document: '40111000',
      meta: { bajaFecha: '2099-01-01' },
    });

    const flags = await query(
      `select id::text, public.member_is_operational(m) as operational,
              public.member_is_reactivatable(m) as reactivate
       from public.members m`,
    );
    const byId = Object.fromEntries(flags.rows.map((row) => [row.id, row]));
    expect(byId[live].operational).toBe(true);
    expect(byId[live].reactivate).toBe(false);
    expect(byId[gone].operational).toBe(false);
    expect(byId[gone].reactivate).toBe(true);
    expect(byId[scheduled].operational).toBe(true);
    expect(byId[scheduled].reactivate).toBe(false);

    const found = await query(`select full_name from public.search_members_lookup('Ana', 8)`);
    expect(found.rows.map((row) => row.full_name)).toEqual(['Ana Activa']);
    const hidden = await query(`select full_name from public.search_members_lookup('Daniela', 8)`);
    expect(hidden.rows).toHaveLength(0);

    await expect(query(
      `select * from public.search_members_reactivate('Daniela', 8)`,
    )).rejects.toThrow(/permiso/i);

    await expect(query(
      `insert into public.member_payments (member_id, amount) values ($1, 70000)`,
      [gone],
    )).rejects.toThrow(/inactivo/i);
    await query(`insert into public.member_payments (member_id, amount) values ($1, 70000)`, [live]);
    await expect(query(
      `insert into public.reservations (member_id, member_name) values ($1, 'Daniela')`,
      [gone],
    )).rejects.toThrow(/inactivo/i);
    await expect(query(
      `insert into public.access_logs (member_id) values ($1)`,
      [gone],
    )).rejects.toThrow(/inactivo/i);
    await expect(query(
      `insert into public.messages (sender_name, recipient_key, subject, body, meta)
       values ('Club', '3368', 'Aviso', 'Cuota', '{"kind":"dues_mora"}'::jsonb)`,
    )).rejects.toThrow(/avisos automáticos/i);

    const debt = await query(
      `select outstanding_balance::float8 as balance from public.members where id = $1`,
      [gone],
    );
    expect(Number(debt.rows[0].balance)).toBe(140000);
    const payments = await query(`select count(*)::int as n from public.member_payments where member_id = $1`, [gone]);
    expect(payments.rows[0].n).toBe(0);

    await query(migrationSql);
    const again = await query(`select public.member_is_operational(m) as operational from public.members m where id = $1`, [gone]);
    expect(again.rows[0].operational).toBe(false);
  }, 20_000);
});
