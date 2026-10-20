import { describe, expect, it } from 'vitest';
import { DEFAULT_CHART_OF_ACCOUNTS } from './chartOfAccounts';
import {
  buildLiveBalanceSummary,
  buildLiveMonthlyBalances,
  liveMonthlyBalanceDetail,
} from './liveMonthlyBalance';

const SAMPLE = [
  {
    id: 'liq-sep',
    date: '2026-09-09',
    status: 'posted',
    description: 'Liquidación de cuotas · Octubre del 2026',
    lines: [
      { account: 'Cuentas a Cobrar', type: 'debit', amount: 1000 },
      { account: 'Cuotas Sociales', type: 'credit', amount: 1000 },
    ],
  },
  {
    id: 'caja-lila',
    date: '2026-10-13',
    status: 'posted',
    description: 'Caja · 1 ingreso',
    lines: [
      { account: 'Caja General', type: 'debit', amount: 400 },
      { account: 'Cuentas a Cobrar', type: 'credit', amount: 400 },
    ],
  },
  {
    id: 'cobro-vivo',
    date: '2026-10-17',
    status: 'posted',
    description: 'Cobro cuota social (Efectivo)',
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
  {
    id: 'draft',
    date: '2026-10-18',
    status: 'draft',
    description: 'Borrador',
    lines: [
      { account: 'Caja General', type: 'debit', amount: 999 },
      { account: 'Cuotas Sociales', type: 'credit', amount: 999 },
    ],
  },
];

describe('balance mensual vivo', () => {
  it('arma un mes por cada período del diario y no mezcla ingreso con cobro', () => {
    const months = buildLiveMonthlyBalances(SAMPLE, DEFAULT_CHART_OF_ACCOUNTS, { today: '2026-10-19' });
    expect(months.map((row) => row.key)).toEqual(['2026-10', '2026-09']);

    const october = months[0];
    expect(october.complete).toBe(false);
    expect(october.totalIncome).toBe(200);
    expect(october.totalIncomeCash).toBe(600);
    expect(october.totalExpenses).toBe(50);
    expect(october.resultado).toBe(150);
    expect(october.cashOnHand).toBe(550);
    expect(october.closingCash).toBe(550);
    expect(october.count).toBe(3);

    const september = months[1];
    expect(september.complete).toBe(true);
    expect(september.totalIncome).toBe(1000);
    expect(september.totalIncomeCash).toBe(0);
    expect(september.cashOnHand).toBe(0);
  });

  it('abre el detalle de una cuenta con los asientos de ese mes', () => {
    const months = buildLiveMonthlyBalances(SAMPLE, DEFAULT_CHART_OF_ACCOUNTS, { today: '2026-10-19' });
    const october = months[0];
    const income = october.sections.find((section) => section.family === 'in');
    const cuotas = income.lines.find((line) => line.label === 'Cuotas Sociales');
    const detail = liveMonthlyBalanceDetail(
      { ...cuotas, entries: october.entries },
      DEFAULT_CHART_OF_ACCOUNTS,
    );
    expect(detail.count).toBe(1);
    expect(detail.rows[0].glosa).toMatch(/Cobro cuota/);
    expect(detail.rows[0].haber).toBe(200);
  });

  it('resume el libro mes a mes sin mezclar ingreso con cobro', () => {
    const summary = buildLiveBalanceSummary(SAMPLE, DEFAULT_CHART_OF_ACCOUNTS, { today: '2026-10-19' });
    expect(summary.months).toHaveLength(2);
    expect(summary.periodFrom).toBe('2026-09-09');
    expect(summary.periodTo).toBe('2026-10-17');
    expect(summary.totalIncome).toBe(1200);
    expect(summary.totalIncomeCash).toBe(600);
    expect(summary.totalExpenses).toBe(50);
    expect(summary.resultado).toBe(1150);
    expect(summary.cashOnHand).toBe(550);
    expect(summary.complete).toBe(false);
    const ingresos = summary.sections.find((section) => section.id === 'resumen-ingresos');
    expect(ingresos.lines.find((line) => line.label === 'Cuotas Sociales')?.amount).toBe(1200);
  });

  it('usa el plan de cuentas institucional si el chart llega vacío', () => {
    const summary = buildLiveBalanceSummary(SAMPLE, [], { today: '2026-10-19' });
    expect(summary.totalIncome).toBe(1200);
    expect(summary.cashOnHand).toBe(550);
  });
});
