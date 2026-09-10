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

  it('completa saldo LILA solo si el padrón no tiene saldo operativo', () => {
    const seeded = applyCurrentAccountBalances([
      { memberId: '1004', name: 'Cristina Mugas' },
      { memberId: '99999999', name: 'Sin seed' },
    ]);
    expect(seeded[0].outstandingBalance).toBe(56000);
    expect(seeded[0].currentAccountAsOf).toBe('2026-09-03');
    expect(seeded[1].outstandingBalance).toBeUndefined();

    const kept = applyCurrentAccountBalances([
      { memberId: '1004', name: 'Cristina Mugas', outstandingBalance: 999999 },
    ]);
    expect(kept[0].outstandingBalance).toBe(999999);
    expect(currentAccountBalanceOf(kept[0])).toBe(999999);
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
