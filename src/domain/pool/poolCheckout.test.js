import { describe, expect, it } from 'vitest';
import {
  applyPoolAccountPass,
  buildPoolAccountEntries,
  chargePoolCanon,
  POOL_MP_PENDING,
} from './poolCheckout';

const entry = {
  id: 'pool-1',
  date: '2026-09-27',
  kind: 'member',
  memberId: '100',
  memberName: 'Ana Pérez',
  payment: { amount: 5000, method: 'efectivo', concept: 'Canon pileta socio' },
};

describe('chargePoolCanon', () => {
  it('manda el efectivo a la caja y deja cargo+pago en la cuenta del socio', async () => {
    const charged = await chargePoolCanon({
      entry,
      member: {
        id: '11111111-1111-4111-8111-111111111111',
        memberId: '100',
        name: 'Ana Pérez',
      },
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
    expect(charged.accountEntries).toHaveLength(2);
    expect(charged.accountEntries[0]).toMatchObject({
      type: 'otro',
      source: 'pool_canon',
      memberNumber: '100',
      value: 5000,
    });
    expect(charged.accountEntries[1]).toMatchObject({
      type: 'pago',
      source: 'pool_canon',
      memberNumber: '100',
      value: -5000,
    });
  });

  it('no cobra la asistencia ni escribe cuenta', async () => {
    const charged = await chargePoolCanon({
      entry: { ...entry, payment: { amount: 0, method: 'asistencia' } },
      member: { id: 'm1', memberId: '100' },
      recordPoolCanon: () => {
        throw new Error('no debería cobrar');
      },
    });
    expect(charged.memberDbId).toBe('m1');
    expect(charged.journalEntryId).toBeUndefined();
    expect(charged.accountEntries).toEqual([]);
  });

  it('deja Mercado Pago para la app', async () => {
    await expect(chargePoolCanon({
      entry: { ...entry, payment: { ...entry.payment, method: 'mercadopago' } },
      member: { name: 'Ana' },
      recordPoolCanon: async () => ({ journalEntry: { id: 'x' }, movement: { id: 'y' } }),
    })).rejects.toThrow(POOL_MP_PENDING);
  });
});

describe('buildPoolAccountEntries / applyPoolAccountPass', () => {
  it('no mueve el saldo de cuota (cargo + pago = neto 0)', () => {
    const rows = buildPoolAccountEntries({
      entry: { ...entry, cashMovementId: 'cm-1' },
      member: { memberId: '100', name: 'Ana Pérez' },
    });
    const next = applyPoolAccountPass(
      [{ memberId: '100', outstandingBalance: 32000 }],
      rows,
    );
    expect(next[0].outstandingBalance).toBe(32000);
  });

  it('anota el invitado en la cuenta del anfitrión', () => {
    const rows = buildPoolAccountEntries({
      entry: {
        ...entry,
        id: 'pool-guest-1',
        kind: 'guest',
        guestName: 'Juan',
        hostMemberId: '100',
      },
      member: { memberId: '100', name: 'Ana Pérez' },
    });
    expect(rows[0].description).toMatch(/invitado/i);
    expect(rows[0].memberNumber).toBe('100');
  });
});
