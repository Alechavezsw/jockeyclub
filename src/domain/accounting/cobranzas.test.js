import { beforeAll, describe, expect, it } from 'vitest';
import { loadSnapshots } from '../../data/snapshots';
import {
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
  it('carga el reporte real', () => {
    expect(ACCESSIN_COBRANZAS_SNAPSHOT.asOf).toBe('2026-10-26');
    expect(ACCESSIN_COBRANZAS.length).toBe(1941);
    expect(ACCESSIN_COBRANZAS_SNAPSHOT.totalAmount).toBeCloseTo(91965336.6, 2);
  });

  it('resume por tipo', () => {
    const summary = cobranzasSummary();
    expect(summary.byType.Cuotas).toBeGreaterThan(40_000_000);
    expect(summary.count).toBe(ACCESSIN_COBRANZAS.length);
    const typed = Object.values(summary.byType).reduce((sum, value) => sum + value, 0);
    expect(Math.round(typed * 100) / 100).toBeCloseTo(summary.totalAmount, 2);
  });

  it('filtra por tipo y texto', () => {
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
});
