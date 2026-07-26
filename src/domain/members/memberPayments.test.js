import { describe, expect, it } from 'vitest';
import { payMemberDues } from './memberPayments';

describe('payMemberDues', () => {
  it('clears debt and appends payment history', () => {
    const member = {
      memberId: '2026887744320988',
      name: 'Test',
      tier: 'gold',
      outstandingBalance: 32000,
      nextDueDate: '2026-06-01',
      paymentHistory: [],
    };
    const { member: next, payment, fullyPaid } = payMemberDues(member, {
      method: 'mercadopago',
      today: new Date('2026-07-24T12:00:00'),
    });
    expect(fullyPaid).toBe(true);
    expect(next.outstandingBalance).toBe(0);
    expect(next.paymentHistory[0].id).toBe(payment.id);
    expect(payment.amount).toBe(32000);
    expect(next.nextDueDate > '2026-06-01').toBe(true);
  });
});
