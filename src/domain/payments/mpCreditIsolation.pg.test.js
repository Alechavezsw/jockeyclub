/**
 * Migración de Mercado Pago sobre PostgreSQL vacío.
 * No lee ni escribe la base de producción.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startEmbeddedPostgres, stopEmbeddedPostgres } from '../../test/embeddedPostgresHarness.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const migrationSql = readFileSync(
  join(root, 'supabase/migrations/20261123150000_mp_credit_only_approved_exact.sql'),
  'utf8',
);

const MEMBER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let cluster;
let databaseDir;
let pool;

const preFunctionSql = `
create or replace function public.apply_mp_approved_payment(
  p_intent_id uuid,
  p_provider_payment_id text,
  p_status text,
  p_paid_amount numeric
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_intent public.mp_intents%rowtype;
  v_status text;
  v_amount numeric(14, 2);
  v_bank uuid;
  v_income uuid;
  v_period uuid;
  v_entry uuid;
  v_payment uuid;
begin
  v_status := lower(coalesce(nullif(btrim(p_status), ''), 'pending'));
  select * into v_intent from public.mp_intents where id = p_intent_id for update;
  if v_intent.id is null then
    raise exception 'No está el cobro de Mercado Pago.';
  end if;
  if v_intent.applied_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'intent_id', v_intent.id);
  end if;

  update public.mp_intents
  set status = case
        when v_status in ('approved', 'authorized', 'rejected', 'cancelled', 'in_process', 'pending')
          then v_status
        else status
      end,
      provider_payment_id = coalesce(nullif(p_provider_payment_id, ''), provider_payment_id),
      updated_at = now()
  where id = v_intent.id;

  if v_status not in ('approved', 'authorized') then
    return jsonb_build_object('ok', true, 'applied', false, 'status', v_status);
  end if;

  if upper(coalesce(nullif(btrim(v_intent.currency), ''), 'ARS')) <> 'ARS' then
    raise exception 'Moneda de Mercado Pago inválida';
  end if;

  v_amount := round(coalesce(nullif(p_paid_amount, 0), v_intent.amount), 2);
  if v_amount <= 0 then
    raise exception 'Importe de Mercado Pago inválido.';
  end if;

  if abs(v_amount - round(v_intent.amount, 2)) > 0.05 then
    if v_amount < round(v_intent.amount, 2) - 0.05 then
      raise exception 'Importe acreditado menor al cobro declarado.';
    end if;
    if v_amount > round(v_intent.amount * 1.5, 2) + 0.05 then
      raise exception 'Importe acreditado no corresponde al cobro.';
    end if;
  end if;

  select id into v_bank from public.chart_of_accounts
  where is_active is true and code = '1.1.08' limit 1;
  select id into v_income from public.chart_of_accounts
  where is_active is true and code = '4.1.01' limit 1;
  select id into v_period from public.fiscal_periods
  where current_date between starts_on and ends_on limit 1;

  insert into public.journal_entries (
    fiscal_period_id, entry_date, concept, status, source_module, source_id
  ) values (
    v_period, current_date, v_intent.concept, 'posted', 'cuotas', v_intent.id
  ) returning id into v_entry;

  insert into public.journal_lines (journal_entry_id, account_id, line_order, debit, credit, memo)
  values
    (v_entry, v_bank, 1, v_amount, 0, 'Mercado Pago'),
    (v_entry, v_income, 2, 0, v_amount, v_intent.concept);

  insert into public.member_payments (
    member_id, amount, paid_at, method, concept, period_label, receipt_number, journal_entry_id, meta
  ) values (
    v_intent.member_id, v_amount, current_date, 'mercadopago', v_intent.concept, '11/2026',
    'MP-test', v_entry,
    jsonb_build_object(
      'mp_intent_id', v_intent.id,
      'provider_payment_id', p_provider_payment_id
    )
  ) returning id into v_payment;

  update public.mp_intents
  set status = 'approved', applied_at = now(), updated_at = now()
  where id = v_intent.id;

  return jsonb_build_object('ok', true, 'applied', true, 'intent_id', v_intent.id, 'member_payment_id', v_payment);
end;
$function$;
`;

async function query(text, params = []) {
  return pool.query(text, params);
}

async function counts() {
  const payments = await query('select count(*)::int as n from public.member_payments');
  const journals = await query('select count(*)::int as n from public.journal_entries');
  const imputations = await query(`select count(*)::int as n from public.member_dues_entries where kind = 'payment'`);
  return {
    payments: payments.rows[0].n,
    journals: journals.rows[0].n,
    imputations: imputations.rows[0].n,
  };
}

async function insertIntent({
  id,
  memberId = MEMBER,
  kind = 'dues',
  amount = 40000,
  currency = 'ARS',
  concept = 'Cuota social · Noviembre de 2026',
  meta = { chargeScope: 'cuota_social' },
  preapprovalId = null,
  status = 'pending',
}) {
  await query(
    `insert into public.mp_intents (
      id, kind, status, member_id, member_number, amount, currency, external_reference, concept, meta, preapproval_id
    ) values ($1, $2, $3, $4, '10500', $5, $6, $7, $8, $9::jsonb, $10)`,
    [id, kind, status, memberId, amount, currency, `ref-${id}`, concept, JSON.stringify(meta), preapprovalId],
  );
}

describe('Mercado Pago en PostgreSQL aislado', () => {
  beforeAll(async () => {
    const ctx = await startEmbeddedPostgres({
      label: 'jockey-mp',
      poolMax: 4,
      clusterOptions: {
        autoRehydrateSymlinks: true,
        initdbFlags: ['--encoding=UTF8', '--locale=C'],
      },
    });
    cluster = ctx.cluster;
    databaseDir = ctx.databaseDir;
    pool = ctx.pool;

    await query(`
      do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
      do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
      do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;

      create table public.members (
        id uuid primary key,
        full_name text,
        outstanding_balance numeric(14,2) default 0,
        overdue_since date,
        next_due_date date,
        payment_method text,
        meta jsonb default '{}'::jsonb,
        updated_at timestamptz default now()
      );
      create table public.mp_intents (
        id uuid primary key,
        kind text not null,
        status text not null,
        member_id uuid,
        member_number text,
        amount numeric(14,2) not null,
        currency text not null default 'ARS',
        external_reference text not null,
        concept text,
        payer_email text,
        preapproval_id text,
        provider_payment_id text,
        meta jsonb not null default '{}'::jsonb,
        applied_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table public.chart_of_accounts (
        id uuid primary key default gen_random_uuid(),
        code text,
        name text,
        is_active boolean default true
      );
      create table public.fiscal_periods (
        id uuid primary key default gen_random_uuid(),
        starts_on date,
        ends_on date
      );
      create table public.journal_entries (
        id uuid primary key default gen_random_uuid(),
        fiscal_period_id uuid,
        entry_date date,
        concept text,
        status text,
        source_module text,
        source_id uuid,
        posted_at timestamptz
      );
      create table public.journal_lines (
        id uuid primary key default gen_random_uuid(),
        journal_entry_id uuid,
        account_id uuid,
        line_order integer,
        debit numeric(14,2),
        credit numeric(14,2),
        memo text
      );
      create table public.member_payments (
        id uuid primary key default gen_random_uuid(),
        member_id uuid,
        amount numeric(14,2) not null,
        paid_at date,
        method text,
        concept text,
        period_label text,
        receipt_number text,
        journal_entry_id uuid,
        idempotency_key text,
        meta jsonb default '{}'::jsonb
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
        member_id uuid,
        due_on date,
        capital numeric(14,2),
        capital_open numeric(14,2),
        late_base numeric(14,2)
      );

      create function public.member_id_is_dues_exempt(mid uuid) returns boolean
      language sql stable as $$ select false $$;
      create function public.impute_dues_account_payment(
        p_member_id uuid, p_payment_id uuid, p_cash numeric, p_schedule jsonb, p_paid date
      ) returns numeric language sql as $$ select null::numeric $$;
      create function public.member_payment_posts_dues() returns trigger
      language plpgsql as $$
      begin
        insert into public.member_dues_entries (member_id, amount, kind, source)
        values (new.member_id, -least(new.amount, 999999999), 'payment', 'payment:' || new.id::text);
        return new;
      end $$;
      create trigger trg_member_payment_posts_dues
        after insert on public.member_payments
        for each row execute function public.member_payment_posts_dues();
    `);
    await query(preFunctionSql.replace(/\r\n/g, '\n'));
    await query(
      `insert into public.members (id, full_name, outstanding_balance) values ($1, 'Socio prueba', 40000), ($2, 'Otro socio', 12000)`,
      [MEMBER, OTHER],
    );
    await query(`insert into public.chart_of_accounts (code, name) values ('1.1.08', 'Mercado Pago'), ('4.1.01', 'Cuotas Sociales')`);
    await query(`insert into public.fiscal_periods (starts_on, ends_on) values (date '2026-01-01', date '2026-12-31')`);
    await query(
      `insert into public.member_dues_entries (member_id, amount, kind, source) values ($1::uuid, 40000, 'opening', 'opening:' || $1::text)`,
      [MEMBER],
    );

    await insertIntent({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
    const legacy = await query(
      `select public.apply_mp_approved_payment($1, 'legacy-auth', 'authorized', 40000)::jsonb as result`,
      ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
    );
    expect(legacy.rows[0].result.applied).toBe(true);

    await query(`
      delete from public.journal_lines;
      delete from public.journal_entries;
      delete from public.member_dues_entries;
      delete from public.member_payments;
      delete from public.mp_intents;
    `);
    await query(migrationSql.replace(/\r\n/g, '\n'));
    expect(migrationSql.includes('update public.member_dues_entries')).toBe(false);
  }, 180_000);

  afterAll(async () => {
    await stopEmbeddedPostgres({ pool, cluster, databaseDir });
  }, 60_000);

  it('rechaza estados distintos de approved, centavos distintos, cero y monedas que no son ARS', async () => {
    await insertIntent({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' });
    const authorized = await query(
      `select public.apply_mp_approved_payment($1, 'pay-auth', 'authorized', 40000)::jsonb as result`,
      ['dddddddd-dddd-4ddd-8ddd-dddddddddddd'],
    );
    expect(authorized.rows[0].result.applied).toBe(false);
    expect(authorized.rows[0].result.status).toBe('authorized');

    await insertIntent({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' });
    await expect(query(
      `select public.apply_mp_approved_payment($1, 'pay-cent', 'approved', 40000.01)`,
      ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'],
    )).rejects.toThrow(/centavos/);

    await insertIntent({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' });
    await expect(query(
      `select public.apply_mp_approved_payment($1, 'pay-zero', 'approved', 0)`,
      ['ffffffff-ffff-4fff-8fff-ffffffffffff'],
    )).rejects.toThrow(/Importe de Mercado Pago inválido/);

    await insertIntent({
      id: '12121212-1212-4121-8121-121212121212',
      currency: 'USD',
    });
    await expect(query(
      `select public.apply_mp_approved_payment($1, 'pay-usd', 'approved', 40000)`,
      ['12121212-1212-4121-8121-121212121212'],
    )).rejects.toThrow(/Moneda/);

    await insertIntent({
      id: '13131313-1313-4131-8131-131313131313',
      currency: '',
    });
    await expect(query(
      `select public.apply_mp_approved_payment($1, 'pay-blank', 'approved', 40000)`,
      ['13131313-1313-4131-8131-131313131313'],
    )).rejects.toThrow(/Moneda/);

    const afterRejects = await counts();
    expect(afterRejects).toEqual({ payments: 0, journals: 0, imputations: 0 });
  });

  it('un débito approved deja un pago, un asiento y una imputación, también si llega dos veces', async () => {
    const id = '14141414-1414-4141-8141-141414141414';
    await insertIntent({
      id,
      meta: { chargeScope: 'cuota_social', from_subscription: null },
    });
    await query(`update public.members set outstanding_balance = 40000 where id = $1`, [MEMBER]);
    await query(
      `insert into public.member_dues_entries (member_id, amount, kind, source)
       values ($1, 40000, 'opening', 'opening-approved')`,
      [MEMBER],
    );
    const first = await query(
      `select public.apply_mp_approved_payment($1, 'pay-ok', 'approved', 40000)::jsonb as result`,
      [id],
    );
    expect(first.rows[0].result.applied).toBe(true);
    const second = await query(
      `select public.apply_mp_approved_payment($1, 'pay-ok', 'approved', 40000)::jsonb as result`,
      [id],
    );
    expect(second.rows[0].result.already).toBe(true);
    expect(await counts()).toEqual({ payments: 1, journals: 1, imputations: 1 });
    const scope = await query(`select charge_scope from public.member_dues_entries where kind = 'payment'`);
    expect(scope.rows[0].charge_scope).toBe('cuota_social');
  });

  it('dos llamadas concurrentes no duplican el pago', async () => {
    const id = '15151515-1515-4151-8151-151515151515';
    await insertIntent({ id, meta: { chargeScope: 'cuota_social' } });
    const [left, right] = await Promise.all([
      pool.connect(),
      pool.connect(),
    ]);
    try {
      const call = (client) => client.query(
        `select public.apply_mp_approved_payment($1, 'pay-race', 'approved', 40000)::jsonb as result`,
        [id],
      );
      const results = await Promise.allSettled([call(left), call(right)]);
      const fulfilled = results.filter((row) => row.status === 'fulfilled').map((row) => row.value.rows[0].result);
      const applied = fulfilled.filter((row) => row.applied === true);
      expect(applied).toHaveLength(1);
      const raced = await query(
        `select
           (select count(*)::int from public.member_payments where meta->>'provider_payment_id' = 'pay-race') as payments,
           (select count(*)::int from public.journal_entries where source_id = $1) as journals`,
        [id],
      );
      expect(raced.rows[0]).toEqual({ payments: 1, journals: 1 });
    } finally {
      left.release();
      right.release();
    }
  });

  it('la adhesión authorized no marca el cobro ni mueve al otro socio', async () => {
    const id = '16161616-1616-4161-8161-161616161616';
    await insertIntent({
      id,
      kind: 'subscription',
      amount: 40000,
      status: 'pending',
      preapprovalId: 'pre-a',
      meta: {},
    });
    const paymentsBefore = await query(`select count(*)::int as n from public.member_payments`);
    const otherBefore = await query(`select payment_method, meta from public.members where id = $1`, [OTHER]);
    const adhesion = await query(
      `select public.apply_mp_subscription($1, 'pre-a', 'authorized')::jsonb as result`,
      [id],
    );
    expect(adhesion.rows[0].result.adhesion).toBe('authorized');
    const intent = await query(`select status, applied_at from public.mp_intents where id = $1`, [id]);
    expect(intent.rows[0].status).toBe('authorized');
    expect(intent.rows[0].applied_at).toBeNull();
    const owner = await query(`select meta->>'mpAdhesion' as adhesion from public.members where id = $1`, [MEMBER]);
    expect(owner.rows[0].adhesion).toBe('authorized');
    const otherAfter = await query(`select payment_method, meta from public.members where id = $1`, [OTHER]);
    expect(otherAfter.rows[0]).toEqual(otherBefore.rows[0]);
    const paymentsAfter = await query(`select count(*)::int as n from public.member_payments`);
    expect(paymentsAfter.rows[0].n).toBe(paymentsBefore.rows[0].n);
  });

  it('rechaza un débito asociado al socio equivocado', async () => {
    const subscriptionId = '17171717-1717-4171-8171-171717171717';
    const chargeId = '18181818-1818-4181-8181-181818181818';
    await insertIntent({
      id: subscriptionId,
      kind: 'subscription',
      status: 'authorized',
      preapprovalId: 'pre-b',
      meta: {},
    });
    await insertIntent({
      id: chargeId,
      memberId: OTHER,
      preapprovalId: 'pre-b',
      meta: { from_subscription: subscriptionId, chargeScope: 'cuota_social' },
    });
    await expect(query(
      `select public.apply_mp_approved_payment($1, 'pay-wrong', 'approved', 40000)`,
      [chargeId],
    )).rejects.toThrow(/socio de la suscripción/);
    const wrong = await query(`select count(*)::int as n from public.member_payments where member_id = $1`, [OTHER]);
    expect(wrong.rows[0].n).toBe(0);
  });

  it('un pago de cuota social no cancela el abono de tenis ya etiquetado', async () => {
    await query(
      `insert into public.member_dues_entries (member_id, amount, kind, source, charge_scope)
       values
         ($1, 12000, 'charge', 'tenis-forward', 'abono_tenis'),
         ($1, 40000, 'charge', 'social-forward', null)`,
      [OTHER],
    );
    const before = await query(
      `select
         coalesce(sum(amount) filter (where charge_scope = 'abono_tenis'), 0)::numeric as tennis,
         coalesce(sum(amount) filter (where coalesce(charge_scope, '') <> 'abono_tenis'), 0)::numeric as social
       from public.member_dues_entries where member_id = $1`,
      [OTHER],
    );
    const socialOpen = Number(before.rows[0].social);
    const total = socialOpen + Number(before.rows[0].tennis);
    await query(`update public.members set outstanding_balance = $2 where id = $1`, [OTHER, total]);
    await query(
      `insert into public.member_payments (member_id, amount, paid_at, method, concept, meta)
       values ($1, $2, current_date, 'efectivo', 'Cuota social', '{"chargeScope":"cuota_social"}'::jsonb)`,
      [OTHER, total],
    );
    const afterTennis = await query(
      `select coalesce(sum(amount), 0)::numeric as total
       from public.member_dues_entries
       where member_id = $1 and charge_scope = 'abono_tenis'`,
      [OTHER],
    );
    expect(Number(afterTennis.rows[0].total)).toBe(Number(before.rows[0].tennis));
    const socialCut = await query(
      `select amount from public.member_dues_entries
       where member_id = $1 and kind = 'payment' and charge_scope = 'cuota_social'
       order by created_at desc limit 1`,
      [OTHER],
    );
    expect(Number(socialCut.rows[0].amount)).toBe(-socialOpen);
  });

  it('anon y authenticated no pueden ejecutar las funciones de acreditación', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role anon');
      await expect(client.query(
        `select public.apply_mp_approved_payment('14141414-1414-4141-8141-141414141414', 'x', 'approved', 1)`,
      )).rejects.toThrow(/permission denied/i);
      await client.query('rollback');
      await client.query('begin');
      await client.query('set local role authenticated');
      await expect(client.query(
        `select public.apply_mp_subscription('16161616-1616-4161-8161-161616161616', 'pre-a', 'authorized')`,
      )).rejects.toThrow(/permission denied/i);
      await client.query('rollback');
    } finally {
      client.release();
    }
  });
});
