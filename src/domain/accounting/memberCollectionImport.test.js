import { describe, expect, it } from 'vitest';
import {
  applyMemberCollectionPayments,
  buildMemberCollectionImport,
  matchMemberByUnidad,
  parseCobranzasSociosSheetRows,
} from './memberCollectionImport';
import { feePeriodsForYear, periodLabel, resolveFeePeriods } from './feeBilling';

describe('memberCollectionImport', () => {
  it('parsea hoja Socios de lista base', () => {
    const rows = parseCobranzasSociosSheetRows([
      ['UNIDAD', 'NOMBRE Y APELLIDO', 'FECHA (YYYY-MM-DD)', 'MONTO', 'CBU (OPCIONAL)', 'COMPROBANTE (OPCIONAL)'],
      [3008, 'Nuñez Adrian Cristian', '2026-08-30', 25000, '', 'RC-1'],
      [1, 'Castañeda', '', 0, '', ''],
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].unidad).toBe('3008');
    expect(rows[0].monto).toBe(25000);
  });

  it('arma lote e imputa saldo', () => {
    const members = [
      { memberId: '3008', name: 'Nuñez Adrian Cristian', outstandingBalance: 50000, status: 'active' },
    ];
    const built = buildMemberCollectionImport({
      rows: [{ line: 2, unidad: '3008', nombre: 'Nuñez', fecha: '2026-08-30', monto: 25000 }],
      members,
    });
    expect(built.batch.importedCount).toBe(1);
    expect(matchMemberByUnidad(members, '3008')?.name).toContain('Nuñez');
    const next = applyMemberCollectionPayments(members, built.payments);
    expect(next[0].outstandingBalance).toBe(25000);
  });
});

describe('feeBilling', () => {
  it('resuelve períodos 2026', () => {
    const periods = feePeriodsForYear(resolveFeePeriods(null), 2026);
    expect(periods).toHaveLength(12);
    expect(periodLabel(periods[0])).toBe('Enero del 2026');
    expect(periods.filter((p) => p.status === 'processed')).toHaveLength(9);
  });
});
