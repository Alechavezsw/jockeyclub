import { beforeAll, describe, expect, it } from 'vitest';
import { hasLocalSnapshot, loadSnapshots } from '../../data/snapshots';
import {
  buildLiveSupplierPayments,
  filterAccessinSupplierPayments,
  supplierPaymentsSeed,
  supplierPaymentsSummary,
  supplierPaymentsTotal,
} from './supplierPaymentsReport';

let ACCESSIN_SUPPLIER_PAYMENTS;
let ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT;

beforeAll(async () => {
  await loadSnapshots(['accessinSupplierPayments']);
  ({ ACCESSIN_SUPPLIER_PAYMENTS, ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT } = supplierPaymentsSeed());
});

describe('supplierPaymentsReport snapshot', () => {
  it.skipIf(!hasLocalSnapshot('accessinSupplierPayments'))('el corte trae los pagos que Lila exporta', () => {
    expect(ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ACCESSIN_SUPPLIER_PAYMENTS.length).toBeGreaterThan(50);
    expect(ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT.totalAmount).toBeGreaterThan(1_000_000);
  });

  it.skipIf(!hasLocalSnapshot('accessinSupplierPayments'))('resume el listado cargado', () => {
    const summary = supplierPaymentsSummary();
    expect(summary.count).toBe(ACCESSIN_SUPPLIER_PAYMENTS.length);
    expect(summary.totalAmount).toBeGreaterThan(1_000_000);
    expect(filterAccessinSupplierPayments([])).toEqual([]);
  });
});

describe('buildLiveSupplierPayments', () => {
  const snapshot = {
    asOf: '2026-09-26',
    periodFrom: '2026-03-26',
    periodTo: '2026-09-26',
  };
  const today = new Date(2026, 9, 19, 12);

  it('suma órdenes y gastos pagados posteriores al corte', () => {
    const live = buildLiveSupplierPayments({
      items: [],
      snapshot,
      paymentOrders: [
        {
          id: 'po-1',
          orderKind: 'supplier',
          amount: 1500,
          date: '2026-10-02',
          payee: 'Acme',
          number: 'OP-1',
          paymentMethod: 'transferencia',
        },
        { id: 'po-m', orderKind: 'member', amount: 999, date: '2026-10-02' },
        { id: 'po-old', orderKind: 'supplier', amount: 200, date: '2026-09-20' },
        { id: 'po-void', orderKind: 'supplier', amount: 80, date: '2026-10-03', status: 'void' },
      ],
      expenses: [
        {
          id: 'exp-1',
          status: 'paid',
          amount: 500,
          paidAt: '2026-10-05',
          vendorName: 'Limpieza',
          concept: 'Octubre',
        },
        { id: 'exp-2', status: 'approved', amount: 800, expenseDate: '2026-10-05' },
      ],
      today,
    });
    expect(live.asOf).toBe('2026-10-19');
    expect(live.periodFrom).toBe('2026-03-26');
    expect(live.extraCount).toBe(2);
    expect(live.rows).toHaveLength(2);
    expect(supplierPaymentsTotal(live.rows)).toBe(2000);
    expect(live.monthTotal).toBeCloseTo(2000, 2);
    expect(live.cards.find((card) => card.id === 'total')?.monthInflow).toBeCloseTo(2000, 2);
    expect(live.cards.find((card) => card.id === 'total')?.caption).not.toMatch(/Accessin|LILA|Enero/i);
  });

  it('si no hay pagos, el período arranca en el corte', () => {
    const live = buildLiveSupplierPayments({
      items: [],
      snapshot: { asOf: '2026-09-26', periodTo: '2026-09-26' },
      paymentOrders: [],
      expenses: [],
      today,
    });
    expect(live.periodFrom).toBe('2026-09-26');
    expect(live.rows).toEqual([]);
    expect(live.dayTotal).toBe(0);
    expect(live.monthTotal).toBe(0);
    expect(live.cards.find((c) => c.id === 'total')?.caption).toMatch(/Hoy sin pagos/);
  });

  it('no duplica un gasto ya vinculado a una orden', () => {
    const live = buildLiveSupplierPayments({
      items: [],
      snapshot,
      paymentOrders: [{
        id: 'po-1',
        orderKind: 'supplier',
        amount: 900,
        date: '2026-10-04',
        number: 'OP-9',
        payee: 'Luz',
      }],
      expenses: [{
        id: 'exp-1',
        status: 'paid',
        amount: 900,
        paidAt: '2026-10-04',
        paymentOrderId: 'po-1',
        vendorName: 'Luz',
      }],
      today,
    });
    expect(live.rows).toHaveLength(1);
    expect(live.rows[0].orderId).toBe('OP-9');
  });
});
