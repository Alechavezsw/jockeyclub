import { describe, expect, it } from 'vitest';
import {
  SUPPLIER_ENTRY_TYPE_OPTIONS,
  createSupplierEntry,
  supplierEntryBalanceDelta,
} from './supplierEntries';

describe('supplierEntries', () => {
  it('expone los tipos Accessin / LILA', () => {
    const labels = SUPPLIER_ENTRY_TYPE_OPTIONS.map((o) => o.label);
    expect(labels).toContain('Pago');
    expect(labels).toContain('Saldo inicial');
    expect(labels).toContain('Comprobante / Factura');
    expect(labels).toContain('Otros');
  });

  it('créditos reducen deuda y débitos la aumentan', () => {
    expect(supplierEntryBalanceDelta('pago', 1000)).toBe(-1000);
    expect(supplierEntryBalanceDelta('factura', 500)).toBe(500);
    expect(supplierEntryBalanceDelta('nota_credito', 200)).toBe(-200);
  });

  it('crea una entrada válida', () => {
    const entry = createSupplierEntry({
      type: 'pago',
      supplierId: 'sup-1',
      supplierName: 'MC IMPRESIONES',
      amount: 1500.5,
      concept: 'Pago parcial',
    });
    expect(entry.typeLabel).toBe('Pago');
    expect(entry.balanceDelta).toBe(-1500.5);
    expect(entry.status).toBe('posted');
  });

  it('rechaza monto inválido o proveedor vacío', () => {
    expect(() => createSupplierEntry({ type: 'pago', supplierId: 'x', amount: 0 })).toThrow();
    expect(() => createSupplierEntry({ type: 'pago', amount: 10 })).toThrow();
  });
});
