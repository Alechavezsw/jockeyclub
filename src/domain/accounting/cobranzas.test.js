import { describe, expect, it } from 'vitest';
import {
  ACCESSIN_COBRANZAS,
  ACCESSIN_COBRANZAS_SNAPSHOT,
  cobranzasSummary,
  filterAccessinCobranzas,
} from './cobranzas';

describe('cobranzas Accessin', () => {
  it('carga el reporte real', () => {
    expect(ACCESSIN_COBRANZAS.length).toBeGreaterThan(1000);
    expect(ACCESSIN_COBRANZAS_SNAPSHOT.totalAmount).toBeCloseTo(53877508.99, 2);
  });

  it('resume por tipo', () => {
    const summary = cobranzasSummary();
    expect(summary.byType.Cuotas).toBeGreaterThan(40_000_000);
    expect(summary.count).toBe(ACCESSIN_COBRANZAS.length);
  });

  it('filtra por tipo y texto', () => {
    const cuotas = filterAccessinCobranzas(ACCESSIN_COBRANZAS, { type: 'Cuotas', limit: 5 });
    expect(cuotas).toHaveLength(5);
    expect(cuotas.every((r) => r.type === 'Cuotas')).toBe(true);
  });
});
