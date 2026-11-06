import { describe, expect, it } from 'vitest';
import {
  applyMemberCollectionPayments,
  buildMemberCollectionImport,
  collectionPaymentsToEntries,
  detectCobranzasSheetFormat,
  matchMemberByUnidad,
  parseCobranzasSociosSheetRows,
  parseLilaCobranzasSheetRows,
  revertMemberCollectionPayments,
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

  it('detecta y parsea Excel LILA de cobranzas/débitos', () => {
    const aoa = [
      ['Referencia', '', ''],
      ['Tipo', 'ID Recibo', 'Fecha', 'Mes', 'Año', 'NRO DE SOCIO', 'NOMBRE', 'APELLIDO', 'DNI', 'Concepto', 'Efectivo', 'Cheques', 'Cheque propio/tercero', 'Transferencia', 'Electrónico', 'Otros', 'Banco', 'Importe total'],
      ['Cuotas', '03655121', '2026-11-01', 11, 2026, 8192, 'Jean', 'Chacon', '36423639', 'Noviembre del 2026 - SOCIO INDIVIDUAL', '', '', '', '', '', '', 'Banco Macro', '40.000,00'],
      ['Cuotas', '03655788', '2026-10-01', 10, 2026, 8271, 'Juan', 'Cobos', '27527793', 'Octubre del 2026', '', '', '', '', '', '', 'Banco Macro', '52.000,00'],
      ['Recargos', '03656000', '2026-11-01', 11, 2026, 8192, 'Jean', 'Chacon', '36423639', 'Recargo nov', '', '', '', '', '', '', 'Banco Macro', '4.000,00'],
      ['Varios', '03623371', '2026-11-01', 11, 2026, 11517, 'Cecilia', 'Maturano', '35148302', 'Diferencia', '', '', '', '', '', '', 'Banco de San Juan', '52.000,00'],
    ];
    expect(detectCobranzasSheetFormat(aoa).format).toBe('lila');
    const { rows } = parseLilaCobranzasSheetRows(aoa, { month: 11, year: 2026 });
    expect(rows).toHaveLength(2);
    expect(rows[0].unidad).toBe('8192');
    expect(rows[0].monto).toBe(40000);
    expect(rows[0].banco).toBe('Banco Macro');
    expect(rows[0].comprobante).toBe('03655121');
    expect(rows[1].kind).toBe('Recargos');
    const built = buildMemberCollectionImport({
      rows,
      members: [{ memberId: '8192', name: 'Jean Chacon', outstandingBalance: 44000 }],
      entity: 'lila_cobranzas',
      paidAtReason: 'Importación Excel débitos LILA noviembre',
      importSource: 'test-batch-1',
    });
    expect(built.payments).toHaveLength(2);
    expect(built.payments[0].importSource).toBe('test-batch-1');
    expect(built.payments[0].bankName).toBe('Banco Macro');
    expect(built.payments[0].concept).toContain('Noviembre');
  });

  it('arma lote e imputa saldo parcial sin mover el vencimiento', () => {
    const members = [
      {
        memberId: '3008',
        name: 'Nuñez Adrian Cristian',
        outstandingBalance: 50000,
        nextDueDate: '2026-08-10',
        overdueSince: '2026-08-15',
        status: 'active',
      },
    ];
    const built = buildMemberCollectionImport({
      rows: [{ line: 2, unidad: '3008', nombre: 'Nuñez', fecha: '2026-08-30', monto: 25000 }],
      members,
    });
    expect(built.batch.importedCount).toBe(1);
    expect(matchMemberByUnidad(members, '3008')?.name).toContain('Nuñez');
    const { members: next, applied, ledgerEntries } = applyMemberCollectionPayments(members, built.payments);
    expect(next[0].outstandingBalance).toBe(25000);
    expect(next[0].lastPaymentDate).toBe('2026-08-30');
    expect(next[0].nextDueDate).toBe('2026-08-10');
    expect(next[0].overdueSince).toBe('2026-08-15');
    expect(next[0].paymentHistory[0].id).toBe(built.payments[0].id);
    expect(applied).toHaveLength(1);
    const entries = collectionPaymentsToEntries(built.payments, ledgerEntries);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('pago');
    expect(entries[0].value).toBe(-25000);
    expect(entries[0].id).toBe(built.payments[0].id);
  });

  it('si cancela, deja al día y pasa el vencimiento al próximo día 10', () => {
    const members = [
      {
        memberId: '3008',
        name: 'Nuñez',
        tier: 'socio_individual',
        outstandingBalance: 40000,
        nextDueDate: '2026-10-10',
        overdueSince: '2026-10-15',
        status: 'active',
        paymentHistory: [],
      },
    ];
    const built = buildMemberCollectionImport({
      rows: [{ line: 2, unidad: '3008', nombre: 'Nuñez', fecha: '2026-10-16', monto: 44000 }],
      members,
    });
    const { members: next, applied } = applyMemberCollectionPayments(members, built.payments);
    expect(next[0].outstandingBalance).toBe(0);
    expect(next[0].overdueSince).toBeNull();
    expect(next[0].nextDueDate).toBe('2026-11-10');
    expect(applied[0].fullyPaid).toBe(true);
    const restored = revertMemberCollectionPayments(next, applied);
    expect(restored[0].outstandingBalance).toBe(40000);
    expect(restored[0].nextDueDate).toBe('2026-10-10');
    expect(restored[0].overdueSince).toBe('2026-10-15');
    expect(restored[0].paymentHistory).toHaveLength(0);
  });

  it('matchea por DNI y deja crédito si el cobro supera la deuda', () => {
    const members = [
      {
        memberId: '4240955017912629',
        name: 'Alejandro',
        documentNumber: '31888184',
        tier: 'socio_individual',
        outstandingBalance: 40000,
        nextDueDate: '2026-10-10',
        status: 'active',
        paymentHistory: [],
      },
    ];
    expect(matchMemberByUnidad(members, '31888184')?.name).toBe('Alejandro');
    const built = buildMemberCollectionImport({
      rows: [{ line: 2, unidad: '31888184', nombre: 'Alejandro', fecha: '2026-10-16', monto: 50000 }],
      members,
    });
    expect(built.payments[0].matched).toBe(true);
    const { members: next } = applyMemberCollectionPayments(members, built.payments);
    expect(next[0].outstandingBalance).toBe(-6000);
    expect(next[0].nextDueDate).toBe('2026-11-10');
  });

  it('la misma fila dos veces no vuelve a bajar el saldo', () => {
    const members = [
      {
        memberId: '3008',
        name: 'Nuñez',
        outstandingBalance: 50000,
        nextDueDate: '2026-08-10',
        status: 'active',
        paymentHistory: [],
      },
    ];
    const rows = [{ line: 2, unidad: '3008', nombre: 'Nuñez', fecha: '2026-08-30', monto: 25000, comprobante: 'RC-1' }];
    const first = buildMemberCollectionImport({ rows, members });
    const second = buildMemberCollectionImport({ rows, members });
    expect(second.payments[0].id).toBe(first.payments[0].id);
    expect(first.payments[0].id).toBe('import:3008:rc:RC-1');
    const once = applyMemberCollectionPayments(members, first.payments);
    const twice = applyMemberCollectionPayments(once.members, second.payments);
    expect(once.members[0].outstandingBalance).toBe(25000);
    expect(twice.members[0].outstandingBalance).toBe(25000);
    expect(twice.members[0].paymentHistory).toHaveLength(1);
    expect(twice.applied).toHaveLength(0);
  });

  it('una fila repetida en el mismo archivo entra una sola vez', () => {
    const built = buildMemberCollectionImport({
      rows: [
        { line: 2, unidad: '3008', fecha: '2026-08-30', monto: 25000, comprobante: 'RC-1' },
        { line: 3, unidad: '3008', fecha: '2026-08-30', monto: 25000, comprobante: 'RC-1' },
      ],
      members: [{ memberId: '3008', name: 'Nuñez', outstandingBalance: 50000 }],
    });
    expect(built.payments).toHaveLength(1);
    expect(built.errors[0].message).toMatch(/repetido/i);
  });
});

describe('feeBilling', () => {
  it('resuelve períodos 2026', () => {
    const periods = feePeriodsForYear(resolveFeePeriods(null), 2026);
    expect(periods).toHaveLength(12);
    expect(periodLabel(periods[0])).toBe('Enero del 2026');
    expect(periods.filter((p) => p.status === 'processed')).toHaveLength(10);
    expect(periods.find((p) => p.month === 9).amount).toBe(57843000);
    expect(periods.find((p) => p.month === 10)).toMatchObject({
      accessinId: 1382,
      amount: 63233000,
      status: 'processed',
      generatedAt: '2026-09-09',
    });
    expect(periods.find((p) => p.month === 11).status).toBe('draft');
  });
});
