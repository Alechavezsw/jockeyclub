import { describe, expect, it } from 'vitest';
import {
  ACCESSIN_CASH_MOVEMENTS,
  ACCESSIN_CASH_SNAPSHOT,
  ACCESSIN_CHEQUES,
  ACCESSIN_CHEQUES_SNAPSHOT,
  accessinCashBalanceCards,
  accessinChequesTotal,
  filterAccessinCashMovements,
  filterAccessinCheques,
  recalculateAccessinCashTotal,
} from './cashLedger';

describe('cashLedger Accessin', () => {
  it('carga el seed de movimientos reales', () => {
    expect(ACCESSIN_CASH_MOVEMENTS.length).toBe(1724);
    expect(ACCESSIN_CASH_SNAPSHOT.openingBalance).toBeCloseTo(653719562.28, 2);
    expect(ACCESSIN_CASH_SNAPSHOT.closingBalance).toBeCloseTo(770702468.86, 2);
  });

  it('recalcula el total = apertura + movimientos del Excel', () => {
    const total = recalculateAccessinCashTotal();
    expect(total).toBeCloseTo(ACCESSIN_CASH_SNAPSHOT.closingBalance, 2);
  });

  it('tarjetas usan solo datos reales del Excel / cheques', () => {
    const cards = accessinCashBalanceCards();
    expect(cards.find((c) => c.id === 'efectivo')?.value).toBeCloseTo(9121500, 2);
    expect(cards.find((c) => c.id === 'bancos')?.value).toBeCloseTo(107861406.58, 2);
    expect(cards.find((c) => c.id === 'cheques')?.value).toBe(0);
    expect(cards.find((c) => c.id === 'total')?.value).toBeCloseTo(770702468.86, 2);
    // No usar saldos inventados de capturas de pantalla.
    expect(cards.find((c) => c.id === 'efectivo')?.value).not.toBeCloseTo(179794062.75, 0);
  });

  it('tarjetas de bancos usan saldos reales de cuentas cuando hay listado', async () => {
    const { ACCESSIN_BANK_ACCOUNTS } = await import('../../data/seed/accessinBankAccounts.js');
    const cards = accessinCashBalanceCards(
      ACCESSIN_CASH_SNAPSHOT,
      ACCESSIN_CASH_MOVEMENTS,
      ACCESSIN_CHEQUES,
      ACCESSIN_BANK_ACCOUNTS
    );
    expect(cards.find((c) => c.id === 'bancos')?.value).toBeCloseTo(590868406.11, 2);
    expect(cards.find((c) => c.id === 'bancos')?.filter?.view).toBe('bank_accounts');
  });

  it('usa cheques reales Accessin', () => {
    expect(ACCESSIN_CHEQUES_SNAPSHOT.total).toBe(0);
    expect(accessinChequesTotal(ACCESSIN_CHEQUES)).toBe(0);
    expect(filterAccessinCheques(ACCESSIN_CHEQUES)).toHaveLength(0);
  });

  it('filtra por wallet y limita', () => {
    const cash = filterAccessinCashMovements(ACCESSIN_CASH_MOVEMENTS, { walletKind: 'cash' });
    expect(cash.every((m) => m.walletKind === 'cash')).toBe(true);
    const limited = filterAccessinCashMovements(ACCESSIN_CASH_MOVEMENTS, { limit: 10 });
    expect(limited).toHaveLength(10);
  });
});
