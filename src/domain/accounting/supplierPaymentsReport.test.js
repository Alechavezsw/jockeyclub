import { describe, expect, it } from 'vitest';
import {
  ACCESSIN_SUPPLIER_PAYMENTS,
  ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT,
  filterAccessinSupplierPayments,
  supplierPaymentsSummary,
} from './supplierPaymentsReport';

describe('supplierPaymentsReport Accessin', () => {
  it('refleja el reporte LILA (hoy vacío)', () => {
    expect(ACCESSIN_SUPPLIER_PAYMENTS).toEqual([]);
    expect(ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT.totalAmount).toBe(0);
    expect(ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT.count).toBe(0);
  });

  it('resume y filtra sin errores con lista vacía', () => {
    const summary = supplierPaymentsSummary();
    expect(summary.count).toBe(0);
    expect(filterAccessinSupplierPayments([])).toEqual([]);
  });
});
