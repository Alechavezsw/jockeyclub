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

// Expected totals from Lila October cobranzas file
const EXPECTED_TOTAL_PERCIBIDO = 60782873.34;
const EXPECTED_BY_TYPE = {
  Cuotas: 53974732.94,
  Recargos: 589000.03,
  Varios: 4590140.37,
  Eventos: 1629000,
};

describe('cobranzas Accessin', () => {
  it('carga el reporte real de Octubre 2026', () => {
    expect(ACCESSIN_COBRANZAS_SNAPSHOT.asOf).toBe('2026-10-19');
    expect(ACCESSIN_COBRANZAS.length).toBe(1122);
    expect(ACCESSIN_COBRANZAS_SNAPSHOT.totalAmount).toBeCloseTo(EXPECTED_TOTAL_PERCIBIDO, 2);
  });

  it('resume por tipo coincide con archivo Lila', () => {
    const summary = cobranzasSummary();
    expect(summary.byType.Cuotas).toBeCloseTo(EXPECTED_BY_TYPE.Cuotas, 2);
    expect(summary.byType.Recargos).toBeCloseTo(EXPECTED_BY_TYPE.Recargos, 2);
    expect(summary.byType.Varios).toBeCloseTo(EXPECTED_BY_TYPE.Varios, 2);
    expect(summary.byType.Eventos).toBeCloseTo(EXPECTED_BY_TYPE.Eventos, 2);
    expect(summary.count).toBe(ACCESSIN_COBRANZAS.length);
    const typed = Object.values(summary.byType).reduce((sum, value) => sum + value, 0);
    expect(Math.round(typed * 100) / 100).toBeCloseTo(summary.totalAmount, 2);
  });

  it('desglose de líneas suma al total percibido', () => {
    const summary = cobranzasSummary();
    const breakdownSum = Math.round((
      summary.cuotasDelMes +
      summary.cuotasAtrasadas +
      summary.cuotasAdelantadas +
      summary.recargos +
      summary.reservasEventos +
      summary.varios +
      summary.alquileresATerceros +
      summary.porteriaEstacionamiento
    ) * 100) / 100;

    // CRITICAL: breakdown must sum to exactly the total
    expect(breakdownSum).toBeCloseTo(summary.totalAmount, 2);
    expect(summary.totalAmount).toBeCloseTo(EXPECTED_TOTAL_PERCIBIDO, 2);
  });

  it('cuotas se clasifican en del mes, atrasadas, adelantadas', () => {
    const summary = cobranzasSummary();
    const cuotasSum = summary.cuotasDelMes + summary.cuotasAtrasadas + summary.cuotasAdelantadas;
    // cuotasSinClasificar may exist for edge cases
    const allCuotas = cuotasSum + (summary.cuotasSinClasificar || 0);
    expect(allCuotas).toBeCloseTo(EXPECTED_BY_TYPE.Cuotas, 2);
  });

  it('alquileres a terceros incluye no-socios', () => {
    const summary = cobranzasSummary();
    // From Lila: ~$2.19M for Alameda Padel, La Kelita, Colegio Fanzolato
    expect(summary.alquileresATerceros).toBeGreaterThan(2_000_000);
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
