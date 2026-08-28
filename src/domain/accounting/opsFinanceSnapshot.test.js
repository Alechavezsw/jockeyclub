import { describe, expect, it } from 'vitest';
import { buildOpsFinanceSnapshot } from './opsFinanceSnapshot';
import { DEFAULT_CHART_OF_ACCOUNTS } from './chartOfAccounts';

describe('buildOpsFinanceSnapshot', () => {
  const today = new Date('2026-08-12T12:00:00');

  it('calcula deuda y recaudación real del mes desde socios', () => {
    const snap = buildOpsFinanceSnapshot({
      today,
      chartOfAccounts: DEFAULT_CHART_OF_ACCOUNTS,
      getAccountBalance: () => 0,
      members: [
        {
          memberId: '1',
          name: 'Ana',
          tier: 'gold',
          status: 'active',
          outstandingBalance: 32000,
          paymentHistory: [],
        },
        {
          memberId: '2',
          name: 'Luis',
          tier: 'gold',
          status: 'active',
          outstandingBalance: 0,
          paymentHistory: [
            { id: 'p1', date: '2026-08-05', amount: 32000, concept: 'Cuota social', status: 'paid' },
          ],
        },
      ],
      journalEntries: [],
    });

    expect(snap.debtTotal).toBe(32000);
    expect(snap.debtors).toBe(1);
    expect(snap.collectedMonth).toBe(32000);
    expect(snap.collectionRate).toBe(50);
    expect(snap.recentIncomes).toHaveLength(1);
  });

  it('separa ingresos de hoy del resto del mes', () => {
    const snap = buildOpsFinanceSnapshot({
      today,
      chartOfAccounts: DEFAULT_CHART_OF_ACCOUNTS,
      getAccountBalance: () => 0,
      members: [
        {
          memberId: '2',
          name: 'Luis',
          tier: 'gold',
          status: 'active',
          outstandingBalance: 0,
          paymentHistory: [
            { id: 'p1', date: '2026-08-05', amount: 32000, concept: 'Cuota social', status: 'paid' },
            { id: 'p2', date: '2026-08-12', amount: 15000, concept: 'Cuota social', status: 'paid' },
          ],
        },
      ],
      journalEntries: [],
    });

    expect(snap.collectedToday).toBe(15000);
    expect(snap.todayIncomes).toHaveLength(1);
    expect(snap.todayIncomes[0].amount).toBe(15000);
    expect(snap.collectedMonth).toBe(47000);
  });
});
