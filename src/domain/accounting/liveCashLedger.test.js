import { describe, expect, it } from 'vitest';
import { DEFAULT_CHART_OF_ACCOUNTS } from './chartOfAccounts';
import {
  assignCashMovementNumbers,
  buildLiveCashLedger,
  maxCashMovementNumber,
} from './liveCashLedger';
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
        cobro({ id: 'je-old', date: '2026-10-12', amount: 999 }),
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

  it('incluye cobros de la app del mismo día del corte Accessin', () => {
    const live = buildLiveCashLedger({
      snapshot: SNAPSHOT,
      movements: [],
      bankAccounts: BANKS,
      cheques: [],
      chartOfAccounts: DEFAULT_CHART_OF_ACCOUNTS,
      journalEntries: [
        cobro({ id: 'je-same-day', date: '2026-10-13', amount: 44 }),
      ],
      today: TODAY,
    });
    expect(live.extraCount).toBe(1);
    expect(live.efectivo).toBeCloseTo(644, 2);
    expect(live.ledger.some((row) => row.journalEntryId === 'je-same-day' && row.amount === 44)).toBe(true);
  });

  it('lista débitos importados en el libro sin inflar el saldo del corte', () => {
    const live = buildLiveCashLedger({
      snapshot: SNAPSHOT,
      movements: [],
      bankAccounts: BANKS,
      cheques: [],
      chartOfAccounts: DEFAULT_CHART_OF_ACCOUNTS,
      members: [{
        memberId: '111591',
        name: 'Chávez',
        paymentHistory: [{
          id: 'pay-imp-1',
          date: '2026-10-01',
          amount: 70000,
          method: 'transferencia',
          bankName: 'Banco Macro',
          concept: 'Octubre del 2026 - SOCIO FAMILIAR',
          importSource: 'lila-sheet-oct2026',
          receipt: '03656025',
        }],
      }],
      today: TODAY,
    });
    expect(live.importCount).toBe(1);
    expect(live.bancos).toBeCloseTo(400, 2);
    expect(live.ledger.some((row) => row.origin === 'import' && row.amount === 70000)).toBe(true);
  });

  it('no repite un débito importado si Accessin ya tiene la misma huella', () => {
    const live = buildLiveCashLedger({
      snapshot: SNAPSHOT,
      movements: [{
        id: 'acc-dup',
        accessinId: 9001,
        date: '2026-10-01',
        amount: 70000,
        movementType: 'income',
        walletKind: 'bank',
        memberNumber: '111591',
        description: 'Débito Macro',
      }],
      bankAccounts: BANKS,
      members: [{
        memberId: '111591',
        name: 'Chávez',
        paymentHistory: [{
          id: 'pay-imp-dup',
          date: '2026-10-01',
          amount: 70000,
          method: 'transferencia',
          importSource: 'lila-sheet-oct2026',
        }],
      }],
      today: TODAY,
    });
    expect(live.importCount).toBe(0);
    expect(live.ledger.filter((row) => row.amount === 70000 && row.memberNumber === '111591')).toHaveLength(1);
  });

  it('separa Mercado Pago y muestra el ingreso del día', () => {
    const live = buildLiveCashLedger({
      snapshot: {
        ...SNAPSHOT,
        periodInflows: {
          'Mercado Pago (ARS)': 125000,
          'Banco Macro (ARS)': 275000,
        },
        cards: {
          ...SNAPSHOT.cards,
          bancos: { periodInflow: 400000 },
          total: { balance: 500000 },
        },
      },
      movements: [{
        id: 'mp-day',
        accessinId: 1,
        date: '2026-10-19',
        amount: 2500,
        movementType: 'income',
        walletKind: 'bank',
        walletName: 'Mercado Pago (ARS)',
      }],
      liveMovements: [{
        id: 'cm-cash-day',
        date: '2026-10-19',
        amount: 4400,
        movementType: 'income',
        concept: 'Cobro cuota social (Efectivo)',
      }],
      bankAccounts: BANKS,
      today: TODAY,
    });
    expect(live.mercadopago).toBeCloseTo(127500, 2);
    expect(live.dayInflow.efectivo).toBeCloseTo(4400, 2);
    expect(live.dayInflow.mercadopago).toBeCloseTo(2500, 2);
    expect(live.dayInflow.total).toBeCloseTo(6900, 2);
    expect(live.cards.find((c) => c.id === 'mercadopago')?.value).toBeCloseTo(127500, 2);
    expect(live.cards.find((c) => c.id === 'efectivo')?.monthInflow).toBeCloseTo(4400, 2);
    expect(live.cards.find((c) => c.id === 'mercadopago')?.monthInflow).toBeCloseTo(2500, 2);
    expect(live.monthInflow.total).toBeCloseTo(6900, 2);
    expect(live.cards.find((c) => c.id === 'efectivo')?.caption).toMatch(/Hoy \+/);
    expect(live.calendar.days.find((d) => d.date === '2026-10-19')?.inflow).toBeCloseTo(6900, 2);
  });

  it('numera movimientos vivos a continuación del último # Accessin', () => {
    expect(maxCashMovementNumber([
      { accessinId: 603050 },
      { accessinId: 603040 },
      { accessinId: null },
    ])).toBe(603050);

    const numbered = assignCashMovementNumbers([
      { id: 'acc-1', accessinId: 603050, date: '2026-11-04', amount: 10 },
      { id: 'live-b', accessinId: null, date: '2026-11-05', amount: 4400, origin: 'app' },
      { id: 'live-a', accessinId: null, date: '2026-11-01', amount: 70000, origin: 'import' },
    ]);
    expect(numbered.find((r) => r.id === 'live-a')?.accessinId).toBe(603051);
    expect(numbered.find((r) => r.id === 'live-b')?.accessinId).toBe(603052);
    expect(numbered.find((r) => r.id === 'acc-1')?.accessinId).toBe(603050);
  });

  it('en el libro vivo el cobro nuevo recibe # correlativo', () => {
    const live = buildLiveCashLedger({
      snapshot: SNAPSHOT,
      movements: [{
        id: 'acc-1',
        accessinId: 9000,
        date: '2026-10-12',
        amount: 100,
        movementType: 'income',
        walletKind: 'cash',
      }],
      bankAccounts: BANKS,
      journalEntries: [
        cobro({ id: 'je-num', date: '2026-10-15', amount: 50 }),
      ],
      today: TODAY,
    });
    const row = live.ledger.find((r) => r.journalEntryId === 'je-num');
    expect(row?.accessinId).toBe(9001);
  });

  it('omite el asiento global de importación de cobranzas', () => {
    const live = buildLiveCashLedger({
      snapshot: SNAPSHOT,
      bankAccounts: BANKS,
      journalEntries: [{
        id: 'je-import-batch',
        date: '2026-10-15',
        status: 'posted',
        sourceModule: 'cuotas',
        description: 'Importación cobranzas socios (debitos-nov.xlsx)',
        lines: [
          { account: 'Caja General', type: 'debit', amount: 1000000 },
          { account: 'Cuotas Sociales', type: 'credit', amount: 1000000 },
        ],
      }],
      today: TODAY,
    });
    expect(live.extraCount).toBe(0);
    expect(live.efectivo).toBeCloseTo(600, 2);
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

  it('el asiento de otro ingreso mueve bancos en el saldo vivo', () => {
    const live = buildLiveCashLedger({
      snapshot: SNAPSHOT,
      bankAccounts: BANKS,
      journalEntries: [{
        id: 'je-oi-1',
        date: '2026-10-17',
        status: 'posted',
        sourceModule: 'otros_ingresos',
        origin: 'app',
        description: 'Otro ingreso: Salón',
        lines: [
          { accountId: 'coa-1.1.03', debit: 25, credit: 0 },
          { accountId: 'coa-4.1.03', debit: 0, credit: 25 },
        ],
      }],
      today: TODAY,
    });
    expect(live.bancos).toBeCloseTo(425, 2);
    expect(live.extraCount).toBe(1);
  });

  it('el pago de impuestos baja caja viva', () => {
    const live = buildLiveCashLedger({
      snapshot: SNAPSHOT,
      bankAccounts: BANKS,
      journalEntries: [{
        id: 'je-tax-1',
        date: '2026-10-18',
        status: 'posted',
        sourceModule: 'impuestos',
        origin: 'app',
        description: 'Pago IVA 2026-10',
        lines: [
          { accountId: 'coa-2.1.05', debit: 40, credit: 0 },
          { accountId: 'coa-1.1.01', debit: 0, credit: 40 },
        ],
      }],
      today: TODAY,
    });
    expect(live.efectivo).toBeCloseTo(560, 2);
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

  it('omite asientos agrupados del libro importado y conserva el corte', () => {
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
    expect(live.bancos).toBeCloseTo(400, 2);
    expect(live.total).toBeCloseTo(1000, 2);
  });

  it('suma movimientos Accessin posteriores al corte sobre el saldo del corte', () => {
    const live = buildLiveCashLedger({
      snapshot: SNAPSHOT,
      bankAccounts: BANKS,
      movements: [
        {
          id: 'acc-1',
          date: '2026-10-15',
          amount: 30,
          movementType: 'income',
          walletKind: 'cash',
        },
        {
          id: 'acc-2',
          date: '2026-10-12',
          amount: 999,
          movementType: 'income',
          walletKind: 'cash',
        },
      ],
      today: TODAY,
    });
    expect(live.efectivo).toBeCloseTo(630, 2);
    expect(live.total).toBeCloseTo(1030, 2);
  });
});
