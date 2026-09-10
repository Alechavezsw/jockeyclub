import { describe, expect, it } from 'vitest';
import {
  ACCESSIN_CREDIT_PURCHASES,
  ACCESSIN_CREDIT_PURCHASES_AS_OF,
  creditPurchaseSummary,
  filterCreditPurchases,
  parseAccessinDate,
  parseCreditPurchaseRows,
} from './memberCreditPurchases';

describe('créditos comprados por socios', () => {
  it('carga el snapshot LILA aunque no haya compras', () => {
    expect(ACCESSIN_CREDIT_PURCHASES_AS_OF).toBe('2026-09-09');
    expect(ACCESSIN_CREDIT_PURCHASES).toEqual([]);
    expect(creditPurchaseSummary().count).toBe(0);
  });

  it('parsea fechas y filas del export LILA', () => {
    expect(parseAccessinDate('09/09/2026')).toBe('2026-09-09');
    const rows = parseCreditPurchaseRows([
      ['Nro de socio', 'Nombre', 'Apellido', 'Documento', 'Fecha de compra', 'Combo', 'Cantidad de créditos', 'Medio de pago', 'Importe total', 'Estado', 'Fecha de cobro', 'Monto cobrado', 'Diferencia'],
      ['11017', 'Mariana', 'Rodríguez', '30111222', '2026-08-12', 'Pack 10', 10, 'Transferencia', 25000, 'Cobrado', '2026-08-13', 25000, 0],
      ['', '', '', '', '', '', '', '', '', '', '', '', ''],
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].memberNumber).toBe('11017');
    expect(rows[0].combo).toBe('Pack 10');
    expect(rows[0].totalAmount).toBe(25000);
    expect(filterCreditPurchases(rows, { query: 'mariana' })).toHaveLength(1);
    expect(filterCreditPurchases(rows, { query: '999' })).toHaveLength(0);
    expect(creditPurchaseSummary(rows).uniqueMembers).toBe(1);
  });
});
