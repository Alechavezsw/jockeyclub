import { describe, expect, it } from 'vitest';
import { buildSurchargeComposition } from './surchargeComposition';

const TODAY = '2026-10-19';

function familiar(extra = {}) {
  return {
    memberId: '4240',
    name: 'Ana Pérez',
    firstName: 'Ana',
    lastName: 'Pérez',
    documentNumber: '30111222',
    tier: 'socio_familiar',
    status: 'active',
    lastPaymentDate: '2026-09-13',
    nextDueDate: '2026-10-10',
    outstandingBalance: 77000,
    ...extra,
  };
}

describe('buildSurchargeComposition', () => {
  it('toma el recargo en mora del mes impago', () => {
    const report = buildSurchargeComposition({
      members: [familiar()],
      today: TODAY,
    });
    expect(report.owed).toBe(7000);
    expect(report.rows.some((row) => row.status === 'adeudado' && row.amount === 7000)).toBe(true);
  });

  it('reconoce el recargo cobrado si pagó después del 10', () => {
    const report = buildSurchargeComposition({
      members: [familiar({
        outstandingBalance: 0,
        lastPaymentDate: '2026-10-12',
        nextDueDate: '2026-11-10',
        paymentHistory: [{ date: '2026-10-12', amount: 77000 }],
      })],
      today: TODAY,
    });
    expect(report.collected).toBe(7000);
    expect(report.owed).toBe(0);
  });

  it('filtra por socio', () => {
    const report = buildSurchargeComposition({
      members: [familiar(), familiar({ memberId: '88', outstandingBalance: 0, lastPaymentDate: '2026-10-05' })],
      memberNumber: '4240',
      today: TODAY,
    });
    expect(report.rows.every((row) => row.memberNumber === '4240')).toBe(true);
  });
});
