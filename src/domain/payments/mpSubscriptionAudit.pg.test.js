/**
 * Migración de adhesiones, todavía no aplicada en el club.
 * Postgres embebido. No lee ni escribe la base de producción.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const migration = readFileSync(
  join(root, 'supabase/migrations/20261123230000_subscription_pending_and_debit_capital.sql'),
  'utf8',
);

const PORT = 58620 + Math.floor(Math.random() * 200);
const PENDING = '11111111-1111-4111-8111-111111111111';
const OWNED = '22222222-2222-4222-8222-222222222222';
const GALICIA = '33333333-3333-4333-8333-333333333333';
const DEBIT = '44444444-4444-4444-8444-444444444444';
const ONESHOT = '55555555-5555-4555-8555-555555555555';
const TENNIS = '66666666-6666-4666-8666-666666666666';

let cluster;
let databaseDir;
let pool;

function query(text, params) {
  return pool.query(text, params);
}

async function member(id, fields = {}) {
  await query(
    `insert into public.members (id, outstanding_balance, payment_method, meta)
     values ($1, $2, $3, $4::jsonb)`,
    [id, fields.balance ?? 0, fields.method ?? null, JSON.stringify(fields.meta ?? {})],
  );
}

async function subscription(id, memberId) {
  await query(
    `insert into public.mp_intents (id, member_id, kind, status, amount, meta)
     values ($1, $2, 'subscription', 'pending', 70000, '{"channel":"subscription","chargeScope":"cuota_social"}'::jsonb)`,
    [id, memberId],
  );
}

describe('auditoría de suscripciones sobre la migración nueva', () => {
  beforeAll(async () => {
    databaseDir = mkdtempSync(join(tmpdir(), 'jockey-mp-sub-'));
    cluster = new EmbeddedPostgres({
      databaseDir,
      user: 'postgres',
      password: 'postgres',
      port: PORT,
      persistent: false,
    });
    await cluster.initialise();
    await cluster.start();
    pool = new pg.Pool({ connectionString: `postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`, max: 2 });
    await query(`
      create table public.members (
        id uuid primary key,
        outstanding_balance numeric(14,2) not null default 0,
        payment_method text,
        meta jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now()
      );
      create table public.mp_intents (
        id uuid primary key,
        member_id uuid,
        kind text,
        status text,
        amount numeric(14,2),
        preapproval_id text,
        meta jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now()
      );
      create table public.member_dues_periods (
        member_id uuid not null,
        due_on date not null,
        capital numeric(14,2) not null,
        capital_open numeric(14,2) not null,
        late_base numeric(14,2) not null default 0,
        primary key (member_id, due_on)
      );
      create table public.dues_imputations (
        payment_id uuid,
        member_id uuid,
        due_on date,
        capital numeric(14,2),
        surcharge numeric(14,2),
        capital_open numeric(14,2),
        surcharge_open numeric(14,2),
        late_base_taken numeric(14,2),
        kind text,
        voided_at timestamptz
      );
      create table public.member_dues_entries (
        member_id uuid,
        amount numeric(14,2),
        kind text,
        source text,
        charge_scope text
      );
      create unique index member_dues_entries_source_uidx
        on public.member_dues_entries (source)
        where source <> '';
      create table public.member_payments (
        id uuid primary key,
        member_id uuid not null,
        amount numeric(14,2) not null,
        method text,
        paid_at date,
        idempotency_key text,
        meta jsonb not null default '{}'::jsonb
      );
      create function public.member_id_is_dues_exempt(mid uuid) returns boolean
      language sql stable as $$ select false $$;
    `);
    await query(migration);
  }, 60_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await cluster?.stop().catch(() => {});
    if (databaseDir) {
      try { rmSync(databaseDir, { recursive: true, force: true }); } catch { /* Windows puede retener el directorio un instante. */ }
    }
  }, 60_000);

  it('una adhesión pendiente no queda rechazada ni prende el débito', async () => {
    await member(PENDING);
    await subscription('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', PENDING);
    const result = await query(
      `select public.apply_mp_subscription($1, 'pre-pending', 'pending') as result`,
      ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    );
    expect(result.rows[0].result.adhesion).toBe('pending');
    const row = await query(
      `select m.payment_method, m.meta->>'mpAdhesion' as adhesion, i.status
       from public.members m
       join public.mp_intents i on i.member_id = m.id
       where m.id = $1`,
      [PENDING],
    );
    expect(row.rows[0]).toMatchObject({ payment_method: null, adhesion: 'pending', status: 'pending' });
  });

  it('cancelar una adhesión de Mercado Pago apaga solo el débito que ella encendió', async () => {
    await member(OWNED);
    await subscription('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', OWNED);
    await query(`select public.apply_mp_subscription($1, 'pre-owned', 'authorized')`, ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']);
    const on = await query(`select payment_method, meta->>'mpDebitMethod' as owner, meta->>'mpAdhesion' as adhesion from public.members where id = $1`, [OWNED]);
    expect(on.rows[0]).toMatchObject({ payment_method: 'debito', owner: 'mercadopago', adhesion: 'authorized' });
    await query(`select public.apply_mp_subscription($1, 'pre-owned', 'cancelled')`, ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']);
    const off = await query(`select payment_method, meta->>'mpDebitMethod' as owner, meta->>'mpAdhesion' as adhesion from public.members where id = $1`, [OWNED]);
    expect(off.rows[0]).toMatchObject({ payment_method: null, owner: null, adhesion: 'cancelled' });
  });

  it('cancelar no apaga un débito de Galicia que ya estaba', async () => {
    await member(GALICIA, { method: 'debito' });
    await subscription('cccccccc-cccc-4ccc-8ccc-cccccccccccc', GALICIA);
    await query(`select public.apply_mp_subscription($1, 'pre-galicia', 'authorized')`, ['cccccccc-cccc-4ccc-8ccc-cccccccccccc']);
    await query(`select public.apply_mp_subscription($1, 'pre-galicia', 'cancelled')`, ['cccccccc-cccc-4ccc-8ccc-cccccccccccc']);
    const row = await query(`select payment_method, meta->>'mpDebitMethod' as owner, meta->>'mpAdhesion' as adhesion from public.members where id = $1`, [GALICIA]);
    expect(row.rows[0]).toMatchObject({ payment_method: 'debito', owner: null, adhesion: 'cancelled' });
  });

  it('el débito aprobado no se queda con el 10 % de un mes anterior', async () => {
    await member(DEBIT, { balance: 80000 });
    await query(
      `insert into public.member_dues_entries (member_id, amount, kind, source, charge_scope)
       values ($1, 80000, 'opening', 'social-debit', 'cuota_social')`,
      [DEBIT],
    );
    await query(
      `insert into public.member_dues_periods (member_id, due_on, capital, capital_open, late_base)
       values ($1, '2026-10-10', 40000, 40000, 40000), ($1, '2026-11-10', 40000, 40000, 40000)`,
      [DEBIT],
    );
    await query(
      `insert into public.mp_intents (id, member_id, kind, status, meta)
       values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', $1, 'dues', 'approved',
               '{"channel":"subscription","from_subscription":"pre-debit","chargeScope":"cuota_social"}'::jsonb)`,
      [DEBIT],
    );
    await query(
      `insert into public.member_payments (id, member_id, amount, method, paid_at, meta)
       values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', $1, 80000, 'mercadopago', '2026-11-20',
               '{"chargeScope":"cuota_social","mp_intent_id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}'::jsonb)`,
      [DEBIT],
    );
    const rows = await query(
      `select due_on::text, capital::float, surcharge::float
       from public.dues_imputations where member_id = $1 order by due_on`,
      [DEBIT],
    );
    expect(rows.rows).toEqual([
      { due_on: '2026-10-10', capital: 40000, surcharge: 0 },
      { due_on: '2026-11-10', capital: 40000, surcharge: 0 },
    ]);
  });

  it('un pago suelto de Mercado Pago, fuera de la suscripción, sigue sumando el 10 %', async () => {
    await member(ONESHOT, { balance: 80000 });
    await query(
      `insert into public.member_dues_entries (member_id, amount, kind, source, charge_scope)
       values ($1, 80000, 'opening', 'social-oneshot', 'cuota_social')`,
      [ONESHOT],
    );
    await query(
      `insert into public.member_dues_periods (member_id, due_on, capital, capital_open, late_base)
       values ($1, '2026-10-10', 40000, 40000, 40000), ($1, '2026-11-10', 40000, 40000, 40000)`,
      [ONESHOT],
    );
    await query(
      `insert into public.member_payments (id, member_id, amount, method, paid_at, meta)
       values ('ffffffff-ffff-4fff-8fff-ffffffffffff', $1, 80000, 'mercadopago', '2026-11-20',
               '{"chargeScope":"cuota_social"}'::jsonb)`,
      [ONESHOT],
    );
    const rows = await query(
      `select due_on::text, capital::float, surcharge::float
       from public.dues_imputations where member_id = $1 order by due_on`,
      [ONESHOT],
    );
    expect(rows.rows[0]).toMatchObject({ due_on: '2026-10-10', capital: 40000, surcharge: 4000 });
    expect(rows.rows[1]).toMatchObject({ due_on: '2026-11-10', capital: 36000, surcharge: 0 });
  });

  it('el débito de cuota social no consume el período de tenis', async () => {
    await member(TENNIS, { balance: 52000 });
    await query(
      `insert into public.member_dues_entries (member_id, amount, kind, source, charge_scope) values
       ($1, 40000, 'opening', 'social-tennis', 'cuota_social'),
       ($1, 12000, 'opening', 'tennis-only', 'abono_tenis')`,
      [TENNIS],
    );
    await query(
      `insert into public.member_dues_periods (member_id, due_on, capital, capital_open, late_base)
       values ($1, '2026-10-10', 40000, 40000, 40000), ($1, '2026-10-11', 12000, 12000, 0)`,
      [TENNIS],
    );
    await query(
      `insert into public.mp_intents (id, member_id, kind, status, meta)
       values ('abababab-abab-4aba-8aba-abababababab', $1, 'dues', 'approved',
               '{"channel":"subscription","chargeScope":"cuota_social"}'::jsonb)`,
      [TENNIS],
    );
    await query(
      `insert into public.member_payments (id, member_id, amount, method, paid_at, meta)
       values ('cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd', $1, 52000, 'mercadopago', '2026-11-20',
               '{"chargeScope":"cuota_social","mp_intent_id":"abababab-abab-4aba-8aba-abababababab"}'::jsonb)`,
      [TENNIS],
    );
    const periods = await query(
      `select due_on::text, capital_open::float from public.member_dues_periods where member_id = $1 order by due_on`,
      [TENNIS],
    );
    expect(periods.rows).toEqual([
      { due_on: '2026-10-10', capital_open: 0 },
      { due_on: '2026-10-11', capital_open: 12000 },
    ]);
    const surcharge = await query(
      `select coalesce(sum(surcharge), 0)::float as surcharge from public.dues_imputations where member_id = $1`,
      [TENNIS],
    );
    expect(surcharge.rows[0].surcharge).toBe(0);
  });
});
