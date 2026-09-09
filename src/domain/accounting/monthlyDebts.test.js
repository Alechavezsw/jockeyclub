import { describe, expect, it } from 'vitest';
import {
  ACCESSIN_MONTHLY_DEBTS_AS_OF,
  ACCESSIN_MONTHLY_DEBTS_SNAPSHOT,
  filterDebtorsByPeriod,
  listDebtPeriods,
  listMonthlyDebtors,
  lookupMonthlyDebt,
} from './monthlyDebts';

describe('monthlyDebts / deudas mes a mes', () => {
  it('carga snapshot LILA de morosos', () => {
    expect(ACCESSIN_MONTHLY_DEBTS_AS_OF).toBe('2026-09-03');
    expect(ACCESSIN_MONTHLY_DEBTS_SNAPSHOT.memberCount).toBeGreaterThan(1000);
    expect(ACCESSIN_MONTHLY_DEBTS_SNAPSHOT.monthRowCount).toBeGreaterThan(5000);
    expect(ACCESSIN_MONTHLY_DEBTS_SNAPSHOT.lineCount).toBeGreaterThan(10000);
  });

  it('lookup socio 1004 con deuda por mes y líneas', () => {
    const hit = lookupMonthlyDebt('1004');
    expect(hit).toBeTruthy();
    expect(hit.totalDebt).toBe(56000);
    expect(hit.months.length).toBeGreaterThanOrEqual(3);
    expect(hit.months[0].periodKey).toBe('2025-02');
    expect(hit.lines.some((l) => l.type === 'Cuota')).toBe(true);
    expect(hit.lines.some((l) => /Recargo/i.test(l.type))).toBe(true);
  });

  it('lista y filtra por período', () => {
    const all = listMonthlyDebtors();
    expect(all.length).toBe(ACCESSIN_MONTHLY_DEBTS_SNAPSHOT.memberCount);
    const periods = listDebtPeriods();
    expect(periods.some((p) => p.periodKey === '2026-09')).toBe(true);
    const sept = filterDebtorsByPeriod(all, '2026-09');
    expect(sept.length).toBeGreaterThan(0);
    expect(sept.every((m) => m.months.some((row) => row.periodKey === '2026-09'))).toBe(true);
  });
});
