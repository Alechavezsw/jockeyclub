import { describe, expect, it } from 'vitest';
import { settleSubscriptionCharge } from '../../../supabase/functions/_shared/mpSubscriptionCharge.js';

function memoryAdmin(seed = []) {
  const intents = seed.map((row) => ({ ...row, meta: { ...(row.meta || {}) } }));
  const rpcCalls = [];
  const notices = [];
  const receipts = [];
  const applyQueue = new Map();
  let insertChain = Promise.resolve();

  function matched(filters) {
    return intents.filter((row) => filters.every((fn) => fn(row)));
  }

  function query() {
    const filters = [];
    const api = {
      select() { return api; },
      eq(column, value) {
        filters.push((row) => row[column] === value);
        return api;
      },
      in(column, values) {
        filters.push((row) => values.includes(row[column]));
        return api;
      },
      contains(column, expected) {
        filters.push((row) => Object.entries(expected).every(([key, value]) => row[column]?.[key] === value));
        return api;
      },
      order() { return api; },
      limit() { return api; },
      maybeSingle() {
        const found = matched(filters).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
        return Promise.resolve({ data: found[0] || null, error: null });
      },
      single() {
        return api.maybeSingle().then((result) => {
          if (!result.data) return { data: null, error: { message: 'no row' } };
          return result;
        });
      },
    };
    return api;
  }

  return {
    intents,
    rpcCalls,
    notices,
    receipts,
    from(table) {
      if (table !== 'mp_intents') throw new Error(table);
      return {
        select() { return query(); },
        insert(row) {
          const run = insertChain.then(async () => {
            const taken = intents.some((item) => item.meta?.authorized_payment_id
              && item.meta.authorized_payment_id === row.meta?.authorized_payment_id);
            if (taken) return { data: null, error: { code: '23505', message: 'duplicate key' } };
            const saved = {
              ...row,
              id: row.id || crypto.randomUUID(),
              applied_at: null,
              created_at: new Date().toISOString(),
            };
            intents.push(saved);
            return { data: saved, error: null };
          });
          insertChain = run.then(() => {}, () => {});
          return {
            select() {
              return { single: () => run };
            },
          };
        },
      };
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      if (name !== 'apply_mp_approved_payment') return { data: null, error: null };
      const intent = intents.find((row) => row.id === args.p_intent_id);
      if (!intent) return { data: null, error: { message: 'missing' } };
      if (String(args.p_status) !== 'approved') {
        intent.status = args.p_status;
        return { data: { applied: false }, error: null };
      }
      return { data: null, error: { message: 'approved debe pasar por applyCheckoutPayment' } };
    },
    async applyCheckoutPayment(intentId) {
      const previous = applyQueue.get(intentId) || Promise.resolve();
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      applyQueue.set(intentId, previous.then(() => gate));
      await previous;
      try {
        const intent = intents.find((row) => row.id === intentId);
        if (!intent) return { error: 'Intent no encontrado.' };
        if (intent.applied_at) return { ok: true, already: true, applied: false };
        intent.applied_at = new Date().toISOString();
        intent.status = 'approved';
        receipts.push(intentId);
        return { ok: true, applied: true, receipt: { intentId } };
      } finally {
        release();
      }
    },
    async notifyDebitFailed(subscription, info) {
      notices.push({ subscription: subscription.id, ...info });
      return { emailed: false };
    },
  };
}

const memberA = '11111111-1111-4111-8111-111111111111';
const memberB = '22222222-2222-4222-8222-222222222222';
const subscription = {
  id: '33333333-3333-4333-8333-333333333333',
  kind: 'subscription',
  status: 'authorized',
  member_id: memberA,
  member_number: '10500',
  amount: 40000,
  payer_email: 'socio@example.com',
  preapproval_id: 'pre-1',
  created_at: '2026-11-01T12:00:00.000Z',
  meta: {},
};

function debit(status, extra = {}) {
  return {
    preapproval_id: 'pre-1',
    debit_date: '2026-11-20',
    payment: {
      id: 'pay-1',
      status,
      transaction_amount: 40000,
      currency_id: 'ARS',
      date_approved: '2026-11-20T15:00:00.000Z',
      ...extra,
    },
  };
}

async function settle(admin, pay, remoteId = 'auth-1') {
  return settleSubscriptionCharge({
    admin,
    remoteId,
    pay,
    applyCheckoutPayment: (...args) => admin.applyCheckoutPayment(...args),
    notifyDebitFailed: (...args) => admin.notifyDebitFailed(...args),
  });
}

describe('débito recurrente de Mercado Pago', () => {
  it('la adhesión authorized no genera pago ni recibo', async () => {
    const admin = memoryAdmin([subscription]);
    const result = await settle(admin, debit('authorized'), 'auth-adhesion');
    expect(result.http).toBe(200);
    expect(result.body.applied).toBe(false);
    expect(admin.receipts).toEqual([]);
    expect(admin.rpcCalls.filter((row) => row.name === 'apply_mp_approved_payment').map((row) => row.args.p_status)).toEqual(['authorized']);
    expect(admin.intents.find((row) => row.kind === 'dues')?.applied_at ?? null).toBeNull();
  });

  it('pending y rejected no acreditan', async () => {
    const pending = memoryAdmin([subscription]);
    const pendingResult = await settle(pending, debit('pending'), 'auth-pending');
    expect(pendingResult.body.applied).toBe(false);
    expect(pending.receipts).toEqual([]);
    expect(pending.rpcCalls.find((row) => row.name === 'apply_mp_approved_payment').args.p_status).toBe('pending');

    const rejected = memoryAdmin([subscription]);
    const rejectedResult = await settle(rejected, debit('rejected'), 'auth-rejected');
    expect(rejectedResult.body.kind).toBe('subscription_charge_failed');
    expect(rejected.receipts).toEqual([]);
    expect(rejected.notices).toHaveLength(1);
  });

  it('un débito approved genera un solo recibo y el repetido no suma otro', async () => {
    const admin = memoryAdmin([subscription]);
    const first = await settle(admin, debit('approved'));
    const second = await settle(admin, debit('approved'));
    expect(first.body.applied).toBe(true);
    expect(first.body.receipt.intentId).toBeTruthy();
    expect(second.body.applied).toBe(false);
    expect(second.body.already).toBe(true);
    expect(admin.receipts).toHaveLength(1);
    expect(admin.intents.filter((row) => row.kind === 'dues')).toHaveLength(1);
    const charge = admin.intents.find((row) => row.kind === 'dues');
    expect(charge.member_id).toBe(memberA);
    expect(charge.meta.chargeScope).toBe('cuota_social');
    expect(charge.concept).toBe('Cuota social · Noviembre de 2026');
  });

  it('dos webhooks concurrentes dejan un solo recibo', async () => {
    const admin = memoryAdmin([subscription]);
    const [left, right] = await Promise.all([
      settle(admin, debit('approved'), 'auth-race'),
      settle(admin, debit('approved'), 'auth-race'),
    ]);
    const applied = [left, right].filter((row) => row.body.applied === true);
    expect(applied).toHaveLength(1);
    expect(admin.receipts).toHaveLength(1);
    expect(admin.intents.filter((row) => row.kind === 'dues')).toHaveLength(1);
  });

  it('no imputa el débito al socio de otra suscripción', async () => {
    const admin = memoryAdmin([
      subscription,
      {
        id: '44444444-4444-4444-8444-444444444444',
        kind: 'dues',
        member_id: memberB,
        applied_at: null,
        meta: { authorized_payment_id: 'auth-1' },
      },
    ]);
    const result = await settle(admin, debit('approved'));
    expect(result.http).toBe(200);
    expect(result.body.applied).toBe(false);
    expect(result.body.error).toMatch(/socio de la suscripción/);
    expect(admin.receipts).toEqual([]);
  });
});
