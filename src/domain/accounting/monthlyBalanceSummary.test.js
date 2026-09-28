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
  it('arma las cards del corte de septiembre 2026', () => {
    const cards = monthlyBalanceSummaryCards();
    expect(ACCESSIN_MONTHLY_BALANCE_SUMMARY_AS_OF).toBe('2026-09-30');
    expect(cards.periodFrom).toBe('2026-09-01');
    expect(cards.periodTo).toBe('2026-09-30');
    expect(cards.totalIncome).toBe(58958673.76);
    expect(cards.totalIncomeCash).toBe(63155673.76);
    expect(cards.totalExpenses).toBe(0);
    expect(cards.cashOnHand).toBe(750753028.51);
    expect(cards.closingCash).toBe(813908702.27);
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
