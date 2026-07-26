import { describe, expect, it } from 'vitest';
import { DEFAULT_CHART_OF_ACCOUNTS } from './chartOfAccounts';
import {
  buildCashTransferEntry,
  counterpartAccountsForMovement,
  closedSessions,
} from './cash';

describe('counterpartAccountsForMovement', () => {
  it('limits income counterparts to income/liability', () => {
    const list = counterpartAccountsForMovement(DEFAULT_CHART_OF_ACCOUNTS, 'income');
    expect(list.every((a) => a.accountType === 'income' || a.accountType === 'liability')).toBe(true);
    expect(list.some((a) => a.id === 'coa-4.1.01')).toBe(true);
    expect(list.some((a) => a.id === 'coa-1.1.03')).toBe(false);
    expect(list.some((a) => a.id === 'coa-3.1.01')).toBe(false);
  });

  it('limits expense counterparts to expense/liability', () => {
    const list = counterpartAccountsForMovement(DEFAULT_CHART_OF_ACCOUNTS, 'expense');
    expect(list.every((a) => a.accountType === 'expense' || a.accountType === 'liability')).toBe(true);
    expect(list.some((a) => a.id === 'coa-5.1.04')).toBe(true);
    expect(list.some((a) => a.id === 'coa-1.2.01')).toBe(false);
  });

  it('limits transfers to other liquid accounts', () => {
    const list = counterpartAccountsForMovement(DEFAULT_CHART_OF_ACCOUNTS, 'transfer', 'coa-1.1.01');
    expect(list.every((a) => a.isCashAccount)).toBe(true);
    expect(list.some((a) => a.id === 'coa-1.1.01')).toBe(false);
    expect(list.some((a) => a.id === 'coa-1.1.03')).toBe(true);
  });
});

describe('buildCashTransferEntry', () => {
  it('builds a balanced transfer entry', () => {
    const entry = buildCashTransferEntry({
      fromAccountId: 'coa-1.1.01',
      toAccountId: 'coa-1.1.03',
      amount: 1000,
      concept: 'Depósito banco',
      chart: DEFAULT_CHART_OF_ACCOUNTS,
    });
    const debit = entry.lines.reduce((s, l) => s + Number(l.debit), 0);
    const credit = entry.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(debit).toBe(credit);
    expect(entry.sourceModule).toBe('caja_traspaso');
  });
});

describe('closedSessions', () => {
  it('returns only closed/discrepancy sorted by closedAt desc', () => {
    const list = closedSessions([
      { id: '1', status: 'open', closedAt: null },
      { id: '2', status: 'closed', closedAt: '2026-07-01T10:00:00.000Z' },
      { id: '3', status: 'discrepancy', closedAt: '2026-07-02T10:00:00.000Z' },
    ]);
    expect(list.map((s) => s.id)).toEqual(['3', '2']);
  });
});
