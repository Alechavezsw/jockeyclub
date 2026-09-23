import { beforeAll, describe, expect, it } from 'vitest';
import { loadSnapshots } from '../../data/snapshots';
import {
  filterAccessinSupplierPayments,
  supplierPaymentsSeed,
  supplierPaymentsSummary,
} from './supplierPaymentsReport';

let ACCESSIN_SUPPLIER_PAYMENTS;
let ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT;

beforeAll(async () => {
  await loadSnapshots(['accessinSupplierPayments']);
  ({ ACCESSIN_SUPPLIER_PAYMENTS, ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT } = supplierPaymentsSeed());
});

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
