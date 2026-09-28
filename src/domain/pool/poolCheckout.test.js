import { describe, expect, it } from 'vitest';
import { chargePoolCanon, POOL_MP_PENDING } from './poolCheckout';

const entry = {
  id: 'pool-1',
  date: '2026-09-27',
  kind: 'member',
  memberId: '100',
  memberName: 'Ana Pérez',
  payment: { amount: 5000, method: 'efectivo', concept: 'Canon pileta socio' },
};

describe('chargePoolCanon', () => {
  it('manda el efectivo a la caja y guarda los ids del asiento', async () => {
    const charged = await chargePoolCanon({
      entry,
      member: { id: '11111111-1111-4111-8111-111111111111', name: 'Ana Pérez' },
      recordPoolCanon: async (payload) => {
        expect(payload.amount).toBe(5000);
        expect(payload.concept).toBe('Canon pileta — Ana Pérez');
        expect(payload.memberDbId).toBe('11111111-1111-4111-8111-111111111111');
        return {
          journalEntry: { id: 'je-1' },
          movement: { id: 'cm-1' },
        };
      },
    });
    expect(charged.journalEntryId).toBe('je-1');
    expect(charged.cashMovementId).toBe('cm-1');
    expect(charged.memberDbId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('no cobra la asistencia', async () => {
    const charged = await chargePoolCanon({
      entry: { ...entry, payment: { amount: 0, method: 'asistencia' } },
      member: { id: 'm1' },
      recordPoolCanon: () => {
        throw new Error('no debería cobrar');
      },
    });
    expect(charged.memberDbId).toBe('m1');
    expect(charged.journalEntryId).toBeUndefined();
  });

  it('deja Mercado Pago para la app', async () => {
    await expect(chargePoolCanon({
      entry: { ...entry, payment: { ...entry.payment, method: 'mercadopago' } },
      member: { name: 'Ana' },
      recordPoolCanon: async () => ({ journalEntry: { id: 'x' }, movement: { id: 'y' } }),
    })).rejects.toThrow(POOL_MP_PENDING);
  });
});
