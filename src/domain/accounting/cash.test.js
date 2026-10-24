import { describe, expect, it } from 'vitest';
import { DEFAULT_CHART_OF_ACCOUNTS } from './chartOfAccounts';
import {
  buildCashMovementEntry,
  buildCashTransferEntry,
  closeCashSession,
  counterpartAccountsForMovement,
  closedSessions,
  CASH_ALWAYS_OPEN_MESSAGE,
  ensureOpenCashSession,
  getOpenSession,
  pickGeneralCashRegister,
  refuseCashSessionClose,
  sessionExpectedBalance,
  sessionStatusLabel,
  DEFAULT_CASH_REGISTERS,
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

describe('sessionStatusLabel', () => {
  it('traduce el estado de la sesión', () => {
    expect(sessionStatusLabel('open')).toBe('Abierta');
    expect(sessionStatusLabel('closed')).toBe('Cerrada');
    expect(sessionStatusLabel('discrepancy')).toBe('Con diferencia');
  });
});

describe('pickGeneralCashRegister', () => {
  it('elige la caja imputada a Caja General', () => {
    const picked = pickGeneralCashRegister(DEFAULT_CASH_REGISTERS, DEFAULT_CHART_OF_ACCOUNTS);
    expect(picked?.id).toBe('cash-gen');
  });
});

describe('ensureOpenCashSession', () => {
  it('reusa la sesión abierta y crea una si no hay', () => {
    const open = {
      id: 'cs-1',
      cashRegisterId: 'cash-gen',
      status: 'open',
      openingBalance: 100,
    };
    const reuse = ensureOpenCashSession([open], 'cash-gen');
    expect(reuse.created).toBe(false);
    expect(reuse.session).toBe(open);

    const created = ensureOpenCashSession([], 'cash-gen', { openingBalance: 0 });
    expect(created.created).toBe(true);
    expect(created.session.status).toBe('open');
    expect(created.session.cashRegisterId).toBe('cash-gen');
    expect(created.session.notes).toMatch(/siempre abierta/i);
    expect(getOpenSession([created.session], 'cash-gen')).toBe(created.session);
  });

  it('exige caja indicada', () => {
    expect(() => ensureOpenCashSession([], '')).toThrow(/caja no indicada/i);
    expect(() => ensureOpenCashSession([], null)).toThrow(/caja no indicada/i);
  });

  it('el cierre operativo de caja está bloqueado', () => {
    expect(() => refuseCashSessionClose()).toThrow(CASH_ALWAYS_OPEN_MESSAGE);
  });
});

describe('sessionExpectedBalance y cierre', () => {
  const session = { id: 'cs-1', openingBalance: 1000, status: 'open' };

  it('suma ingresos y resta egresos y traspasos', () => {
    const balance = sessionExpectedBalance(session, [
      { cashSessionId: 'cs-1', movementType: 'income', amount: 500 },
      { cashSessionId: 'cs-1', movementType: 'expense', amount: 200 },
      { cashSessionId: 'cs-1', movementType: 'transfer_out', amount: 100 },
      { cashSessionId: 'cs-1', movementType: 'transfer_in', amount: 50 },
      { cashSessionId: 'cs-1', movementType: 'adjustment', amount: -25 },
      { cashSessionId: 'other', movementType: 'income', amount: 999 },
    ]);
    expect(balance).toBe(1225);
  });

  it('marca discrepancia si el conteo no cierra', () => {
    const closed = closeCashSession(session, {
      countedBalance: 1100,
      movements: [
        { cashSessionId: 'cs-1', movementType: 'income', amount: 200 },
      ],
    });
    expect(closed.expectedBalance).toBe(1200);
    expect(closed.difference).toBe(-100);
    expect(closed.status).toBe('discrepancy');
  });

  it('cierra limpio cuando el conteo coincide', () => {
    const closed = closeCashSession(session, {
      countedBalance: 1000,
      movements: [],
    });
    expect(closed.status).toBe('closed');
    expect(closed.difference).toBe(0);
  });
});

describe('buildCashMovementEntry', () => {
  it('asienta ingreso debitando caja', () => {
    const entry = buildCashMovementEntry({
      date: '2026-10-20',
      concept: 'Cobro varios',
      cashAccountId: 'coa-1.1.01',
      relatedAccountId: 'coa-4.1.01',
      amount: 1500,
      movementType: 'income',
      chart: DEFAULT_CHART_OF_ACCOUNTS,
    });
    expect(entry.sourceModule).toBe('caja');
    const cash = entry.lines.find((l) => l.accountId === 'coa-1.1.01');
    expect(cash.debit).toBe(1500);
    expect(cash.credit).toBe(0);
  });
});
