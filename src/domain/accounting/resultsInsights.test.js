import { describe, expect, it } from 'vitest';
import { DEFAULT_CHART_OF_ACCOUNTS } from './chartOfAccounts';
import { buildResultsInsights, monthLabelAR } from './resultsInsights';

describe('buildResultsInsights', () => {
  it('arma mix, meses y omite asientos anulados', () => {
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
        sourceModule: 'cuotas',
        lines: [
          { accountId: 'coa-1.1.01', debit: 999, credit: 0 },
          { accountId: 'coa-4.1.01', debit: 0, credit: 999 },
        ],
      },
    ];

    const insights = buildResultsInsights(entries, DEFAULT_CHART_OF_ACCOUNTS);
    expect(insights.asientos).toBe(2);
    expect(insights.income).toBe(43000);
    expect(insights.expense).toBe(0);
    expect(insights.result).toBe(43000);
    expect(insights.incomeMix[0]).toEqual({ label: 'Cuotas Sociales', amount: 38000 });
    expect(insights.sourceMix.find((row) => row.label === 'cuotas')?.amount).toBe(38000);
    expect(insights.series.map((row) => row.month)).toEqual(['2026-08', '2026-09']);
    expect(insights.series[1].income).toBe(5000);
    expect(insights.avgMonthlyIncome).toBe(21500);
    expect(insights.concentration).toBeCloseTo(38000 / 43000);
    expect(insights.topIncome).toEqual({ label: 'Cuotas Sociales', amount: 38000 });
    expect(insights.bestMonth.month).toBe('2026-08');
    expect(insights.lastMonth).toBe('2026-09');
    expect(insights.lastMonthRow.result).toBe(5000);
    expect(insights.lastDelta).toBe(-33000);
    expect(insights.surplusMonths).toBe(2);
    expect(monthLabelAR('2026-08')).toBe('ago 2026');
  });
});
