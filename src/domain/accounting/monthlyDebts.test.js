import { beforeAll, describe, expect, it } from 'vitest';
import { loadSnapshots } from '../../data/snapshots';
import {
  filterDebtorsByPeriod,
  listDebtPeriods,
  listMonthlyDebtors,
  lookupMonthlyDebt,
  monthlyDebtsSeed,
} from './monthlyDebts';

let ACCESSIN_MONTHLY_DEBTS_AS_OF;
let ACCESSIN_MONTHLY_DEBTS_SNAPSHOT;

beforeAll(async () => {
  await loadSnapshots(['accessinMonthlyDebts']);
  ({ ACCESSIN_MONTHLY_DEBTS_AS_OF, ACCESSIN_MONTHLY_DEBTS_SNAPSHOT } = monthlyDebtsSeed());
});

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
    expect(sept.length).toBeLessThan(all.length);
    expect(sept.every((m) => m.months.some((row) => row.periodKey === '2026-09' && ((Number(row.capital) || 0) !== 0 || (Number(row.interest) || 0) !== 0)))).toBe(true);
  });

  it('al elegir un mes muestra la deuda de ese mes, no el total', () => {
    const hit = lookupMonthlyDebt('1004');
    const febRow = hit.months.find((row) => row.periodKey === '2025-02');
    expect(febRow).toBeTruthy();
    const feb = listMonthlyDebtors({ periodKey: '2025-02' });
    const row = feb.find((m) => m.memberNumber === '1004');
    expect(row).toBeTruthy();
    expect(row.capital).toBe(febRow.capital);
    expect(row.interest).toBe(febRow.interest);
    expect(row.totalDebt).toBe(febRow.accumulated);
    expect(row.capital).not.toBe(hit.totalDebt);
  });

  it('omite socios sin capital ni interés en el mes elegido', () => {
    const sample = [
      {
        memberNumber: '1',
        totalDebt: 100,
        months: [
          { periodKey: '2025-02', capital: 40, interest: 0, accumulated: 40 },
          { periodKey: '2025-03', capital: 0, interest: 0, accumulated: 40 },
        ],
      },
      {
        memberNumber: '2',
        totalDebt: 50,
        months: [{ periodKey: '2025-03', capital: 50, interest: 0, accumulated: 50 }],
      },
    ];
    const march = filterDebtorsByPeriod(sample, '2025-03');
    expect(march.map((m) => m.memberNumber)).toEqual(['2']);
    expect(march[0].capital).toBe(50);
    expect(filterDebtorsByPeriod(sample, '2025-02').map((m) => m.memberNumber)).toEqual(['1']);
  });
});
