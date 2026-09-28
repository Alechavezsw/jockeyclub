import { describe, expect, it } from 'vitest';
import {
  buildOpsFinanceSnapshot,
  composeClubFinance,
  lilaContabilidadFromSnapshots,
  LILA_HANDOFF_ISO,
} from './opsFinanceSnapshot';
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

describe('lilaContabilidadFromSnapshots', () => {
  it('arma liquidado, recaudado y caja como el widget de LILA', () => {
    const kpis = lilaContabilidadFromSnapshots({
      monthlySnapshot: {
        periodFrom: '2026-09-01',
        periodTo: '2026-09-30',
        periodLabel: '2026-09',
        detailSheets: [
          { key: 'cuotas_imputadas_en_cuent', title: 'Cuotas imputadas en cuentas corrientes', total: 57843000 },
        ],
      },
      detailedSnapshot: { totalFeeEntries: 40500000, sumPaid: 40500000 },
      cashSnapshot: { closingBalance: 805164142.62 },
      cobranzas: [
        { id: 'a', date: '2026-09-25', memberNumber: '130433', memberName: 'Ana Pérez', amount: 143030, receiptId: '1' },
        { id: 'b', date: '2026-09-25', memberNumber: '118818', amount: 314000, receiptId: '2' },
        { id: 'c', date: '2026-09-24', memberNumber: '1', amount: 1000, receiptId: '3' },
      ],
    });

    expect(kpis.liquidado).toBe(57843000);
    expect(kpis.recaudado).toBe(40500000);
    expect(kpis.rate).toBe(70);
    expect(kpis.cash).toBeCloseTo(805164142.62, 2);
    expect(kpis.lastIncomes).toHaveLength(2);
    expect(kpis.lastIncomes.map((row) => row.label).sort()).toEqual(['Ana Pérez', 'Socio Nº 118818']);
  });

  it('devuelve null si el corte todavía no cargó', () => {
    expect(lilaContabilidadFromSnapshots()).toBeNull();
  });

  it('no trata cobranzas de otro día como ingresos de hoy', () => {
    const kpis = lilaContabilidadFromSnapshots({
      monthlySnapshot: {
        detailSheets: [{ key: 'cuotas_imputadas_en_cuent', total: 1000 }],
      },
      detailedSnapshot: { totalFeeEntries: 1000 },
      cashSnapshot: { closingBalance: 1 },
      cobranzas: [
        { id: 'a', date: '2026-09-25', memberNumber: '101513', amount: 60000 },
      ],
      day: '2026-09-27',
    });
    expect(kpis.lastIncomes).toEqual([]);
  });
});

describe('composeClubFinance', () => {
  const lila = {
    liquidado: 57843000,
    recaudado: 40500000,
    cash: 805164142.62,
    lastIncomes: [{ id: 'l1', date: '2026-09-25', label: 'Ana', amount: 1000 }],
    periodTo: '2026-09-30',
  };
  const lilaCards = { totalIncome: 58958673.76, totalExpenses: 0 };

  it('deja el corte LILA intacto si todavía no hay movimientos del club', () => {
    const club = composeClubFinance({
      lila,
      lilaCards,
      today: '2026-09-27',
      members: [{
        memberId: '1',
        name: 'Luis',
        paymentHistory: [{ date: '2026-09-12', amount: 32000, status: 'paid' }],
      }],
      journalEntries: [{
        id: 'old',
        date: '2026-05-03',
        status: 'posted',
        lines: [
          { account: 'Caja General', type: 'debit', amount: 45000 },
          { account: 'Cuotas Sociales', type: 'credit', amount: 45000 },
        ],
      }],
      chartOfAccounts: DEFAULT_CHART_OF_ACCOUNTS,
    });

    expect(club.source).toBe('lila');
    expect(club.recaudado).toBe(40500000);
    expect(club.liquidado).toBe(57843000);
    expect(club.cash).toBeCloseTo(805164142.62, 2);
    expect(club.result).toBeCloseTo(58958673.76, 2);
    expect(club.added.recaudado).toBe(0);
    expect(club.since).toBe(LILA_HANDOFF_ISO);
  });

  it('suma cobros, caja e ingresos cargados desde el 1 de octubre', () => {
    const club = composeClubFinance({
      lila,
      lilaCards,
      today: '2026-10-02',
      members: [{
        memberId: '1',
        name: 'Luis',
        paymentHistory: [
          { date: '2026-09-12', amount: 32000, status: 'paid' },
          { date: '2026-10-01', amount: 15000, status: 'paid' },
        ],
      }],
      journalEntries: [{
        id: 'oct',
        date: '2026-10-01',
        status: 'posted',
        lines: [
          { accountId: 'coa-1.1.01', debit: 15000, credit: 0 },
          { accountId: 'coa-4.1.01', debit: 0, credit: 15000 },
        ],
      }],
      feePeriods: [{ year: 2026, month: 10, status: 'processed', amount: 20000 }],
      chartOfAccounts: DEFAULT_CHART_OF_ACCOUNTS,
    });

    expect(club.source).toBe('lila+app');
    expect(club.recaudado).toBe(40515000);
    expect(club.liquidado).toBe(57863000);
    expect(club.cash).toBeCloseTo(805179142.62, 2);
    expect(club.added.recaudado).toBe(15000);
    expect(club.added.liquidado).toBe(20000);
    expect(club.added.cash).toBe(15000);
    expect(club.added.income).toBe(15000);
    expect(club.result).toBeCloseTo(58973673.76, 2);
  });
});
