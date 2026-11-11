import { describe, expect, it } from 'vitest';
import { buildSubscriptionRows, subscriptionStatusLabel } from './subscriptions';

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
      [{ id: 'm1', full_name: 'Familiar de prueba', member_number: '10500' }],
    );
    expect(rows.map((row) => row.statusLabel)).toEqual(['Activa', 'Pendiente']);
    expect(rows[0].name).toBe('Familiar de prueba');
    expect(rows[0].amount).toBe(70000);
    expect(rows[0].lastCharge.concept).toMatch(/Noviembre de 2026/);
    expect(rows[0].lastCharge.credited).toBe(true);
    expect(rows[1].lastCharge).toBeNull();
  });
});
