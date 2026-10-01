import { beforeAll, describe, expect, it } from 'vitest';
import { loadSnapshots } from '../../data/snapshots';
import { bankAccountsSeed } from './bankAccounts';
import {
  accessinCashBalanceCards,
  accessinChequesTotal,
  cashMovementsSeed,
  cashSeed,
  chequesSeed,
  cashMovementMonthSheets,
  filterAccessinCashMovements,
  filterAccessinCheques,
  recalculateAccessinCashTotal,
} from './cashLedger';

let ACCESSIN_CASH_MOVEMENTS;
let ACCESSIN_CASH_SNAPSHOT;
let ACCESSIN_CHEQUES;
let ACCESSIN_CHEQUES_SNAPSHOT;

beforeAll(async () => {
  await loadSnapshots([
    'accessinBankAccounts',
    'accessinCashMovements',
    'accessinCashSnapshot',
    'accessinCheques',
  ]);
  ({ ACCESSIN_CASH_MOVEMENTS } = cashMovementsSeed());
  ({ ACCESSIN_CASH_SNAPSHOT } = cashSeed());
  ({ ACCESSIN_CHEQUES, ACCESSIN_CHEQUES_SNAPSHOT } = chequesSeed());
});

describe('cashLedger Accessin', () => {
  it('carga el seed de movimientos reales', () => {
    expect(ACCESSIN_CASH_MOVEMENTS.length).toBe(1854);
    expect(ACCESSIN_CASH_SNAPSHOT.asOf).toBe('2026-09-26');
    expect(ACCESSIN_CASH_SNAPSHOT.openingBalance).toBeCloseTo(675873959.84, 2);
    expect(ACCESSIN_CASH_SNAPSHOT.closingBalance).toBeCloseTo(805164142.62, 2);
  });

  it('recalcula el total = apertura + movimientos del Excel', () => {
    const total = recalculateAccessinCashTotal(ACCESSIN_CASH_SNAPSHOT, ACCESSIN_CASH_MOVEMENTS);
    expect(total).toBeCloseTo(ACCESSIN_CASH_SNAPSHOT.closingBalance, 2);
  });

  it('tarjetas usan solo datos reales del Excel / cheques', () => {
    const cards = accessinCashBalanceCards(ACCESSIN_CASH_SNAPSHOT, ACCESSIN_CASH_MOVEMENTS);
    expect(cards.find((c) => c.id === 'efectivo')?.value).toBeCloseTo(13127240, 2);
    expect(cards.find((c) => c.id === 'bancos')?.value).toBeCloseTo(116162942.78, 2);
    expect(cards.find((c) => c.id === 'cheques')?.value).toBe(0);
    expect(cards.find((c) => c.id === 'total')?.value).toBeCloseTo(805164142.62, 2);
    // No usar saldos inventados de capturas de pantalla.
    expect(cards.find((c) => c.id === 'efectivo')?.value).not.toBeCloseTo(179794062.75, 0);
  });

  it('tarjetas de bancos usan saldos reales de cuentas cuando hay listado', () => {
    const { ACCESSIN_BANK_ACCOUNTS } = bankAccountsSeed();
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

  it('arma una hoja por mes y no mezcla días de otro mes', () => {
    const rows = [
      { id: 'a', date: '2026-10-01', accessinId: 603050, amount: 39600 },
      { id: 'b', date: '2026-09-30', accessinId: 603000, amount: 1000 },
      { id: 'c', date: '2026-10-01', accessinId: 603051, amount: 500 },
    ];
    const sheets = cashMovementMonthSheets(rows);
    expect(sheets.map((s) => s.key)).toEqual(['2026-10', '2026-09']);
    expect(sheets[0]).toMatchObject({ label: 'Octubre de 2026', count: 2 });
    const october = filterAccessinCashMovements(rows, { monthKey: '2026-10' });
    expect(october.map((r) => r.accessinId)).toEqual([603051, 603050]);
    expect(october.some((r) => String(r.date).startsWith('2026-09'))).toBe(false);
  });
});

describe('saldo de caja al día', () => {
  it('muestra el saldo de efectivo y bancos del corte, no los ingresos del período', () => {
    const cards = accessinCashBalanceCards({
      asOf: '2026-10-01',
      cards: {
        efectivo: { periodInflow: 13127240, balance: 187369302.75 },
        bancos: { periodInflow: 116162942.78, balance: 624226837.87 },
        cheques: { balance: 0 },
        total: { balance: 811596140.62 },
      },
    }, []);
    expect(cards.find((c) => c.id === 'efectivo')?.value).toBeCloseTo(187369302.75, 2);
    expect(cards.find((c) => c.id === 'efectivo')?.caption).toContain('1 de Octubre del 2026');
    expect(cards.find((c) => c.id === 'bancos')?.value).toBeCloseTo(624226837.87, 2);
    expect(cards.find((c) => c.id === 'total')?.value).toBeCloseTo(811596140.62, 2);
  });
});
