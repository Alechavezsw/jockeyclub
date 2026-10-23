import { describe, expect, it } from 'vitest';
import { DEFAULT_CHART_OF_ACCOUNTS } from './chartOfAccounts';
import { buildMonthCloseReport } from './monthClose';

const JOURNAL = [
  {
    id: 'liq-sep',
    date: '2026-09-09',
    status: 'posted',
    description: 'Liquidación de cuotas',
    lines: [
      { account: 'Cuentas a Cobrar', type: 'debit', amount: 1000 },
      { account: 'Cuotas Sociales', type: 'credit', amount: 1000 },
    ],
  },
  {
    id: 'caja',
    date: '2026-10-13',
    status: 'posted',
    description: 'Caja',
    lines: [
      { account: 'Caja General', type: 'debit', amount: 400 },
      { account: 'Cuentas a Cobrar', type: 'credit', amount: 400 },
    ],
  },
  {
    id: 'cobro',
    date: '2026-10-17',
    status: 'posted',
    description: 'Cobro cuota social',
    lines: [
      { account: 'Caja General', type: 'debit', amount: 200 },
      { account: 'Cuotas Sociales', type: 'credit', amount: 200 },
    ],
  },
  {
    id: 'gasto',
    date: '2026-10-17',
    status: 'posted',
    description: 'Servicios del mes',
    lines: [
      { account: 'Servicios e Insumos', type: 'debit', amount: 50 },
      { account: 'Caja General', type: 'credit', amount: 50 },
    ],
  },
];

const OCTOBER = {
  id: 'fp-2026-10',
  year: 2026,
  month: 10,
  status: 'processed',
  amount: 1000,
  pack: {
    total: 1000,
    concepts: [
      { label: 'SOCIO FAMILIAR', holders: 1, amount: 1000, total: 1000 },
      { label: 'VITALICIO', holders: 2, amount: 0, total: 0 },
    ],
  },
};

describe('informe de cierre', () => {
  it('cierra octubre el 1 de noviembre, con resultado, caja y paquete', () => {
    const report = buildMonthCloseReport({
      journalEntries: JOURNAL,
      chart: DEFAULT_CHART_OF_ACCOUNTS,
      members: [],
      movements: [],
      feePeriods: [OCTOBER],
      today: '2026-11-02',
    });

    expect(report.monthKey).toBe('2026-10');
    expect(report.closed).toBe(true);
    expect(report.readyToSign).toBe(true);
    expect(report.statusLabel).toBe('Para firmar');
    expect(report.incomeTotal).toBe(200);
    expect(report.expenseTotal).toBe(50);
    expect(report.result).toBe(150);
    expect(report.cashIn).toBe(600);
    expect(report.cashOut).toBe(50);
    expect(report.cashLines.find((line) => line.label === 'Caja General').amount).toBe(550);
    expect(report.bankAmount).toBe(0);
    expect(report.incomeLines.map((line) => line.label)).toEqual(['Cuotas Sociales']);
    expect(report.expenseLines.map((line) => line.label)).toEqual(['Servicios e Insumos']);
    expect(report.liquidation.packTotal).toBe(1000);
    expect(report.liquidation.concepts).toHaveLength(1);
    expect(report.liquidation.zeroCategories).toBe(1);
    expect(report.collected.recaudado).toBe(0);
    expect(report.steps.map((step) => step.id)).toEqual([
      'cutoff', 'impute', 'cash', 'accounts', 'summary', 'carry',
    ]);
    expect(report.cutoff).toBe('2026-10-31');
    expect(report.steps.find((step) => step.id === 'cash').tone).toBe('watch');
    expect(report.steps.find((step) => step.id === 'impute').tone).toBe('ok');
  });

  it('en octubre toma septiembre, que ya está cerrado', () => {
    const report = buildMonthCloseReport({
      journalEntries: JOURNAL,
      chart: DEFAULT_CHART_OF_ACCOUNTS,
      feePeriods: [],
      today: '2026-10-22',
    });
    expect(report.monthKey).toBe('2026-09');
    expect(report.closed).toBe(true);
    expect(report.readyToSign).toBe(false);
    expect(report.liquidation.status).toBe('missing');
    expect(report.statusLabel).toBe('Incompleto');
  });

  it('una cobranza sin imputar deja el cierre incompleto', () => {
    const report = buildMonthCloseReport({
      journalEntries: JOURNAL,
      chart: DEFAULT_CHART_OF_ACCOUNTS,
      monthKey: '2026-10',
      feePeriods: [OCTOBER],
      pendingCollections: [{ id: 'u1', status: 'pending', amount: 5000, date: '2026-10-20' }],
      today: '2026-11-02',
    });
    expect(report.steps.find((step) => step.id === 'impute').tone).toBe('pending');
    expect(report.readyToSign).toBe(false);
  });

  it('un borrador deja el mes incompleto', () => {
    const report = buildMonthCloseReport({
      journalEntries: JOURNAL,
      chart: DEFAULT_CHART_OF_ACCOUNTS,
      monthKey: '2026-10',
      feePeriods: [{ ...OCTOBER, status: 'draft', pack: null, amount: 0 }],
      today: '2026-11-02',
    });
    expect(report.closed).toBe(true);
    expect(report.liquidation.statusLabel).toBe('Borrador');
    expect(report.readyToSign).toBe(false);
  });
});
