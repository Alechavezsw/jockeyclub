import { describe, expect, it } from 'vitest';
import {
  createSupplier,
  expensesForSupplier,
  supplierAccountMovements,
  supplierOpenBalance,
  supplierRunningBalance,
  updateSupplier,
} from './suppliers';

describe('suppliers', () => {
  it('crea proveedor con razón social', () => {
    const s = createSupplier({ legalName: '  Acme SA  ', category: 'servicios' });
    expect(s.legalName).toBe('Acme SA');
    expect(s.category).toBe('servicios');
    expect(s.status).toBe('active');
  });

  it('rechaza alta sin razón social', () => {
    expect(() => createSupplier({ legalName: '  ' })).toThrow(/razón social/i);
  });

  it('actualiza datos y calcula deuda abierta', () => {
    const base = createSupplier({ legalName: 'Forrajes Cuyo SA', tradeName: 'Forrajes Cuyo' });
    const updated = updateSupplier(base, { phone: '2644000000' });
    expect(updated.phone).toBe('2644000000');

    const expenses = [
      { vendorName: 'Forrajes Cuyo', amount: 10000, status: 'approved' },
      { vendorName: 'Forrajes Cuyo SA', amount: 5000, status: 'pending_approval' },
      { vendorName: 'Forrajes Cuyo', amount: 2000, status: 'paid' },
      { vendorName: 'Otro', amount: 9000, status: 'approved' },
    ];
    expect(expensesForSupplier(expenses, updated)).toHaveLength(3);
    expect(supplierOpenBalance(expenses, updated)).toBe(15000);
  });

  it('usa saldo Accessin cuando no hay gastos ERP', () => {
    const s = createSupplier({
      legalName: 'QUIROGA C Rodrigo Osvaldo',
      accessinCode: '1348',
      openingBalance: 500000,
    });
    expect(supplierOpenBalance([], s)).toBe(500000);
  });

  it('vincula gastos por id de proveedor', () => {
    const s = createSupplier({ legalName: 'Otro nombre' });
    const expenses = [{ supplierId: s.id, vendorName: 'Distinto', amount: 80, status: 'approved' }];
    expect(expensesForSupplier(expenses, s)).toHaveLength(1);
  });

  it('arma el saldo con apertura, entradas y pagos sin contar dos veces', () => {
    const s = createSupplier({ legalName: 'MC IMPRESIONES', openingBalance: 1000 });
    const entries = [
      { id: 'e1', supplierId: s.id, status: 'posted', date: '2026-10-01', balanceDelta: 500, typeLabel: 'Factura', concept: 'Papel' },
      { id: 'e2', supplierId: s.id, status: 'posted', date: '2026-10-02', balanceDelta: -200, paymentOrderId: 'po-1', typeLabel: 'Pago', concept: 'Pago' },
    ];
    const paymentOrders = [
      { id: 'po-1', supplierId: s.id, amount: 200, orderKind: 'supplier', date: '2026-10-02' },
      { id: 'po-2', supplierId: s.id, amount: 100, orderKind: 'supplier', date: '2026-10-03', concept: 'Pago suelto' },
      { id: 'po-m', supplierId: s.id, amount: 999, orderKind: 'member' },
    ];
    expect(supplierRunningBalance(s, { entries, paymentOrders })).toBe(1200);
    const movements = supplierAccountMovements(s, { entries, paymentOrders });
    expect(movements.map((row) => row.balance)).toEqual([1500, 1300, 1200]);
  });
});
