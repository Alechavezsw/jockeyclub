import { describe, expect, it } from 'vitest';
import {
  buildSupplierPaymentImport,
  mapPaymentMethodLabel,
  matchSupplierByName,
  parsePagosSheetRows,
} from './supplierPaymentImport';

describe('supplierPaymentImport', () => {
  it('parsea hoja PAGOS y omite filas vacías', () => {
    const aoa = [
      ['PROVEEDOR', 'FECHA (YYYY-MM-DD)', 'DESCRIPCIÓN', 'A', 'B', 'C', 'N° COMPROBANTE (OPCIONAL)', 'MONTO', 'FORMA DE PAGO'],
      ['', '', '', '', '', '', '', 0, ''],
      ['FRAVEGA', '2026-09-01', 'Factura 1', '', '', '', 'A-1', 12000, 'Efectivo'],
    ];
    const rows = parsePagosSheetRows(aoa);
    expect(rows).toHaveLength(1);
    expect(rows[0].proveedor).toBe('FRAVEGA');
    expect(rows[0].monto).toBe(12000);
  });

  it('arma importación y marca avisos si no hay padrón', () => {
    const built = buildSupplierPaymentImport({
      rows: [{
        line: 2,
        proveedor: 'FRAVEGA',
        fecha: '2026-09-01',
        descripcion: 'Pago',
        monto: 5000,
        formaPago: 'Transferencia Banco Macro',
        comprobante: '',
        confecciona: '',
        autoriza: '',
        retira: '',
      }],
      suppliers: [{ id: 's1', legalName: 'FRAVEGA', accessinCode: '1771', openingBalance: 10000 }],
      fileName: 'test.xlsx',
    });
    expect(built.payments).toHaveLength(1);
    expect(built.payments[0].status).toBe('paid');
    expect(built.payments[0].paymentMethod).toBe('transferencia');
    expect(built.batch.importedCount).toBe(1);
    expect(built.batch.totalAmount).toBe(5000);
    expect(mapPaymentMethodLabel('Efectivo')).toBe('efectivo');
    expect(matchSupplierByName([{ legalName: 'FRAVEGA' }], 'fravega')?.legalName).toBe('FRAVEGA');
  });
});
