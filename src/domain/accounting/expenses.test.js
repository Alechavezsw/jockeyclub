import { describe, expect, it } from 'vitest';
import { DEFAULT_CHART_OF_ACCOUNTS } from './chartOfAccounts';
import {
  buildLiveExpenses,
  expensePaymentAccounts,
  payExpense,
} from './expenses';

const TODAY = new Date('2026-10-19T15:00:00-03:00');

describe('gastos vivos', () => {
  it('pagar con solo admite caja y bancos', () => {
    const ids = expensePaymentAccounts(DEFAULT_CHART_OF_ACCOUNTS).map((account) => account.code);
    expect(ids).toEqual(['1.1.01', '1.1.02', '1.1.03', '1.1.07']);
  });

  it('a desembolsar es pendientes más aprobados', () => {
    const live = buildLiveExpenses({
      today: TODAY,
      expenses: [
        { id: '1', status: 'pending_approval', amount: 100, expenseDate: '2026-10-18' },
        { id: '2', status: 'approved', amount: 40, expenseDate: '2026-10-19' },
        { id: '3', status: 'paid', amount: 70, expenseDate: '2026-10-05' },
        { id: '4', status: 'void', amount: 999, expenseDate: '2026-10-19' },
      ],
    });
    expect(live.asOf).toBe('2026-10-19');
    expect(live.pendingAmount).toBe(100);
    expect(live.approvedAmount).toBe(40);
    expect(live.toPay).toBe(140);
    expect(live.paidMonthAmount).toBe(70);
    expect(live.cards.find((card) => card.id === 'to-pay')?.value).toBe(140);
  });

  it('al pagar asienta contra tesorería', () => {
    const { expense, journalEntry } = payExpense({
      id: 'exp-1',
      status: 'approved',
      amount: 50,
      concept: 'Insumos',
      vendorName: 'Corralón',
      categoryAccountId: 'coa-5.1.04',
      paymentAccountId: 'coa-1.1.01',
      expenseDate: '2026-10-19',
    }, DEFAULT_CHART_OF_ACCOUNTS);
    expect(expense.status).toBe('paid');
    expect(journalEntry.sourceModule).toBe('gastos');
    expect(journalEntry.date).toBe('2026-10-19');
  });
});
