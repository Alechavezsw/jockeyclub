import { describe, expect, it } from 'vitest';
import {
  createUnidentifiedCollection,
  matchUnidentifiedCollection,
  createPaymentOrder,
  setPaymentOrderStatus,
} from './treasury';

describe('treasury', () => {
  it('crea y matchea cobranza sin identificar', () => {
    const item = createUnidentifiedCollection({ amount: 1000, bankRef: 'X1' });
    expect(item.status).toBe('pending');
    const matched = matchUnidentifiedCollection(item, '20268877');
    expect(matched.status).toBe('matched');
    expect(matched.matchedMemberId).toBe('20268877');
  });

  it('aprueba orden de pago', () => {
    const op = createPaymentOrder({ payee: 'Acme', amount: 5000, concept: 'Test' });
    expect(op.status).toBe('draft');
    expect(setPaymentOrderStatus(op, 'approved').status).toBe('approved');
  });
});
