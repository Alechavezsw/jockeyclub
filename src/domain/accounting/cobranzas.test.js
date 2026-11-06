import { beforeAll, describe, expect, it } from 'vitest';
import { hasLocalSnapshot, loadSnapshots } from '../../data/snapshots';
import {
  cobranzasBalanceCards,
  cobranzasScopedSummary,
  cobranzasSeed,
  cobranzasSummary,
  filterAccessinCobranzas,
} from './cobranzas';

let ACCESSIN_COBRANZAS;
let ACCESSIN_COBRANZAS_SNAPSHOT;

beforeAll(async () => {
  await loadSnapshots(['accessinCobranzas']);
  ({ ACCESSIN_COBRANZAS, ACCESSIN_COBRANZAS_SNAPSHOT } = cobranzasSeed());
});

describe('cobranzas Accessin', () => {
  it.skipIf(!hasLocalSnapshot('accessinCobranzas'))('carga el reporte real', () => {
    expect(ACCESSIN_COBRANZAS_SNAPSHOT.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ACCESSIN_COBRANZAS.length).toBeGreaterThan(1000);
    expect(ACCESSIN_COBRANZAS_SNAPSHOT.totalAmount).toBeGreaterThan(1_000_000);
  });

  it.skipIf(!hasLocalSnapshot('accessinCobranzas'))('resume por tipo', () => {
    const summary = cobranzasSummary();
    expect(summary.byType.Cuotas).toBeGreaterThan(40_000_000);
    expect(summary.count).toBe(ACCESSIN_COBRANZAS.length);
    const typed = Object.values(summary.byType).reduce((sum, value) => sum + value, 0);
    expect(Math.round(typed * 100) / 100).toBeCloseTo(summary.totalAmount, 2);
  });

  it.skipIf(!hasLocalSnapshot('accessinCobranzas'))('filtra por tipo y texto', () => {
    const cuotas = filterAccessinCobranzas(ACCESSIN_COBRANZAS, { type: 'Cuotas', limit: 5 });
    expect(cuotas).toHaveLength(5);
    expect(cuotas.every((r) => r.type === 'Cuotas')).toBe(true);
  });

  it('filtra cobros de cuota por credencial', () => {
    const rows = filterAccessinCobranzas([
      { type: 'Cuotas', memberNumber: '10680', date: '2026-10-01', amount: 66000, receiptId: '1' },
      { type: 'Cuotas', memberNumber: '11017', date: '2026-09-01', amount: 32000, receiptId: '2' },
    ], { type: 'Cuotas', memberNumbers: ['10680'] });
    expect(rows).toHaveLength(1);
    expect(rows[0].memberNumber).toBe('10680');
  });

  it('filtra cobros de un mes sin mezclar otro', () => {
    const rows = filterAccessinCobranzas([
      { type: 'Cuotas', date: '2026-10-13', amount: 1, receiptId: 'a' },
      { type: 'Cuotas', date: '2026-09-30', amount: 2, receiptId: 'b' },
    ], { monthKey: '2026-10' });
    expect(rows).toHaveLength(1);
    expect(rows[0].receiptId).toBe('a');
  });

  it('filtra cobros de un día', () => {
    const rows = filterAccessinCobranzas([
      { type: 'Cuotas', date: '2026-11-05', amount: 4400, receiptId: 'd1' },
      { type: 'Cuotas', date: '2026-11-04', amount: 32000, receiptId: 'd2' },
    ], { onDate: '2026-11-05' });
    expect(rows).toHaveLength(1);
    expect(rows[0].receiptId).toBe('d1');
  });

  it('resume día y mes por separado en las tarjetas', () => {
    const items = [
      { type: 'Cuotas', date: '2026-11-05', amount: 4400, receiptId: '1' },
      { type: 'Cuotas', date: '2026-11-01', amount: 32000, receiptId: '2' },
      { type: 'Recargos', date: '2026-11-05', amount: 3200, receiptId: '3' },
      { type: 'Cuotas', date: '2026-10-20', amount: 66000, receiptId: '4' },
    ];
    const day = cobranzasScopedSummary(items, { onDate: '2026-11-05' });
    expect(day.totalAmount).toBeCloseTo(7600, 2);
    expect(day.count).toBe(2);

    const month = cobranzasScopedSummary(items, { monthKey: '2026-11' });
    expect(month.totalAmount).toBeCloseTo(39600, 2);
    expect(month.byType.Cuotas).toBeCloseTo(36400, 2);

    const balance = cobranzasBalanceCards(items, { asOf: '2026-11-05' });
    expect(balance.dayTotal).toBeCloseTo(7600, 2);
    expect(balance.monthTotal).toBeCloseTo(39600, 2);
    expect(balance.cards.find((c) => c.id === 'total')?.monthInflow).toBeCloseTo(39600, 2);
    expect(balance.cards.find((c) => c.id === 'type-Cuotas')?.dayInflow).toBeCloseTo(4400, 2);
    expect(balance.cards.find((c) => c.id === 'type-Cuotas')?.monthInflow).toBeCloseTo(36400, 2);
  });
});
