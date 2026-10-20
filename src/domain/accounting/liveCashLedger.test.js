import { describe, expect, it } from 'vitest';
import { DEFAULT_CHART_OF_ACCOUNTS } from './chartOfAccounts';
import { buildLiveCashLedger } from './liveCashLedger';
import { impliedCashOnHand as cutoffOnHand } from './cashLedger';

const TODAY = new Date('2026-10-19T15:00:00-03:00');

const SNAPSHOT = {
  asOf: '2026-10-13',
  periodFrom: '2026-08-05',
  periodTo: '2026-10-13',
  cards: {
    efectivo: { periodInflow: 14093240, balance: null },
    bancos: { periodInflow: 100 },
    cheques: { balance: 0 },
    total: { balance: 1000 },
  },
};

const BANKS = [{ id: 'bsj', balance: 400, isActive: true }];

function cobro({ id, date, amount, account = 'Caja General' }) {
  return {
    id,
    date,
    status: 'posted',
    sourceModule: 'cuotas',
    origin: 'app',
    description: `Cobro cuota social (Efectivo) - Socio: Ana (Cred. 4240)`,
    lines: [
      { account, type: 'debit', amount },
      { account: 'Cuotas Sociales', type: 'credit', amount },
    ],
  };
}

describe('liveCashLedger', () => {
  it('al corte el efectivo es total menos bancos y cheques', () => {
    const onHand = cutoffOnHand(SNAPSHOT, { bankAccounts: BANKS, cheques: [] });
    expect(onHand.efectivo).toBeCloseTo(600, 2);
    expect(onHand.bancos).toBeCloseTo(400, 2);
    expect(onHand.total).toBeCloseTo(1000, 2);
  });

  it('suma cobros posteriores al corte y las tarjetas cierran', () => {
    const live = buildLiveCashLedger({
      snapshot: SNAPSHOT,
      movements: [],
      bankAccounts: BANKS,
      cheques: [],
      chartOfAccounts: DEFAULT_CHART_OF_ACCOUNTS,
      journalEntries: [
        cobro({ id: 'je-live-1', date: '2026-10-15', amount: 50 }),
        cobro({ id: 'je-live-2', date: '2026-10-16', amount: 80, account: 'Banco Nación' }),
        cobro({ id: 'je-old', date: '2026-10-13', amount: 999 }),
      ],
      today: TODAY,
    });
    expect(live.asOf).toBe('2026-10-19');
    expect(live.cutoff).toBe('2026-10-13');
    expect(live.efectivo).toBeCloseTo(650, 2);
    expect(live.bancos).toBeCloseTo(480, 2);
    expect(live.total).toBeCloseTo(1130, 2);
    expect(live.extraCount).toBe(2);
    expect(live.cards.find((c) => c.id === 'efectivo')?.caption).toContain('19 de Octubre del 2026');
    expect(live.cards.find((c) => c.id === 'efectivo')?.caption).not.toMatch(/no es el saldo/i);
    const sum = live.efectivo + live.bancos + live.cheques;
    expect(Math.round(sum * 100) / 100).toBeCloseTo(live.total, 2);
    expect(live.cobranzas).toHaveLength(2);
    expect(live.extraCobranzasCount).toBe(2);
  });

  it('suma otros ingresos posteriores al corte en cobranzas', () => {
    const live = buildLiveCashLedger({
      snapshot: SNAPSHOT,
      bankAccounts: BANKS,
      otherIncomes: [{
        id: 'oi-1',
        date: '2026-10-17',
        amount: 25,
        group: 'eventos',
        concept: 'Salón',
        paymentMethod: 'transferencia',
        paymentMethodLabel: 'Transferencia',
        payerName: 'Fiesta',
        status: 'posted',
      }],
      today: TODAY,
    });
    expect(live.extraCobranzasCount).toBe(1);
    expect(live.cobranzas[0]).toMatchObject({ type: 'Eventos', amount: 25 });
  });

  it('no duplica un movimiento de caja que ya tiene asiento', () => {
    const live = buildLiveCashLedger({
      snapshot: SNAPSHOT,
      movements: [],
      liveMovements: [{
        id: 'cm-1',
        createdAt: '2026-10-18T12:00:00.000Z',
        amount: 20,
        movementType: 'income',
        concept: 'Arqueo',
        journalEntryId: 'je-caja-1',
      }],
      journalEntries: [{
        id: 'je-caja-1',
        date: '2026-10-18',
        status: 'posted',
        sourceModule: 'caja',
        origin: 'app',
        description: 'Arqueo',
        lines: [
          { account: 'Caja General', type: 'debit', amount: 20 },
          { account: 'Cuotas Sociales', type: 'credit', amount: 20 },
        ],
      }],
      bankAccounts: BANKS,
      today: TODAY,
    });
    expect(live.extraCount).toBe(1);
    expect(live.efectivo).toBeCloseTo(620, 2);
  });

  it('omite asientos agrupados del libro importado', () => {
    const live = buildLiveCashLedger({
      snapshot: SNAPSHOT,
      bankAccounts: BANKS,
      journalEntries: [{
        id: 'je-lila-2026-10-15-cash-in',
        date: '2026-10-15',
        status: 'posted',
        sourceModule: 'caja',
        origin: 'lila',
        lines: [
          { account: 'Caja General', type: 'debit', amount: 500 },
          { account: 'Cuentas a Cobrar', type: 'credit', amount: 500 },
        ],
      }],
      today: TODAY,
    });
    expect(live.extraCount).toBe(0);
    expect(live.efectivo).toBeCloseTo(600, 2);
  });
});
