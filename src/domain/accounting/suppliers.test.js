import { describe, expect, it } from 'vitest';
import {
  createSupplier,
  expensesForSupplier,
  supplierOpenBalance,
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
});
