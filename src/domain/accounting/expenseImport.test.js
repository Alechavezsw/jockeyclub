import { describe, expect, it } from 'vitest';
import { buildExpenseImport, parseGastosSheetRows } from './expenseImport';

describe('expenseImport', () => {
  it('parsea hoja GASTOS con comprobante', () => {
    const aoa = [
      ['PROVEEDOR', 'FECHA (YYYY-MM-DD)', 'CONCEPTO', 'N° COMPROBANTE', 'CUENTA GASTO (OPCIONAL)', 'MONTO'],
      ['', '', '', '', '', 0],
      ['FRAVEGA', '2026-09-01', 'Insumos', 'FC-100', 'Gastos Generales', 25000],
    ];
    const rows = parseGastosSheetRows(aoa);
    expect(rows).toHaveLength(1);
    expect(rows[0].comprobante).toBe('FC-100');
    expect(rows[0].monto).toBe(25000);
  });

  it('arma gastos pendientes de aprobación', () => {
    const built = buildExpenseImport({
      rows: [{
        line: 2,
        proveedor: 'FRAVEGA',
        fecha: '2026-09-01',
        concepto: 'Compra',
        comprobante: 'A-1',
        cuentaGasto: '',
        monto: 1000,
      }],
      suppliers: [{ id: 's1', legalName: 'FRAVEGA' }],
      expenseAccounts: [{ id: 'coa-exp', name: 'Gastos Generales', code: '5.1' }],
      paymentAccountId: 'coa-cash',
      defaultCategoryAccountId: 'coa-exp',
      fileName: 'gastos.xlsx',
    });
    expect(built.expenses).toHaveLength(1);
    expect(built.expenses[0].status).toBe('pending_approval');
    expect(built.expenses[0].invoiceNumber).toBe('A-1');
    expect(built.batch.moduleLabel).toMatch(/comprobante/i);
  });
});
