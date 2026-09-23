import { describe, expect, it } from 'vitest';
import { DEFAULT_CHART_OF_ACCOUNTS } from './chartOfAccounts';
import { buildJournalExcelAoA, JOURNAL_EXCEL_HEADERS } from './exportJournalExcel';

describe('buildJournalExcelAoA', () => {
  const entries = [
    {
      id: 'new',
      date: '2026-08-30',
      description: 'Canon pileta',
      status: 'posted',
      sourceModule: 'pileta',
      lines: [
        { account: 'Caja General', type: 'debit', amount: 5000 },
        { accountId: 'coa-4.1.01', debit: 0, credit: 5000 },
      ],
    },
    {
      id: 'old',
      date: '2026-08-01',
      description: 'Cuota',
      status: 'posted',
      sourceModule: 'cuotas',
      lines: [
        { account: 'Caja General', type: 'debit', amount: 32000 },
        { account: 'Cuotas Sociales', type: 'credit', amount: 32000 },
      ],
    },
    {
      id: 'voided',
      date: '2026-08-15',
      description: 'Anulado',
      status: 'void',
      lines: [{ account: 'Caja General', type: 'debit', amount: 1 }],
    },
  ];

  it('arma cabecera, omite anulados y numera del más antiguo al más nuevo', () => {
    const { aoa, count, totalDebe, totalHaber } = buildJournalExcelAoA(entries, {
      chart: DEFAULT_CHART_OF_ACCOUNTS,
    });
    expect(aoa[0]).toEqual(JOURNAL_EXCEL_HEADERS);
    expect(count).toBe(2);
    expect(aoa[1][0]).toBe(1);
    expect(aoa[1][2]).toBe('Cuota');
    expect(aoa[3][0]).toBe(2);
    expect(aoa[3][2]).toBe('Canon pileta');
    expect(totalDebe).toBe(37000);
    expect(totalHaber).toBe(37000);
    expect(aoa.some((row) => row.includes('Anulado'))).toBe(false);
  });
});
