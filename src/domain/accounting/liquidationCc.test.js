import { describe, expect, it } from 'vitest';
import {
  ACCESSIN_LIQUIDATION_CC,
  ACCESSIN_LIQUIDATION_CC_AS_OF,
  filterLiquidationCc,
  liquidationCcSummary,
  parseLiquidationCcRows,
} from './liquidationCc';

describe('detalle cta cte liquidación', () => {
  it('carga el snapshot LILA de agosto 2026', () => {
    const summary = liquidationCcSummary();
    expect(ACCESSIN_LIQUIDATION_CC_AS_OF).toBe('2026-09-09');
    expect(summary.periodLabel).toMatch(/agosto del 2026/i);
    expect(summary.liquidation).toBe(56991000);
    expect(summary.previousBalance).toBe(321966649.55);
    expect(ACCESSIN_LIQUIDATION_CC.length).toBe(summary.listedCount);
    expect(summary.withLiquidation).toBeGreaterThan(1000);
  });

  it('parsea y filtra filas del export LILA', () => {
    const rows = parseLiquidationCcRows([
      ['NRO DE SOCIO', 'NOMBRE', 'APELLIDO', 'DNI', 'SALDO ANTERIOR', 'LIQUIDACIÓN', 'OTROS', 'INTERESES', 'SIN RECARGOS', 'RECARGO', 'RECARGO'],
      ['1205', 'Marcelo', 'Flores', '20111222', 0, 60000, 0, 0, 60000, 62000, 62000],
      ['Alquiler Padel', 'Alameda', 'Padel', '96969696', 659087.83, 0, 817783.96, 0, 659087.83, 0, 0],
      ['TOTALES', '', '', '', 321966649.55, 56991000, 0, 0, 0, 0, 0],
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].liquidation).toBe(60000);
    expect(rows[1].memberNumber).toBe('Alquiler Padel');
    expect(filterLiquidationCc(rows, { query: 'flores' })).toHaveLength(1);
    expect(filterLiquidationCc(rows, { onlyLiquidation: true })).toHaveLength(1);
    expect(filterLiquidationCc(rows, { query: '999' })).toHaveLength(0);
  });
});
