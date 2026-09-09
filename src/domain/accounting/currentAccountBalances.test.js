import { describe, expect, it } from 'vitest';
import {
  ACCESSIN_CURRENT_ACCOUNT_BALANCES_AS_OF,
  ACCESSIN_CURRENT_ACCOUNT_BALANCES_SNAPSHOT,
  applyCurrentAccountBalances,
  currentAccountBalanceOf,
  lookupCurrentAccountBalance,
} from './currentAccountBalances';

describe('currentAccountBalances', () => {
  it('carga snapshot LILA al 2026-09-03', () => {
    expect(ACCESSIN_CURRENT_ACCOUNT_BALANCES_AS_OF).toBe('2026-09-03');
    expect(ACCESSIN_CURRENT_ACCOUNT_BALANCES_SNAPSHOT.rowCount).toBeGreaterThan(7000);
    expect(ACCESSIN_CURRENT_ACCOUNT_BALANCES_SNAPSHOT.withBalance).toBeGreaterThan(1000);
  });

  it('lookup por número de socio con saldo real', () => {
    const hit = lookupCurrentAccountBalance('1004');
    expect(hit).toBeTruthy();
    expect(hit.balance).toBe(56000);
    expect(hit.unpaidCapital).toBe(54000);
    expect(hit.unpaidSurcharges).toBe(2000);
  });

  it('aplica saldos al padrón y pisa deuda automática', () => {
    const members = [
      { memberId: '1004', name: 'Cristina Mugas', outstandingBalance: 999999 },
      { memberId: '1', name: 'Jonas', outstandingBalance: 5000 },
      { memberId: '99999999', name: 'Sin seed', outstandingBalance: 123 },
    ];
    const next = applyCurrentAccountBalances(members);
    expect(next[0].outstandingBalance).toBe(56000);
    expect(next[0].currentAccountAsOf).toBe('2026-09-03');
    expect(next[1].outstandingBalance).toBe(0);
    expect(next[2].outstandingBalance).toBe(123);
    expect(currentAccountBalanceOf(next[0])).toBe(56000);
  });

  it('no pisa un cobro posterior al corte LILA', () => {
    const first = applyCurrentAccountBalances([
      { memberId: '1004', name: 'Cristina Mugas', outstandingBalance: 999999 },
    ]);
    const paid = { ...first[0], outstandingBalance: 10000, lastPaymentDate: '2026-09-04' };
    const again = applyCurrentAccountBalances([paid]);
    expect(again[0].outstandingBalance).toBe(10000);
    expect(currentAccountBalanceOf(again[0])).toBe(10000);
  });
});
