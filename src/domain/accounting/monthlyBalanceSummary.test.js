import { beforeAll, describe, expect, it } from 'vitest';
import { loadSnapshots } from '../../data/snapshots';
import {
  findMonthlyBalanceSummarySection,
  monthlyBalanceSummaryCards,
  monthlyBalanceSummarySeed,
} from './monthlyBalanceSummary';

let ACCESSIN_MONTHLY_BALANCE_SUMMARY_AS_OF;
let ACCESSIN_MONTHLY_BALANCE_SUMMARY_SECTIONS;

beforeAll(async () => {
  await loadSnapshots(['accessinMonthlyBalanceSummary']);
  ({
    ACCESSIN_MONTHLY_BALANCE_SUMMARY_AS_OF,
    ACCESSIN_MONTHLY_BALANCE_SUMMARY_SECTIONS,
  } = monthlyBalanceSummarySeed());
});

describe('balance mensual resumido LILA', () => {
  it('arma las cards del corte de octubre 2026', () => {
    const cards = monthlyBalanceSummaryCards();
    expect(ACCESSIN_MONTHLY_BALANCE_SUMMARY_AS_OF).toBe('2026-10-31');
    expect(cards.periodFrom).toBe('2026-10-01');
    expect(cards.periodTo).toBe('2026-10-31');
    expect(cards.totalIncome).toBeCloseTo(55058095.13, 2);
    expect(cards.totalIncomeCash).toBeCloseTo(56880095.13, 2);
    expect(cards.totalExpenses).toBe(0);
    expect(cards.cashOnHand).toBeCloseTo(820341100.27, 2);
    expect(cards.closingCash).toBeCloseTo(877221195.4, 2);
    expect(cards.summarized).toBe(true);
    expect(cards.sourceFolder).toMatch(/resumido/i);
  });

  it('encuentra las secciones del resumen sin hojas de detalle', () => {
    expect(findMonthlyBalanceSummarySection(ACCESSIN_MONTHLY_BALANCE_SUMMARY_SECTIONS, 'saldos_de_caja')?.title)
      .toBe('SALDOS DE CAJA');
    expect(findMonthlyBalanceSummarySection(ACCESSIN_MONTHLY_BALANCE_SUMMARY_SECTIONS, 'liquidacion')?.title)
      .toMatch(/LIQUIDACI/i);
    const ingresos = findMonthlyBalanceSummarySection(
      ACCESSIN_MONTHLY_BALANCE_SUMMARY_SECTIONS,
      'ingresos_por_tipo_de_entrada',
    );
    expect(ingresos?.lines.some((line) => /^TOTAL INGRESOS$/i.test(line.label))).toBe(true);
    expect(ingresos?.lines.every((line) => !line.detailKey)).toBe(true);
  });
});
