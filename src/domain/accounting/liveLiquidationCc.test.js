import { describe, expect, it } from 'vitest';
import {
  buildLiveLiquidationCc,
  filterLiquidationCc,
  liveLiquidationCcBook,
} from './liveLiquidationCc';

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

describe('cta cte viva', () => {
  it('parte octubre con cuota y recargo del 10 %', () => {
    const book = buildLiveLiquidationCc([familiar()], { today: TODAY });
    const october = liveLiquidationCcBook(book, '2026-10');
    expect(october.items).toHaveLength(1);
    expect(october.items[0]).toMatchObject({
      memberNumber: '4240',
      liquidation: 70000,
      surcharge: 7000,
      previousBalance: 0,
      others: 0,
      standing: 'En mora',
    });
    expect(october.summary.liquidation).toBe(70000);
    expect(october.summary.surcharge).toBe(7000);
    expect(october.summary.withLiquidation).toBe(1);
  });

  it('deja los meses previos en saldo anterior y el recargo viejo en intereses', () => {
    const book = buildLiveLiquidationCc([
      familiar({
        lastPaymentDate: '2026-08-13',
        nextDueDate: '2026-09-10',
        outstandingBalance: 500000,
      }),
    ], { today: TODAY });
    const october = liveLiquidationCcBook(book, '2026-10');
    expect(october.items[0].liquidation).toBe(70000);
    expect(october.items[0].surcharge).toBe(7000);
    expect(october.items[0].previousBalance).toBe(417000);
    expect(october.items[0].interests).toBe(6000);
    expect(filterLiquidationCc(october.items, { onlyLiquidation: true })).toHaveLength(1);
  });

  it('omite comisión y a quien está al día', () => {
    const book = buildLiveLiquidationCc([
      familiar({ tier: 'comision', outstandingBalance: 50000 }),
      familiar({
        memberId: '99',
        outstandingBalance: 0,
        lastPaymentDate: '2026-10-12',
        nextDueDate: '2026-11-10',
      }),
    ], { today: TODAY });
    expect(liveLiquidationCcBook(book, '2026-10').items).toHaveLength(0);
  });
});
