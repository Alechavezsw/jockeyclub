/**
 * La vinculación rechaza una cuenta cuyo correo y cuyo DNI son de fichas distintas.
 * Corre sobre Postgres embebido. No toca producción.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startEmbeddedPostgres, stopEmbeddedPostgres } from '../../test/embeddedPostgresHarness.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const migrationSql = readFileSync(
  join(root, 'supabase/migrations/20261126190000_portal_identity_guard.sql'),
  'utf8',
);

let cluster;
let databaseDir;
let pool;

const schemaSql = `
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;

create schema if not exists auth;
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table auth.users (
  id uuid primary key,
  email text,
  banned_until timestamptz,
  deleted_at timestamptz
);

do $$ begin
  create type public.member_status as enum ('active', 'suspended', 'inactive', 'pending');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.portal_access_reason as enum ('first_access', 'forgot_password');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.portal_access_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null;
end $$;

create table public.profiles (
  id uuid primary key,
  email text,
  document_number text,
  is_active boolean default true
);

create table public.members (
  id uuid primary key,
  profile_id uuid,
  member_number text,
  card_number text,
  full_name text,
  phone text,
  email text,
  tier text,
  status public.member_status default 'active',
  outstanding_balance numeric default 0,
  next_due_date date,
  overdue_since date,
  document_number text,
  document_type text,
  joined_at date,
  birth_date date,
  photo_url text,
  disciplines text[],
  meta jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table public.portal_access_requests (
  id uuid primary key default gen_random_uuid(),
  full_name text,
  document_number text,
  member_number text,
  phone text,
  email text,
  reason public.portal_access_reason default 'first_access',
  member_id uuid,
  status public.portal_access_status default 'pending',
  created_at timestamptz default now()
);

create or replace function public.has_staff_access() returns boolean
language sql stable as $$ select false $$;
`;

async function query(text, params) {
  return pool.query(text, params);
}

describe('guarda de identidad del portal', () => {
  beforeAll(async () => {
    const ctx = await startEmbeddedPostgres({
      label: 'jc-identity',
      poolMax: 2,
      clusterOptions: {
        autoRehydrateSymlinks: true,
        initdbFlags: ['--encoding=UTF8', '--locale=C'],
      },
    });
    cluster = ctx.cluster;
    databaseDir = ctx.databaseDir;
    pool = ctx.pool;
    await query(schemaSql);
    await query(migrationSql);
    await query(`
      insert into public.members (id, member_number, full_name, email, document_number, status, meta)
      values
        ('ae77d606-6c3e-4c2d-8d40-055b0b4d2fbd', '100689', 'Cintia Paola', 'morita2274@gmail.com', '30542907', 'active', '{"familyPrincipalNumber":"100689"}'),
        ('11111111-1111-4111-8111-111111111111', '100710', 'Integrante', 'hijo@example.com', '40111001', 'active', '{"familyPrincipalNumber":"100689"}'),
        ('22222222-2222-4222-8222-222222222222', '100711', 'Integrante 2', 'hijo2@example.com', '40111002', 'active', '{"familyPrincipalNumber":"100689"}'),
        ('33333333-3333-4333-8333-333333333333', '100712', 'Integrante 3', 'hijo3@example.com', '40111003', 'active', '{"familyPrincipalNumber":"100689"}'),
        ('6d297f6b-7b9b-4bb5-9442-c87404dad7be', '101453', 'Cintia', 'cintiagarciagrigolo@hotmail.com', '36588359', 'active', '{"familyPrincipalNumber":"101452"}'),
        ('44444444-4444-4444-8444-444444444444', '101452', 'Titular ajeno', 'juancruzguillemain@hotmail.com', '36423900', 'active', '{"familyPrincipalNumber":"101452"}');
    `);
  }, 120_000);

  afterAll(async () => {
    await stopEmbeddedPostgres({ pool, cluster, databaseDir });
  }, 60_000);

  it('rechaza vincular el correo de una socia con el DNI de otra', async () => {
    const { rows } = await query(
      `select public.portal_identity_block_reason(
         '6d297f6b-7b9b-4bb5-9442-c87404dad7be',
         'morita2274@gmail.com',
         '36588359',
         null
       ) as reason`,
    );
    expect(rows[0].reason).toMatch(/correo no es el de la ficha/);
  });

  it('rechaza un pedido de acceso con DNI y correo de fichas distintas', async () => {
    await expect(query(
      `select public.submit_portal_access_request(
         'Cintia', '36588359', '101453', null, 'morita2274@gmail.com', 'first_access',
         '6d297f6b-7b9b-4bb5-9442-c87404dad7be'
       )`,
    )).rejects.toThrow(/correo/);
  });

  it('el perfil desactivado no cuenta como acceso habilitado', async () => {
    await query(`
      insert into auth.users (id, email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'morita2274@gmail.com');
      insert into public.profiles (id, email, document_number, is_active)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'morita2274@gmail.com', '30542907', false);
    `);
    await expect(query(`
      update public.members set profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      where member_number = '100689'
    `)).rejects.toThrow(/perfil está desactivado/);
    const { rows } = await query(
      `select public.member_has_portal('ae77d606-6c3e-4c2d-8d40-055b0b4d2fbd') as has_portal`,
    );
    expect(rows[0].has_portal).toBe(false);
  });

  it('con la cuenta activa ve solo su grupo y no el ajeno', async () => {
    await query(`
      update public.profiles set is_active = true where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      update public.members set profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      where member_number = '100689';
    `);
    await query(`select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false)`);
    const own = await query(`select member_number from public.list_household_members('100689') order by 1`);
    const foreign = await query(`select count(*)::int as rows from public.list_household_members('101452')`);
    expect(own.rows.map((row) => row.member_number)).toEqual(['100689', '100710', '100711', '100712']);
    expect(foreign.rows[0].rows).toBe(0);
    const state = await query(
      `select public.member_portal_access_state('ae77d606-6c3e-4c2d-8d40-055b0b4d2fbd') as state`,
    );
    expect(state.rows[0].state).toBe('active');
  });

  it('un perfil vinculado a dos socios no resuelve ningún grupo', async () => {
    await query(`
      insert into auth.users (id, email) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'compartido@example.com');
      insert into public.profiles (id, email, document_number, is_active)
      values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'compartido@example.com', '50000001', true);
      insert into public.members (id, member_number, email, document_number, status, profile_id)
      values ('55555555-5555-4555-8555-555555555555', '109001', 'compartido@example.com', '50000001', 'active', null);
    `);
    await query(`
      update public.members set profile_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      where member_number = '109001'
    `);
    await query(`
      alter table public.members disable trigger members_profile_identity_guard;
      update public.members set profile_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      where member_number = '101453';
      alter table public.members enable trigger members_profile_identity_guard;
    `);
    await query(`select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', false)`);
    const seen = await query(`select public.member_in_viewer_household('101453', '{"familyPrincipalNumber":"101452"}'::jsonb) as ok`);
    expect(seen.rows[0].ok).toBe(false);
    const listed = await query(`select count(*)::int as rows from public.list_household_members('101452')`);
    expect(listed.rows[0].rows).toBe(0);
  });

  it('no vincula sola una cuenta si el DNI y el correo apuntan a fichas distintas', async () => {
    await query(`
      insert into auth.users (id, email) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'morita2274@gmail.com');
      insert into public.profiles (id, email, document_number, is_active)
      values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'morita2274@gmail.com', '36588359', true);
    `);
    await query(`select set_config('request.jwt.claim.sub', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', false)`);
    const { rows } = await query(`select public.link_own_member_profile() as linked`);
    expect(rows[0].linked).toBeNull();
    const still = await query(`select profile_id from public.members where member_number = '101453'`);
    expect(still.rows[0].profile_id).not.toBe('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  });

  it('una cuenta bloqueada no consulta el grupo', async () => {
    await query(`
      update auth.users set banned_until = '2099-01-01'
      where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    `);
    await query(`select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false)`);
    const seen = await query(`select public.member_in_viewer_household('100689', '{}'::jsonb) as ok`);
    expect(seen.rows[0].ok).toBe(false);
    const state = await query(
      `select public.member_portal_access_state('ae77d606-6c3e-4c2d-8d40-055b0b4d2fbd') as state`,
    );
    expect(state.rows[0].state).toBe('blocked');
  });
});
