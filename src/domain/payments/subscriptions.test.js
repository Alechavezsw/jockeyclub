import { describe, expect, it } from 'vitest';
import {
  buildSubscriptionRows,
  findBlockingSubscription,
  memberOwesDuesBeforeSubscription,
  subscriptionBlocksNewAdhesion,
  subscriptionStatusLabel,
  summarizeSubscriptionRows,
} from './subscriptions';

describe('suscripciones de cuota', () => {
  it('nombra el estado y junta el último débito de cada socio', () => {
    expect(subscriptionStatusLabel('authorized')).toBe('Activa');
    const rows = buildSubscriptionRows(
      [
        {
          id: 'sub-1',
          status: 'authorized',
          member_id: 'm1',
          member_number: '10500',
          amount: 70000,
          payer_email: 'socio@mail.com',
          applied_at: '2026-11-01T12:00:00Z',
        },
        {
          id: 'sub-2',
          status: 'pending',
          member_id: 'm2',
          amount: 40000,
          created_at: '2026-11-11T12:00:00Z',
        },
      ],
      [
        {
          id: 'pay-old',
          status: 'approved',
          amount: 70000,
          concept: 'Cuota social · Octubre de 2026',
          applied_at: '2026-10-10T12:00:00Z',
          meta: { from_subscription: 'sub-1', channel: 'subscription' },
        },
        {
          id: 'pay-new',
          status: 'approved',
          amount: 70000,
          concept: 'Cuota social · Noviembre de 2026',
          applied_at: '2026-11-10T12:00:00Z',
          meta: { from_subscription: 'sub-1', channel: 'subscription' },
        },
      ],
      [{ id: 'm1', full_name: 'Familiar de prueba', member_number: '10500', phone: '264111', tier: 'Familiar' }],
    );
    expect(rows.map((row) => row.statusLabel)).toEqual(['Activa', 'Pendiente']);
    expect(rows[0].name).toBe('Familiar de prueba');
    expect(rows[0].phone).toBe('264111');
    expect(rows[0].amount).toBe(70000);
    expect(rows[0].chargeCount).toBe(2);
    expect(rows[0].creditedCount).toBe(2);
    expect(rows[0].lastCharge.concept).toMatch(/Noviembre de 2026/);
    expect(rows[0].lastCharge.credited).toBe(true);
    expect(rows[1].lastCharge).toBeNull();
  });

  it('oculta adhesiones repetidas del mismo socio y deja la más reciente', () => {
    const rows = buildSubscriptionRows(
      [
        {
          id: 'old',
          status: 'pending',
          member_id: 'm9',
          member_number: '100630',
          amount: 70000,
          created_at: '2026-11-19T10:00:00Z',
          preapproval_id: 'aaaa1111bbbb2222cccc3333',
        },
        {
          id: 'new',
          status: 'pending',
          member_id: 'm9',
          member_number: '100630',
          amount: 70000,
          created_at: '2026-11-19T18:00:00Z',
          preapproval_id: 'zzzz9999yyyy8888xxxx7777',
        },
      ],
      [],
      [{ id: 'm9', full_name: 'Noelia', member_number: '100630' }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('new');
    expect(rows[0].hasDuplicates).toBe(true);
    expect(rows[0].duplicateTotal).toBe(2);
    expect(rows[0].preapprovalShort).toMatch(/zzzz99/);

    const all = buildSubscriptionRows(
      [
        {
          id: 'old',
          status: 'pending',
          member_id: 'm9',
          amount: 70000,
          created_at: '2026-11-19T10:00:00Z',
        },
        {
          id: 'new',
          status: 'pending',
          member_id: 'm9',
          amount: 70000,
          created_at: '2026-11-19T18:00:00Z',
        },
      ],
      [],
      [{ id: 'm9', full_name: 'Noelia', member_number: '100630' }],
      { hideDuplicates: false },
    );
    expect(all).toHaveLength(2);
    expect(all.filter((row) => row.duplicateOf)).toHaveLength(1);
  });

  it('no deja adherirse si hay deuda de cuota', () => {
    expect(memberOwesDuesBeforeSubscription({ outstanding: 0 })).toBe(false);
    expect(memberOwesDuesBeforeSubscription({ outstanding: 70000 })).toBe(true);
    expect(memberOwesDuesBeforeSubscription({ monthsBehind: 1 })).toBe(true);
    expect(memberOwesDuesBeforeSubscription({ payable: 40000 })).toBe(true);
  });

  it('bloquea una segunda adhesión si ya hay una abierta', () => {
    expect(subscriptionBlocksNewAdhesion('pending')).toBe(true);
    expect(subscriptionBlocksNewAdhesion('authorized')).toBe(true);
    expect(subscriptionBlocksNewAdhesion('cancelled')).toBe(false);
    const blocking = findBlockingSubscription([
      { id: 'a', kind: 'subscription', status: 'pending', created_at: '2026-11-19T10:00:00Z' },
      { id: 'b', kind: 'subscription', status: 'pending', created_at: '2026-11-19T18:00:00Z' },
      { id: 'c', kind: 'subscription', status: 'cancelled', created_at: '2026-11-20T10:00:00Z' },
    ]);
    expect(blocking.id).toBe('b');
    expect(findBlockingSubscription([
      { id: 'p', kind: 'subscription', status: 'pending', created_at: '2026-11-19T18:00:00Z' },
      { id: 'a', kind: 'subscription', status: 'authorized', created_at: '2026-11-01T10:00:00Z' },
    ]).id).toBe('a');
  });

  it('resume activas, pendientes y monto mensual', () => {
    const summary = summarizeSubscriptionRows([
      { active: true, statusLabel: 'Activa', amount: 70000, chargeCount: 1, hasDuplicates: false },
      { active: false, statusLabel: 'Pendiente', amount: 70000, chargeCount: 0, hasDuplicates: true },
      { active: false, statusLabel: 'Cancelada', amount: 40000, chargeCount: 0, hasDuplicates: false },
    ]);
    expect(summary).toMatchObject({
      total: 3,
      active: 1,
      pending: 1,
      cancelled: 1,
      monthlyActive: 70000,
      withCharges: 1,
      duplicates: 1,
    });
  });
});
