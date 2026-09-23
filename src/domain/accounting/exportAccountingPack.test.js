import { describe, expect, it } from 'vitest';
import { DEFAULT_CHART_OF_ACCOUNTS } from './chartOfAccounts';
import { buildAccountingPack } from './exportAccountingPack';

describe('buildAccountingPack', () => {
  it('arma resultados, comprobación y mayor desde el diario oficial', () => {
    const entries = [
      {
        id: 'a',
        date: '2026-08-13',
        status: 'posted',
        sourceModule: 'cuotas',
        lines: [
          { accountId: 'coa-1.1.01', debit: 38000, credit: 0 },
          { accountId: 'coa-4.1.01', debit: 0, credit: 38000 },
        ],
      },
      {
        id: 'b',
        date: '2026-09-02',
        status: 'posted',
        sourceModule: 'pileta',
        lines: [
          { accountId: 'coa-1.1.01', debit: 5000, credit: 0 },
          { accountId: 'coa-4.1.02', debit: 0, credit: 5000 },
        ],
      },
      {
        id: 'c',
        date: '2026-09-02',
        status: 'void',
        lines: [
          { accountId: 'coa-1.1.01', debit: 999, credit: 0 },
          { accountId: 'coa-4.1.01', debit: 0, credit: 999 },
        ],
      },
    ];

    const pack = buildAccountingPack(entries, DEFAULT_CHART_OF_ACCOUNTS);
    expect(pack.asientos).toBe(2);
    expect(pack.totals.ingresos).toBe(43000);
    expect(pack.totals.gastos).toBe(0);
    expect(pack.totals.resultado).toBe(43000);
    expect(pack.totals.activos).toBe(43000);
    expect(pack.totals.squared).toBe(true);
    expect(pack.totals.trialDebe).toBe(pack.totals.trialHaber);
    expect(pack.mayor.some((row) => row.id === 'coa-1.1.01' && row.lines.length === 2)).toBe(true);
    expect(pack.insights.incomeMix[0].label).toBe('Cuotas Sociales');
  });
});
