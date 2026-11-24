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
import {
  bajaFechaNeedsReview,
  isOperationalMember,
  operationalListFilter,
  reactivateListFilter,
} from './operationalVisibility.js';

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

-- Firma que ya está en Supabase. La migración tiene que poder reemplazarla.
create function public.search_members_lookup(p_query text, p_limit integer default 8)
returns table (
  id uuid,
  member_number text,
  full_name text,
  document_number text,
  status text,
  has_portal boolean,
  tier text,
  outstanding_balance numeric,
  next_due_date date,
  cuota_categories jsonb
)
language sql
as $$
  select null::uuid, null::text, null::text, null::text, null::text, null::boolean, null::text, null::numeric, null::date, null::jsonb
  where false
$$;

create function public.list_members_padron(p_scope text default 'active')
returns table(
  id uuid,
  profile_id uuid,
  member_number text,
  card_number text,
  full_name text,
  phone text,
  email text,
  tier text,
  status text,
  outstanding_balance numeric,
  next_due_date date,
  overdue_since date,
  document_number text,
  document_type text,
  last_payment_date text,
  family_principal text,
  family_group_name text,
  cuota_categories jsonb,
  current_account_as_of text,
  unpaid_capital numeric,
  dues_open_periods jsonb,
  baja_motivo text,
  baja_fecha text,
  baja_actor text,
  baja_registrada text,
  reactivate_actor text,
  reactivate_registrada text,
  has_portal boolean,
  joined_at date,
  dues_free_through text,
  birth_date date
)
language sql
as $$
  select null::uuid, null::uuid, null::text, null::text, null::text, null::text, null::text, null::text, null::text,
    null::numeric, null::date, null::date, null::text, null::text, null::text, null::text, null::text, null::jsonb,
    null::text, null::numeric, null::jsonb, null::text, null::text, null::text, null::text, null::text, null::text,
    null::boolean, null::date, null::text, null::date
  where false
$$;

create or replace function public.member_in_viewer_household(p_member_number text, p_meta jsonb)
returns boolean language sql stable as $$ select false $$;

alter table public.members enable row level security;
`;

async function query(text, params) {
  return pool.query(text, params);
}

function splitTop(input) {
  const parts = [];
  let depth = 0;
  let quote = false;
  let start = 0;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quote) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === '"') quote = false;
      continue;
    }
    if (ch === '"') {
      quote = true;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(input.slice(start));
  return parts.filter((part) => part.length > 0);
}

function postgrestValue(value) {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return value;
}

function atomSql(expr) {
  const column = "(m.meta->>'bajaFecha')";
  if (expr.startsWith('status.eq.')) return `m.status::text = '${expr.slice('status.eq.'.length)}'`;
  if (expr === 'meta->>bajaFecha.is.null') return `${column} is null`;
  if (expr.startsWith('meta->>bajaFecha.gt.')) return `${column} > '${expr.slice('meta->>bajaFecha.gt.'.length)}'`;
  if (expr.startsWith('meta->>bajaFecha.lte.')) return `${column} <= '${expr.slice('meta->>bajaFecha.lte.'.length)}'`;
  if (expr.startsWith('meta->>bajaFecha.not.match.')) {
    return `${column} !~ '${postgrestValue(expr.slice('meta->>bajaFecha.not.match.'.length))}'`;
  }
  if (expr.startsWith('meta->>bajaFecha.match.')) {
    return `${column} ~ '${postgrestValue(expr.slice('meta->>bajaFecha.match.'.length))}'`;
  }
  throw new Error(`filtro no reconocido: ${expr}`);
}

function exprSql(expr) {
  if (expr.startsWith('and(') && expr.endsWith(')')) {
    return `(${splitTop(expr.slice(4, -1)).map(exprSql).join(' and ')})`;
  }
  if (expr.startsWith('or(') && expr.endsWith(')')) {
    return `(${splitTop(expr.slice(3, -1)).map(exprSql).join(' or ')})`;
  }
  return atomSql(expr);
}

function postgrestOrToSql(filter) {
  return splitTop(filter).map(exprSql).join(' or ');
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
    await query('grant usage on schema public to anon, authenticated');
    await query('grant select on table public.members to anon, authenticated');
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
    const clock = await query(
      `select (now() at time zone 'America/Argentina/Buenos_Aires')::date::text as today,
              ((now() at time zone 'America/Argentina/Buenos_Aires')::date + 1)::text as tomorrow,
              ((now() at time zone 'America/Argentina/Buenos_Aires')::date - 1)::text as yesterday`,
    );
    const { today, tomorrow, yesterday } = clock.rows[0];

    const live = await seed('active', 'Ana Activa', {
      number: '10009',
      document: '30111222',
      balance: 70000,
      meta: { familyPrincipalNumber: '10009', familyGroupName: 'Activa' },
    });
    const gone = await seed('inactive', 'Daniela Rojas', {
      number: '3368',
      document: '29507901',
      balance: 140000,
      meta: {
        bajaFecha: '2026-10-01',
        bajaMotivo: 'Renuncia',
        bajaActorName: 'Secretaría',
        familyPrincipalNumber: '3368',
        familyGroupName: 'Rojas',
      },
    });
    const scheduled = await seed('inactive', 'Baja Maniana', {
      number: '10800',
      document: '40111000',
      balance: 70000,
      meta: { bajaFecha: tomorrow, familyPrincipalNumber: '10800', familyGroupName: 'Maniana' },
    });
    const dueToday = await seed('inactive', 'Baja Hoy', {
      number: '10801',
      document: '40111001',
      balance: 70000,
      meta: { bajaFecha: today, familyPrincipalNumber: '10801' },
    });
    const pendingToday = await seed('active', 'Pendiente Hoy', {
      number: '10802',
      document: '40111002',
      balance: 40000,
      meta: { bajaFecha: today, pendingBaja: true, familyPrincipalNumber: '10802' },
    });
    const activeTomorrow = await seed('active', 'Activo Futuro', {
      number: '10803',
      document: '40111003',
      balance: 70000,
      meta: { bajaFecha: tomorrow, familyPrincipalNumber: '10803', familyGroupName: 'Futuro' },
    });
    const activeToday = await seed('active', 'Activo Fecha Hoy', {
      number: '10804',
      document: '40111004',
      balance: 70000,
      meta: { bajaFecha: today, familyPrincipalNumber: '10804' },
    });
    const activeFalse = await seed('active', 'Activo Flag Falso', {
      number: '10805',
      document: '40111005',
      balance: 84000,
      meta: { bajaFecha: yesterday, pendingBaja: false, familyPrincipalNumber: '10805', familyGroupName: 'Falso' },
    });
    const activeNull = await seed('active', 'Activo Flag Nulo', {
      number: '10806',
      document: '40111006',
      balance: 70000,
      meta: { bajaFecha: yesterday, familyPrincipalNumber: '10806' },
    });
    const suspended = await seed('suspended', 'Socio Suspendido', {
      number: '10807',
      document: '40111007',
      balance: 70000,
      meta: { familyPrincipalNumber: '10807' },
    });
    const invalidInactive = await seed('inactive', 'Fecha Rota', {
      number: '10901',
      document: '50111001',
      balance: 70000,
      meta: { bajaFecha: '2026-02-30', familyPrincipalNumber: '10901' },
    });
    const invalidActive = await seed('active', 'Activo Roto', {
      number: '10902',
      document: '50111002',
      balance: 40000,
      meta: { bajaFecha: '2026-13-40', familyPrincipalNumber: '10902' },
    });
    const leapPast = await seed('inactive', 'Bisiesto Viejo', {
      number: '10903',
      document: '50111003',
      balance: 70000,
      meta: { bajaFecha: '2024-02-29', familyPrincipalNumber: '10903' },
    });
    const leapFuture = await seed('inactive', 'Bisiesto Futuro', {
      number: '10904',
      document: '50111004',
      balance: 70000,
      meta: { bajaFecha: '2028-02-29', familyPrincipalNumber: '10904' },
    });
    const commonId = randomUUID();
    await query(
      `insert into public.members (id, profile_id, member_number, full_name, document_number, email, status, outstanding_balance, meta)
       values ($1, '11111111-1111-1111-1111-111111111111', '12001', 'Socio Comun', '27111000', 'comun@example.com', 'active', 0, '{}'::jsonb)`,
      [commonId],
    );

    const calendar = await query(`
      select public.member_calendar_date('2026-02-30')::text as bad,
             public.member_calendar_date('2026-13-40')::text as month,
             public.member_calendar_date('2026-00-10')::text as zero,
             public.member_calendar_date('2026-11-31')::text as day,
             public.member_calendar_date('2026-02-29')::text as noleap,
             public.member_calendar_date('2024-02-29')::text as leap,
             public.member_calendar_date('2000-02-29')::text as century,
             public.member_calendar_date('1900-02-29')::text as notcentury
    `);
    expect(calendar.rows[0].bad).toBeNull();
    expect(calendar.rows[0].month).toBeNull();
    expect(calendar.rows[0].zero).toBeNull();
    expect(calendar.rows[0].day).toBeNull();
    expect(calendar.rows[0].noleap).toBeNull();
    expect(String(calendar.rows[0].leap)).toBe('2024-02-29');
    expect(String(calendar.rows[0].century)).toBe('2000-02-29');
    expect(calendar.rows[0].notcentury).toBeNull();

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
    expect(byId[dueToday].operational).toBe(false);
    expect(byId[dueToday].reactivate).toBe(true);
    expect(byId[pendingToday].operational).toBe(false);
    expect(byId[pendingToday].reactivate).toBe(true);
    expect(byId[activeTomorrow].operational).toBe(true);
    expect(byId[activeTomorrow].reactivate).toBe(false);
    expect(byId[activeToday].operational).toBe(false);
    expect(byId[activeToday].reactivate).toBe(true);
    expect(byId[activeFalse].operational).toBe(false);
    expect(byId[activeFalse].reactivate).toBe(true);
    expect(byId[activeNull].operational).toBe(false);
    expect(byId[activeNull].reactivate).toBe(true);
    expect(byId[suspended].operational).toBe(false);
    expect(byId[suspended].reactivate).toBe(true);
    expect(byId[invalidInactive].operational).toBe(false);
    expect(byId[invalidInactive].reactivate).toBe(true);
    expect(byId[invalidActive].operational).toBe(true);
    expect(byId[invalidActive].reactivate).toBe(false);
    expect(byId[leapPast].operational).toBe(false);
    expect(byId[leapFuture].operational).toBe(true);
    expect(byId[commonId].operational).toBe(true);

    const compared = await query(
      `select id::text, status::text, meta,
              public.member_is_operational(m) as operational,
              public.member_is_reactivatable(m) as reactivate,
              public.member_baja_fecha_needs_review(m) as review
       from public.members m`,
    );
    for (const row of compared.rows) {
      const member = {
        status: row.status,
        meta: row.meta,
        bajaFecha: row.meta?.bajaFecha,
        pendingBaja: row.meta?.pendingBaja,
      };
      expect(isOperationalMember(member, today)).toBe(row.operational);
      expect(bajaFechaNeedsReview(member)).toBe(row.review);
    }
    const operationalSql = postgrestOrToSql(operationalListFilter(today));
    const reactivateSql = postgrestOrToSql(reactivateListFilter(today));
    const byFilter = await query(
      `select id::text,
              (${operationalSql}) is true as operational,
              (${reactivateSql}) is true as reactivate
       from public.members m`,
    );
    const filterById = Object.fromEntries(byFilter.rows.map((row) => [row.id, row]));
    for (const row of compared.rows) {
      expect(filterById[row.id].operational).toBe(row.operational);
      expect(filterById[row.id].reactivate).toBe(row.reactivate);
    }

    await expect(query(
      `select * from public.search_members_reactivate('Daniela', 8)`,
    )).rejects.toThrow(/permiso/i);

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role anon');
      await client.query('savepoint anon_check');
      await expect(client.query(`select full_name from public.search_members_reactivate('Daniela', 5)`)).rejects.toThrow(/permission denied|permiso/i);
      await client.query('rollback to savepoint anon_check');
      await expect(client.query(`select full_name from public.search_members_historical('Daniela', 5)`)).rejects.toThrow(/permission denied|permiso/i);
      await client.query('rollback to savepoint anon_check');
      const anonLookup = await client.query(`select full_name from public.search_members_lookup('Daniela', 5)`);
      expect(anonLookup.rows).toHaveLength(0);
      const anonDoc = await client.query(`select full_name from public.search_members_lookup('29507901', 5)`);
      expect(anonDoc.rows).toHaveLength(0);
      const anonNumber = await client.query(`select full_name from public.search_members_lookup('3368', 5)`);
      expect(anonNumber.rows).toHaveLength(0);
      const anonTable = await client.query(`select full_name from public.members`);
      expect(anonTable.rows).toHaveLength(0);
      await client.query('rollback');
    } finally {
      client.release();
    }

    await query(`create or replace function auth.uid() returns uuid language sql stable as $$ select '11111111-1111-1111-1111-111111111111'::uuid $$`);
    const memberClient = await pool.connect();
    try {
      await memberClient.query('begin');
      await memberClient.query('set local role authenticated');
      await memberClient.query('savepoint member_check');
      await expect(memberClient.query(`select full_name from public.search_members_reactivate('Daniela', 5)`)).rejects.toThrow(/permiso/i);
      await memberClient.query('rollback to savepoint member_check');
      await expect(memberClient.query(`select full_name from public.search_members_historical('Rojas', 5)`)).rejects.toThrow(/permiso/i);
      await memberClient.query('rollback to savepoint member_check');
      const hidden = await memberClient.query(`select full_name from public.search_members_lookup('Daniela', 5)`);
      expect(hidden.rows).toHaveLength(0);
      const own = await memberClient.query(`select full_name from public.members order by full_name`);
      expect(own.rows.map((row) => row.full_name)).toEqual(['Socio Comun']);
      await memberClient.query('rollback');
    } finally {
      memberClient.release();
    }

    await query(`create or replace function auth.uid() returns uuid language sql stable as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$`);
    await query(`create or replace function public.has_staff_access() returns boolean language sql stable as $$ select true $$`);

    const found = await query(`select full_name, baja_fecha from public.search_members_lookup('Activa', 8)`);
    expect(found.rows.map((row) => row.full_name)).toEqual(['Ana Activa']);
    const hidden = await query(`select full_name from public.search_members_lookup('Daniela', 8)`);
    expect(hidden.rows).toHaveLength(0);
    const stillIn = await query(`select full_name, baja_fecha from public.search_members_lookup('Maniana', 8)`);
    expect(stillIn.rows.map((row) => row.full_name)).toEqual(['Baja Maniana']);
    expect(String(stillIn.rows[0].baja_fecha)).toBe(tomorrow);
    const notYet = await query(`select full_name from public.search_members_lookup('Hoy', 8)`);
    expect(notYet.rows).toHaveLength(0);

    const reactivate = await query(`select full_name from public.search_members_reactivate('Rojas', 8)`);
    expect(reactivate.rows.map((row) => row.full_name)).toEqual(['Daniela Rojas']);
    const reactivateToday = await query(`select full_name from public.search_members_reactivate('Hoy', 8)`);
    expect(reactivateToday.rows.map((row) => row.full_name).sort()).toEqual(['Activo Fecha Hoy', 'Baja Hoy', 'Pendiente Hoy']);
    const padron = await query(`select id::text from public.list_members_padron('active')`);
    const padronIds = padron.rows.map((row) => row.id).sort();
    const operationalIds = compared.rows.filter((row) => row.operational).map((row) => row.id).sort();
    expect(padronIds).toEqual(operationalIds);
    const reactivateTomorrow = await query(`select full_name from public.search_members_reactivate('Maniana', 8)`);
    expect(reactivateTomorrow.rows).toHaveLength(0);

    const houseTomorrow = await query(`select full_name from public.list_household_members('10800')`);
    expect(houseTomorrow.rows.map((row) => row.full_name)).toEqual(['Baja Maniana']);
    const houseGone = await query(`select full_name from public.list_household_members('3368')`);
    expect(houseGone.rows).toHaveLength(0);
    const ficha = await query(`select member_number from public.members where id = $1`, [gone]);
    expect(ficha.rows[0].member_number).toBe('3368');

    await expect(query(
      `insert into public.member_payments (member_id, amount) values ($1, 70000)`,
      [gone],
    )).rejects.toThrow(/inactivo/i);
    await expect(query(
      `insert into public.member_payments (member_id, amount) values ($1, 70000)`,
      [dueToday],
    )).rejects.toThrow(/inactivo/i);
    await query(`insert into public.member_payments (member_id, amount) values ($1, 70000)`, [live]);
    await query(`insert into public.member_payments (member_id, amount) values ($1, 70000)`, [scheduled]);
    await expect(query(
      `insert into public.reservations (member_id, member_name) values ($1, 'Daniela')`,
      [gone],
    )).rejects.toThrow(/inactivo/i);
    await expect(query(
      `insert into public.access_logs (member_id) values ($1)`,
      [gone],
    )).rejects.toThrow(/inactivo/i);
    await expect(query(
      `insert into public.access_logs (member_id) values ($1)`,
      [activeFalse],
    )).rejects.toThrow(/inactivo/i);
    await expect(query(
      `insert into public.member_payments (member_id, amount) values ($1, 84000)`,
      [activeNull],
    )).rejects.toThrow(/inactivo/i);
    await query(`insert into public.access_logs (member_id) values ($1)`, [activeTomorrow]);
    await expect(query(
      `insert into public.messages (sender_name, recipient_key, subject, body, meta)
       values ('Club', '3368', 'Aviso', 'Cuota', '{"kind":"dues_mora"}'::jsonb)`,
    )).rejects.toThrow(/avisos automáticos/i);

    const kept = await query(
      `select outstanding_balance::float8 as balance,
              meta->>'familyPrincipalNumber' as principal,
              meta->>'familyGroupName' as household,
              meta->>'bajaMotivo' as motivo
       from public.members where id = $1`,
      [gone],
    );
    expect(Number(kept.rows[0].balance)).toBe(140000);
    expect(kept.rows[0].principal).toBe('3368');
    expect(kept.rows[0].household).toBe('Rojas');
    expect(kept.rows[0].motivo).toBe('Renuncia');
    const payments = await query(`select count(*)::int as n from public.member_payments where member_id = $1`, [gone]);
    expect(payments.rows[0].n).toBe(0);
    const falseKept = await query(
      `select outstanding_balance::float8 as balance, meta->>'familyGroupName' as household
       from public.members where id = $1`,
      [activeFalse],
    );
    expect(Number(falseKept.rows[0].balance)).toBe(84000);
    expect(falseKept.rows[0].household).toBe('Falso');
    const scheduledPay = await query(`select count(*)::int as n from public.member_payments where member_id = $1`, [scheduled]);
    expect(scheduledPay.rows[0].n).toBe(1);

    await query(migrationSql);
    const again = await query(`select public.member_is_operational(m) as operational from public.members m where id = $1`, [gone]);
    expect(again.rows[0].operational).toBe(false);
    const lookupCols = await query(
      `select pg_get_function_result('public.search_members_lookup(text, integer)'::regprocedure) as result`,
    );
    expect(lookupCols.rows[0].result).toMatch(/baja_fecha/);
    expect(lookupCols.rows[0].result).toMatch(/pending_baja/);
  }, 60_000);
});
