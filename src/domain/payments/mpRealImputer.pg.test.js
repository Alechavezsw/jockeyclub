/**
 * Imputador real impute_dues_account_payment y trigger real
 * member_payment_posts_dues, más el cuerpo completo de Mercado Pago.
 * Postgres embebido. No lee ni escribe la base del club.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startEmbeddedPostgres, stopEmbeddedPostgres } from '../../test/embeddedPostgresHarness.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const paymentFn = readFileSync(join(root, 'supabase/tests/fixtures/apply_mp_approved_payment.production.sql'), 'utf8');
const subscriptionFn = readFileSync(join(root, 'supabase/tests/fixtures/apply_mp_subscription.production.sql'), 'utf8');
const imputerSql = readFileSync(join(root, 'supabase/migrations/20261116140000_fix_impute_dues_schedule_scalar.sql'), 'utf8');
const migrationSql = readFileSync(join(root, 'supabase/migrations/20261123150000_mp_credit_only_approved_exact.sql'), 'utf8');
const receiptSql = readFileSync(join(root, 'supabase/migrations/20261123190000_mp_receipt_jobs.sql'), 'utf8');

const MEMBER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const INTENT = '44444444-4444-4444-8444-444444444444';
const MSG = '50505050-5050-4505-8505-505050505050';
const OPS = '51515151-5151-4515-8515-515151515151';

let cluster;
let databaseDir;
let pool;
let beforeMigration;

function query(text, params) {
  return pool.query(text, params);
}

async function fingerprint() {
  const fees = await query(`
    select count(*)::int as n,
           coalesce(sum(amount), 0)::text as amount,
           coalesce(sum(collected), 0)::text as collected,
           coalesce(sum(pending), 0)::text as pending
    from public.fee_ledger_lines
    where source = 'connect_admin_reconciliation_20261123'
  `);
  const openings = await query(`
    select source, amount::text as amount
    from public.member_dues_entries
    where source in ('opening-social', 'opening-other')
    order by source
  `);
  const balances = await query(`
    select id::text, outstanding_balance::text as balance
    from public.members
    order by id
  `);
  const period = await query(`
    select capital::text as capital, capital_open::text as capital_open
    from public.member_dues_periods
    where member_id = $1
  `, [MEMBER]);
  return {
    fees: fees.rows[0],
    openings: openings.rows,
    balances: balances.rows,
    period: period.rows[0],
  };
}

describe('imputador real y cuerpo completo de Mercado Pago', () => {
  beforeAll(async () => {
    const ctx = await startEmbeddedPostgres({ label: 'jockey-mp-real', poolMax: 4 });
    cluster = ctx.cluster;
    databaseDir = ctx.databaseDir;
    pool = ctx.pool;

    await query(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      grant service_role to postgres;
      create table public.members (
        id uuid primary key,
        member_number text not null default '1001',
        full_name text not null default 'Socio',
        email text,
        tier text not null default 'socio_individual',
        outstanding_balance numeric(14,2) not null default 0,
        next_due_date date,
        overdue_since date,
        payment_method text,
        meta jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now()
      );
      create table public.mp_intents (
        id uuid primary key,
        kind text not null,
        status text not null default 'pending',
        member_id uuid,
        member_number text,
        amount numeric(14,2) not null,
        currency text not null default 'ARS',
        preference_id text,
        init_point text,
        sandbox_init_point text,
        preapproval_id text,
        provider_payment_id text,
        external_reference text not null,
        payer_email text,
        concept text,
        back_url text,
        meta jsonb not null default '{}'::jsonb,
        applied_at timestamptz,
        created_by uuid,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table public.chart_of_accounts (
        id uuid primary key default gen_random_uuid(),
        code text,
        name text,
        is_active boolean not null default true
      );
      create table public.fiscal_periods (
        id uuid primary key default gen_random_uuid(),
        starts_on date not null,
        ends_on date not null
      );
      create table public.journal_entries (
        id uuid primary key default gen_random_uuid(),
        entry_number bigint generated always as identity,
        fiscal_period_id uuid not null,
        entry_date date not null,
        concept text not null,
        status text not null default 'draft',
        source_module text,
        source_id uuid,
        posted_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table public.journal_lines (
        id uuid primary key default gen_random_uuid(),
        journal_entry_id uuid not null,
        account_id uuid not null,
        line_order smallint not null default 1,
        debit numeric(14,2) not null default 0,
        credit numeric(14,2) not null default 0,
        memo text
      );
      create table public.member_payments (
        id uuid primary key default gen_random_uuid(),
        member_id uuid not null,
        amount numeric(14,2) not null,
        paid_at date not null default current_date,
        method text,
        concept text,
        period_label text,
        receipt_number text,
        journal_entry_id uuid,
        idempotency_key text,
        meta jsonb not null default '{}'::jsonb
      );
      create table public.member_dues_entries (
        id uuid primary key default gen_random_uuid(),
        member_id uuid not null,
        amount numeric(14,2) not null,
        kind text not null,
        source text not null default '',
        created_at timestamptz not null default now()
      );
      create unique index member_dues_entries_source_idx
        on public.member_dues_entries (source) where source <> '';
      create table public.member_dues_periods (
        member_id uuid not null,
        due_on date not null,
        capital numeric(14,2) not null,
        capital_open numeric(14,2) not null,
        late_base numeric(14,2) not null default 0,
        primary key (member_id, due_on)
      );
      create table public.dues_imputations (
        id uuid primary key default gen_random_uuid(),
        payment_id uuid not null,
        member_id uuid not null,
        due_on date not null,
        capital numeric(14,2) not null default 0,
        surcharge numeric(14,2) not null default 0,
        capital_open numeric(14,2) not null default 0,
        surcharge_open numeric(14,2) not null default 0,
        late_base_taken numeric(14,2) not null default 0,
        voided_at timestamptz,
        created_at timestamptz not null default now(),
        kind text not null default 'cobro'
      );
      create table public.pool_accesses (
        id uuid primary key default gen_random_uuid(),
        access_date date not null default current_date,
        kind text not null,
        member_id uuid,
        member_number text,
        member_name text,
        guest_name text,
        host_member_number text,
        payment_amount numeric(14,2) not null default 0,
        payment_method text,
        payment_concept text,
        status text not null default 'active',
        source text,
        journal_entry_id uuid,
        meta jsonb not null default '{}'::jsonb
      );
      create table public.reservations (
        id uuid primary key default gen_random_uuid(),
        facility_id text not null,
        member_id uuid,
        member_number text,
        member_name text not null,
        reservation_date date not null,
        time_slot text not null,
        status text not null default 'confirmed',
        guests integer not null default 0,
        notes text,
        meta jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (facility_id, reservation_date, time_slot)
      );
      create table public.fee_ledger_lines (
        id text primary key,
        member_number text,
        type_label text,
        amount numeric(14,2) not null default 0,
        collected numeric(14,2) not null default 0,
        pending numeric(14,2) not null default 0,
        source text not null
      );
      create function public.club_today() returns date language sql stable as $$ select current_date $$;
      create function public.member_dues_balance(p_member_id uuid) returns numeric
      language sql stable as $$
        select round(coalesce(sum(amount), 0), 2) from public.member_dues_entries where member_id = p_member_id
      $$;
      create function public.member_is_dues_exempt(m public.members) returns boolean
      language sql stable as $$
        select coalesce(m.tier, '') ~* '(vitalicio|fundador|^comision$)'
            or coalesce(m.meta->>'cuotaCategories', '') ~* '(vitalicio|fundador|comision)'
      $$;
      create function public.member_id_is_dues_exempt(mid uuid) returns boolean
      language sql stable security definer set search_path = public as $$
        select coalesce(public.member_is_dues_exempt(m), false)
        from public.members m
        where m.id = mid
      $$;
      create function public.mp_next_dues_date(p_from date) returns date
      language sql stable as $$
        select (date_trunc('month', coalesce(p_from, current_date) + interval '1 month') + interval '9 days')::date
      $$;
      create function public.has_staff_access() returns boolean language sql stable as $$ select true $$;
    `);
    await query(imputerSql.replace(/\r\n/g, '\n'));
    await query(`
      create trigger trg_member_payment_posts_dues
        after insert on public.member_payments
        for each row execute function public.member_payment_posts_dues();
    `);
    await query(paymentFn);
    await query(subscriptionFn);

    const trigger = await query(`select pg_get_functiondef('public.member_payment_posts_dues()'::regprocedure) as def`);
    expect(trigger.rows[0].def).toContain('impute_dues_account_payment');
    expect(trigger.rows[0].def).not.toContain('charge_scope');
    const imputer = await query(`select pg_get_functiondef('public.impute_dues_account_payment(uuid,uuid,numeric,jsonb,date)'::regprocedure) as def`);
    expect(imputer.rows[0].def).toContain('insert into public.dues_imputations');

    await query(
      `insert into public.members (id, full_name, outstanding_balance)
       values ($1, 'Socio prueba', 40000), ($2, 'Otro socio', 70000)`,
      [MEMBER, OTHER],
    );
    await query(
      `insert into public.member_dues_entries (member_id, amount, kind, source)
       values ($1, 40000, 'opening', 'opening-social'), ($2, 70000, 'opening', 'opening-other')`,
      [MEMBER, OTHER],
    );
    await query(
      `insert into public.member_dues_periods (member_id, due_on, capital, capital_open, late_base)
       values ($1, date '2026-11-10', 40000, 40000, 40000)`,
      [MEMBER],
    );
    await query(`
      insert into public.chart_of_accounts (code, name) values
        ('1.1.08', 'Mercado Pago'),
        ('4.1.01', 'Cuotas Sociales'),
        ('4.1.02', 'Reservas e Instalaciones'),
        ('5.1.07', 'Descuentos sobre cuotas')
    `);
    await query(`insert into public.fiscal_periods (starts_on, ends_on) values (date '2026-01-01', date '2026-12-31')`);
    await query(`
      insert into public.fee_ledger_lines (id, member_number, type_label, amount, collected, pending, source)
      select 'adj-' || g, 'm' || g, 'AJUSTE ADMINISTRATIVO (CONCILIACIÓN CONNECT)', g, 0, g, 'connect_admin_reconciliation_20261123'
      from generate_series(1, 347) g
    `);

    beforeMigration = await fingerprint();
    expect(migrationSql.includes('update public.member_dues_entries')).toBe(false);
    expect(migrationSql.includes('update public.fee_ledger_lines')).toBe(false);
    expect(migrationSql.includes('update public.member_dues_periods')).toBe(false);
    expect(migrationSql.includes('delete from public.fee_ledger_lines')).toBe(false);
    expect(receiptSql.includes('fee_ledger')).toBe(false);

    await query(migrationSql.replace(/\r\n/g, '\n'));
    await query(receiptSql.replace(/\r\n/g, '\n'));
    expect(await fingerprint()).toEqual(beforeMigration);

    const replaced = await query(`select pg_get_functiondef('public.member_payment_posts_dues()'::regprocedure) as def`);
    expect(replaced.rows[0].def).toContain('charge_scope');
    expect(replaced.rows[0].def).toContain('impute_dues_account_payment');
  }, 180_000);

  afterAll(async () => {
    await stopEmbeddedPostgres({ pool, cluster, databaseDir });
  }, 60_000);

  it('un cobro aprobado imputa con el imputador real y no mueve el historial', async () => {
    await query(
      `insert into public.member_dues_entries (member_id, amount, kind, source, charge_scope)
       values ($1, 12000, 'charge', 'tenis-forward', 'abono_tenis')`,
      [MEMBER],
    );
    await query(
      `insert into public.mp_intents (
         id, kind, status, member_id, member_number, amount, currency, external_reference, concept, meta
       ) values (
         $1::uuid, 'dues', 'pending', $2::uuid, '1001', 40000, 'ARS', ($1::uuid)::text, 'Cuota social',
         '{"chargeScope":"cuota_social"}'::jsonb
       )`,
      [INTENT, MEMBER],
    );

    const first = await query(
      `select public.apply_mp_approved_payment($1, 'pay-real', 'approved', 40000)::jsonb as result`,
      [INTENT],
    );
    const second = await query(
      `select public.apply_mp_approved_payment($1, 'pay-real', 'approved', 40000)::jsonb as result`,
      [INTENT],
    );
    expect(first.rows[0].result.applied).toBe(true);
    expect(second.rows[0].result.already).toBe(true);

    const counts = await query(`select
      (select count(*)::int from public.member_payments where member_id = $1) as payments,
      (select count(*)::int from public.journal_entries where source_id = $2) as journals,
      (select count(*)::int from public.member_dues_entries where member_id = $1 and kind = 'payment') as ledger,
      (select count(*)::int from public.dues_imputations where member_id = $1 and voided_at is null) as imputations`,
      [MEMBER, INTENT]);
    expect(counts.rows[0]).toEqual({ payments: 1, journals: 1, ledger: 1, imputations: 1 });

    const imputation = await query(
      `select capital::text as capital, surcharge::text as surcharge, due_on::text as due_on
       from public.dues_imputations where member_id = $1`,
      [MEMBER],
    );
    expect(imputation.rows[0]).toEqual({ capital: '40000.00', surcharge: '0.00', due_on: '2026-11-10' });

    const period = await query(
      `select capital::text as capital, capital_open::text as capital_open
       from public.member_dues_periods where member_id = $1`,
      [MEMBER],
    );
    expect(period.rows[0]).toEqual({ capital: '40000.00', capital_open: '0.00' });

    const tennis = await query(
      `select amount::text as amount from public.member_dues_entries where source = 'tenis-forward'`,
    );
    expect(tennis.rows[0].amount).toBe('12000.00');

    const after = await fingerprint();
    expect(after.fees).toEqual(beforeMigration.fees);
    expect(after.fees).toEqual({ n: 347, amount: '60378.00', collected: '0.00', pending: '60378.00' });
    expect(after.openings).toEqual(beforeMigration.openings);
    expect(after.balances.find((row) => row.id === OTHER).balance).toBe('70000.00');
    expect(after.period.capital).toBe(beforeMigration.period.capital);
  });

  it('la cola cierra el mail omitido, frena el error permanente y suelta el candado vencido', async () => {
    async function intent(id) {
      await query(
        `insert into public.mp_intents (
           id, kind, status, member_id, member_number, amount, currency, external_reference, concept
         ) values ($1::uuid, 'dues', 'approved', $2::uuid, '1001', 40000, 'ARS', ($1::uuid)::text, 'Cuota social')`,
        [id, MEMBER],
      );
    }

    const skipped = '45454545-4545-4454-8454-454545454545';
    await intent(skipped);
    await query(`select public.claim_mp_receipt_job($1)`, [skipped]);
    await query(
      `select public.complete_mp_receipt_job($1, $2, 'no-email', 'Sin mail real', $3, 'MP-S', null, false)`,
      [skipped, MSG, OPS],
    );
    const skippedRow = await query(`select status, email_id from public.mp_receipt_jobs where intent_id = $1`, [skipped]);
    expect(skippedRow.rows[0]).toEqual({ status: 'sent', email_id: 'skipped:no-email' });
    const skippedAgain = await query(`select public.claim_mp_receipt_job($1) as result`, [skipped]);
    expect(skippedAgain.rows[0].result.claimed).toBe(false);
    expect(skippedAgain.rows[0].result.status).toBe('sent');

    const permanent = '46464646-4646-4464-8464-464646464646';
    await intent(permanent);
    await query(`select public.claim_mp_receipt_job($1)`, [permanent]);
    await query(
      `select public.complete_mp_receipt_job($1, $2, null, 'Resend 422', $3, 'MP-P', 'Resend 422', true)`,
      [permanent, MSG, OPS],
    );
    const held = await query(`select public.claim_mp_receipt_job($1) as result`, [permanent]);
    expect(held.rows[0].result).toMatchObject({ claimed: false, status: 'attention' });
    const forced = await query(`select public.claim_mp_receipt_job($1, true) as result`, [permanent]);
    expect(forced.rows[0].result.claimed).toBe(true);

    const expired = '47474747-4747-4474-8474-474747474747';
    await intent(expired);
    const left = await pool.connect();
    const right = await pool.connect();
    try {
      await left.query('begin');
      const first = await left.query(`select public.claim_mp_receipt_job($1) as result`, [expired]);
      const waiting = right.query(`select public.claim_mp_receipt_job($1) as result`, [expired]);
      await left.query('commit');
      const second = await waiting;
      expect(first.rows[0].result.claimed).toBe(true);
      expect(second.rows[0].result.claimed).toBe(false);
      expect(second.rows[0].result.status).toBe('locked');
    } finally {
      left.release();
      right.release();
    }
    await query(
      `update public.mp_receipt_jobs set locked_until = now() - interval '1 minute' where intent_id = $1`,
      [expired],
    );
    const resumed = await query(`select public.claim_mp_receipt_job($1) as result`, [expired]);
    expect(resumed.rows[0].result.claimed).toBe(true);
    expect(resumed.rows[0].result.attempts).toBe(2);

    const tired = '48484848-4848-4484-8484-484848484848';
    await intent(tired);
    let last;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await query(`select public.claim_mp_receipt_job($1)`, [tired]);
      last = await query(
        `select public.complete_mp_receipt_job($1, $2, null, 'Resend 502', $3, 'MP-T', 'Resend 502', false) as result`,
        [tired, MSG, OPS],
      );
    }
    const closed = '49494949-4949-4494-8494-494949494949';
    await intent(closed);
    await query(`select public.claim_mp_receipt_job($1)`, [closed]);
    const closedResult = await query(
      `select public.complete_mp_receipt_job($1, null, null, null, null, null, 'Sin comprobante de cuota: socio exento.', false, true) as result`,
      [closed],
    );
    expect(closedResult.rows[0].result.status).toBe('sent');
    const closedAgain = await query(`select public.claim_mp_receipt_job($1) as result`, [closed]);
    expect(closedAgain.rows[0].result).toMatchObject({ claimed: false, status: 'sent' });

    expect(last.rows[0].result.status).toBe('attention');
    const stopped = await query(`select public.claim_mp_receipt_job($1) as result`, [tired]);
    expect(stopped.rows[0].result).toMatchObject({ claimed: false, status: 'attention' });
  });
});
