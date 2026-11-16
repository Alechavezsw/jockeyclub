import { describe, expect, it } from 'vitest';
import { verifyPoolCanonCircle } from './poolCircle';

describe('verifyPoolCanonCircle', () => {
  it('acepta efectivo con asiento, caja y cuenta', () => {
    const result = verifyPoolCanonCircle({
      method: 'efectivo',
      charged: {
        journalEntryId: 'je-1',
        cashMovementId: 'cm-1',
        payment: { amount: 5000, method: 'efectivo' },
        accountEntries: [
          { type: 'otro', source: 'pool_canon', value: 5000 },
          { type: 'pago', source: 'pool_canon', value: -5000 },
        ],
      },
    });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('exige banco/asiento en transferencia', () => {
    const bad = verifyPoolCanonCircle({
      method: 'transferencia',
      charged: {
        payment: { amount: 5000, method: 'transferencia' },
        accountEntries: [
          { type: 'otro', source: 'pool_canon', value: 5000 },
          { type: 'pago', source: 'pool_canon', value: -5000 },
        ],
      },
    });
    expect(bad.ok).toBe(false);
    expect(bad.issues.some((m) => /asiento|banco/i.test(m))).toBe(true);

    const good = verifyPoolCanonCircle({
      method: 'transferencia',
      charged: {
        journalEntryId: 'je-2',
        payment: { amount: 5000, method: 'transferencia', bankJournal: 'Banco Macro' },
        accountEntries: [
          { type: 'otro', source: 'pool_canon', value: 5000 },
          { type: 'pago', source: 'pool_canon', value: -5000 },
        ],
      },
    });
    expect(good.ok).toBe(true);
  });

  it('no exige caja en Mercado Pago pendiente de webhook', () => {
    const result = verifyPoolCanonCircle({
      method: 'mercadopago',
      charged: { payment: { amount: 5000, method: 'mercadopago' } },
    });
    expect(result.ok).toBe(true);
  });
});
