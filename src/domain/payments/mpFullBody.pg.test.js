/**
 * Cuerpo completo de apply_mp_approved_payment y apply_mp_subscription,
 * el que hoy está en producción, sobre Postgres embebido.
 * No lee ni escribe la base del club.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const paymentFn = readFileSync(join(root, 'supabase/tests/fixtures/apply_mp_approved_payment.production.sql'), 'utf8');
const subscriptionFn = readFileSync(join(root, 'supabase/tests/fixtures/apply_mp_subscription.production.sql'), 'utf8');
const migrationSql = readFileSync(join(root, 'supabase/migrations/20261123150000_mp_credit_only_approved_exact.sql'), 'utf8');
const receiptSql = readFileSync(join(root, 'supabase/migrations/20261123190000_mp_receipt_jobs.sql'), 'utf8');

const PORT = 59600 + Math.floor(Math.random() * 300);
const MEMBER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let cluster;
let databaseDir;
let pool;

function query(text, params) {
  return pool.query(text, params);
}

async function insertIntent({ id, kind = 'dues', amount = 40000, currency = 'ARS', member = MEMBER, meta = {}, concept = 'Cuota social' }) {
  await query(
    `insert into public.mp_intents (id, kind, status, member_id, member_number, amount, currency, external_reference, concept, meta)
     values ($1::uuid, $2, 'pending', $3::uuid, '1001', $4, $5, ($1::uuid)::text, $6, $7::jsonb)`,
    [id, kind, member, amount, currency, concept, JSON.stringify(meta)],
  );
}

async function ledgerFingerprint() {
  const { rows } = await query(`
    select count(*)::int as n,
           coalesce(sum(amount), 0)::numeric as amount,
           coalesce(sum(collected), 0)::numeric as collected,
           coalesce(sum(pending), 0)::numeric as pending
    from public.fee_ledger_lines
    where source = 'connect_admin_reconciliation_20261123'
  `);
  return rows[0];
}

describe('cuerpo completo de Mercado Pago', () => {
  beforeAll(async () => {
    databaseDir = mkdtempSync(join(tmpdir(), 'jockey-mp-full-'));
    cluster = new EmbeddedPostgres({
      databaseDir,
      user: 'postgres',
      password: 'postgres',
      port: PORT,
      persistent: false,
    });
    await cluster.initialise();
    await cluster.start();
    pool = new pg.Pool({ connectionString: `postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`, max: 4 });

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
      create function public.mp_next_dues_date(p_from date) returns date
      language sql stable as $$
        select (date_trunc('month', coalesce(p_from, current_date) + interval '1 month') + interval '9 days')::date
      $$;
      create function public.member_id_is_dues_exempt(mid uuid) returns boolean
      language sql stable as $$ select false $$;
      create function public.impute_dues_account_payment(
        p_member_id uuid, p_payment_id uuid, p_cash numeric, p_schedule jsonb, p_paid date
      ) returns numeric language sql as $$ select null::numeric $$;
      create function public.has_staff_access() returns boolean language sql stable as $$ select true $$;
      create function public.member_payment_posts_dues() returns trigger language plpgsql as $$
      begin
        insert into public.member_dues_entries (member_id, amount, kind, source)
        values (new.member_id, -least(new.amount, 999999999), 'payment', 'payment:' || new.id::text);
        return new;
      end $$;
      create trigger trg_member_payment_posts_dues
        after insert on public.member_payments
        for each row execute function public.member_payment_posts_dues();
    `);
    await query(paymentFn);
    await query(subscriptionFn);
    await query(
      `insert into public.members (id, full_name, outstanding_balance) values ($1, 'Socio prueba', 52000), ($2, 'Otro socio', 12000)`,
      [MEMBER, OTHER],
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

    await insertIntent({ id: '11111111-1111-4111-8111-111111111111', amount: 40000, currency: '' });
    const loose = await query(
      `select public.apply_mp_approved_payment($1, 'loose', 'approved', 50000)::jsonb as result`,
      ['11111111-1111-4111-8111-111111111111'],
    );
    expect(loose.rows[0].result.applied).toBe(true);

    await insertIntent({ id: '12121212-1212-4121-8121-121212121212', kind: 'subscription', amount: 40000, concept: 'Suscripción' });
    const adhesion = await query(
      `select public.apply_mp_subscription($1, 'pre-loose', 'authorized')::jsonb as result`,
      ['12121212-1212-4121-8121-121212121212'],
    );
    expect(adhesion.rows[0].result.adhesion).toBe('authorized');
    const stamped = await query(`select applied_at from public.mp_intents where id = $1`, ['12121212-1212-4121-8121-121212121212']);
    expect(stamped.rows[0].applied_at).toBeTruthy();

    await query(`
      delete from public.journal_lines;
      delete from public.journal_entries;
      delete from public.member_dues_entries;
      delete from public.member_payments;
      delete from public.pool_accesses;
      delete from public.reservations;
      delete from public.mp_intents
    `);
    await query(
      `update public.members set outstanding_balance = case when id = $1 then 52000 else 12000 end, meta = '{}'::jsonb, payment_method = null`,
      [MEMBER],
    );
    await query(migrationSql.replace(/\r\n/g, '\n'));
    await query(receiptSql.replace(/\r\n/g, '\n'));
    expect(migrationSql.includes('fee_ledger')).toBe(false);
    expect(receiptSql.includes('fee_ledger')).toBe(false);
    expect(migrationSql.includes('update public.member_dues_entries')).toBe(false);
  }, 180_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await cluster?.stop().catch(() => {});
    if (databaseDir) rmSync(databaseDir, { recursive: true, force: true });
  }, 60_000);

  it('rechaza estado, centavos, cero y moneda sobre el cuerpo completo', async () => {
    await insertIntent({ id: '22222222-2222-4222-8222-222222222222' });
    const authorized = await query(
      `select public.apply_mp_approved_payment($1, 'pay-auth', 'authorized', 40000)::jsonb as result`,
      ['22222222-2222-4222-8222-222222222222'],
    );
    expect(authorized.rows[0].result.applied).toBe(false);

    await insertIntent({ id: '23232323-2323-4232-8232-232323232323' });
    await expect(query(
      `select public.apply_mp_approved_payment($1, 'pay-cent', 'approved', 40000.01)`,
      ['23232323-2323-4232-8232-232323232323'],
    )).rejects.toThrow(/centavos/);

    await insertIntent({ id: '24242424-2424-4242-8242-242424242424' });
    await expect(query(
      `select public.apply_mp_approved_payment($1, 'pay-zero', 'approved', 0)`,
      ['24242424-2424-4242-8242-242424242424'],
    )).rejects.toThrow(/inválido/);

    await insertIntent({ id: '25252525-2525-4252-8252-252525252525', currency: 'USD' });
    await expect(query(
      `select public.apply_mp_approved_payment($1, 'pay-usd', 'approved', 40000)`,
      ['25252525-2525-4252-8252-252525252525'],
    )).rejects.toThrow(/Moneda/);

    await insertIntent({ id: '26262626-2626-4262-8262-262626262626', currency: '' });
    await expect(query(
      `select public.apply_mp_approved_payment($1, 'pay-blank', 'approved', 40000)`,
      ['26262626-2626-4262-8262-262626262626'],
    )).rejects.toThrow(/Moneda/);

    const counts = await query(`select
      (select count(*)::int from public.member_payments) as payments,
      (select count(*)::int from public.journal_entries) as journals,
      (select count(*)::int from public.member_dues_entries where kind = 'payment') as imputations`);
    expect(counts.rows[0]).toEqual({ payments: 0, journals: 0, imputations: 0 });
  });

  it('un débito aprobado deja un pago, un asiento y una imputación, y no consume el tenis etiquetado', async () => {
    await query(
      `insert into public.member_dues_entries (member_id, amount, kind, source, charge_scope)
       values ($1, 40000, 'opening', 'opening-social', null), ($1, 12000, 'charge', 'tenis-forward', 'abono_tenis')`,
      [MEMBER],
    );
    const id = '33333333-3333-4333-8333-333333333333';
    await insertIntent({ id, meta: { chargeScope: 'cuota_social' } });
    const first = await query(
      `select public.apply_mp_approved_payment($1, 'pay-ok', 'approved', 40000)::jsonb as result`,
      [id],
    );
    const second = await query(
      `select public.apply_mp_approved_payment($1, 'pay-ok', 'approved', 40000)::jsonb as result`,
      [id],
    );
    expect(first.rows[0].result.applied).toBe(true);
    expect(second.rows[0].result.already).toBe(true);
    const counts = await query(`select
      (select count(*)::int from public.member_payments where member_id = $1) as payments,
      (select count(*)::int from public.journal_entries where source_id = $2) as journals,
      (select count(*)::int from public.member_dues_entries where member_id = $1 and kind = 'payment') as imputations`,
      [MEMBER, id]);
    expect(counts.rows[0]).toEqual({ payments: 1, journals: 1, imputations: 1 });
    const tennis = await query(
      `select coalesce(sum(amount), 0)::numeric as tennis from public.member_dues_entries where member_id = $1 and charge_scope = 'abono_tenis'`,
      [MEMBER],
    );
    expect(Number(tennis.rows[0].tennis)).toBe(12000);
    const scope = await query(`select meta->>'chargeScope' as scope from public.member_payments where member_id = $1`, [MEMBER]);
    expect(scope.rows[0].scope).toBe('cuota_social');
  });

  it('una reserva approved crea una sola reserva y no un pago de cuota', async () => {
    const id = '34343434-3434-4343-8343-343434343434';
    await insertIntent({
      id,
      kind: 'booking',
      amount: 25000,
      concept: 'Seña salón',
      meta: { booking: { facilityId: 'anhelo', date: '2026-12-01', time: '20:00', facilityName: 'Anhelo', depositAmount: 25000, estimatedPrice: 50000 } },
    });
    const result = await query(
      `select public.apply_mp_approved_payment($1, 'pay-booking', 'approved', 25000)::jsonb as result`,
      [id],
    );
    expect(result.rows[0].result.applied).toBe(true);
    const rows = await query(`select count(*)::int as reservations from public.reservations where meta->>'mpIntentId' = $1`, [id]);
    expect(rows.rows[0].reservations).toBe(1);
    const payments = await query(`select count(*)::int as n from public.member_payments where meta->>'mp_intent_id' = $1`, [id]);
    expect(payments.rows[0].n).toBe(0);
  });

  it('la adhesión authorized no marca el cobro como aplicado', async () => {
    const id = '35353535-3535-4353-8353-353535353535';
    await insertIntent({ id, kind: 'subscription', concept: 'Débito mensual' });
    const result = await query(`select public.apply_mp_subscription($1, 'pre-1', 'authorized')::jsonb as result`, [id]);
    expect(result.rows[0].result.adhesion).toBe('authorized');
    const row = await query(`select applied_at, status from public.mp_intents where id = $1`, [id]);
    expect(row.rows[0].applied_at).toBeNull();
    expect(row.rows[0].status).toBe('authorized');
  });

  it('rechaza un débito de otro socio y un concepto de tenis', async () => {
    const sub = '36363636-3636-4363-8363-363636363636';
    const charge = '37373737-3737-4373-8373-373737373737';
    await insertIntent({ id: sub, kind: 'subscription', concept: 'Suscripción' });
    await query(`update public.mp_intents set preapproval_id = 'pre-owner', status = 'authorized' where id = $1`, [sub]);
    await insertIntent({
      id: charge,
      member: OTHER,
      meta: { from_subscription: sub, chargeScope: 'cuota_social' },
    });
    await query(`update public.mp_intents set preapproval_id = 'pre-owner' where id = $1`, [charge]);
    await expect(query(
      `select public.apply_mp_approved_payment($1, 'pay-wrong', 'approved', 40000)`,
      [charge],
    )).rejects.toThrow(/socio de la suscripción/);

    const tennis = '38383838-3838-4383-8383-383838383838';
    await insertIntent({ id: tennis, concept: 'Abono tenis', meta: { chargeScope: 'abono_tenis' } });
    await expect(query(
      `select public.apply_mp_approved_payment($1, 'pay-tenis', 'approved', 40000)`,
      [tennis],
    )).rejects.toThrow(/tenis/);
  });

  it('dos cobros concurrentes dejan un solo pago', async () => {
    const id = '39393939-3939-4393-8393-393939393939';
    await insertIntent({ id, meta: { chargeScope: 'cuota_social' } });
    const left = await pool.connect();
    const right = await pool.connect();
    try {
      const results = await Promise.allSettled([
        left.query(`select public.apply_mp_approved_payment($1, 'pay-race', 'approved', 40000)::jsonb as result`, [id]),
        right.query(`select public.apply_mp_approved_payment($1, 'pay-race', 'approved', 40000)::jsonb as result`, [id]),
      ]);
      const applied = results.filter((item) => item.status === 'fulfilled' && item.value.rows[0].result.applied === true);
      expect(applied).toHaveLength(1);
      const payments = await query(`select count(*)::int as n from public.member_payments where meta->>'provider_payment_id' = 'pay-race'`);
      expect(payments.rows[0].n).toBe(1);
    } finally {
      left.release();
      right.release();
    }
  });

  it('la cola de recibos toma un solo proceso y anon no ejecuta las funciones', async () => {
    const id = '40404040-4040-4404-8404-404040404040';
    await insertIntent({ id });
    const left = await pool.connect();
    const right = await pool.connect();
    try {
      await left.query('begin');
      const first = await left.query(`select public.claim_mp_receipt_job($1) as result`, [id]);
      const secondPromise = right.query(`select public.claim_mp_receipt_job($1) as result`, [id]);
      await left.query('commit');
      const second = await secondPromise;
      expect(first.rows[0].result.claimed).toBe(true);
      expect(second.rows[0].result.claimed).toBe(false);
      await query(
        `select public.complete_mp_receipt_job($1, $2, 'mail-1', null, $3, 'MP-1', null)`,
        [id, '50505050-5050-4505-8505-505050505050', '51515151-5151-4515-8515-515151515151'],
      );
      const done = await query(`select public.claim_mp_receipt_job($1) as result`, [id]);
      expect(done.rows[0].result.status).toBe('sent');
    } finally {
      left.release();
      right.release();
    }

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role anon');
      await expect(client.query(`select public.apply_mp_approved_payment($1, 'x', 'approved', 1)`, [id]))
        .rejects.toThrow(/permission denied/);
      await client.query('rollback');
      await client.query('begin');
      await client.query('set local role anon');
      await expect(client.query(`select public.claim_mp_receipt_job($1)`, [id]))
        .rejects.toThrow(/permission denied/);
      await client.query('rollback');
    } finally {
      await client.query('rollback').catch(() => {});
      client.release();
    }
  });

  it('los 347 ajustes administrativos quedan iguales', async () => {
    const fingerprint = await ledgerFingerprint();
    expect(fingerprint.n).toBe(347);
    expect(Number(fingerprint.amount)).toBe(60378);
    expect(Number(fingerprint.collected)).toBe(0);
    expect(Number(fingerprint.pending)).toBe(60378);
  });
});
