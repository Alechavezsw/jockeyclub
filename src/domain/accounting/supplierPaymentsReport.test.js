import { beforeAll, describe, expect, it } from 'vitest';
import { loadSnapshots } from '../../data/snapshots';
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
  it('el corte de septiembre no trae pagos históricos', () => {
    expect(ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT.asOf).toBe('2026-09-26');
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
    expect(live.cards.find((card) => card.id === 'total')?.caption).not.toMatch(/Accessin|LILA/i);
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
    expect(live.cards[0].caption).toContain('sin pagos registrados');
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
