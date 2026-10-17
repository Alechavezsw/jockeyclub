import { describe, expect, it } from 'vitest';
import {
  applyMemberCollectionPayments,
  buildMemberCollectionImport,
  collectionPaymentsToEntries,
  matchMemberByUnidad,
  parseCobranzasSociosSheetRows,
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
      rows: [{ line: 2, unidad: '3008', nombre: 'Nuñez', fecha: '2026-10-16', monto: 40000 }],
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
    expect(next[0].outstandingBalance).toBe(-10000);
    expect(next[0].nextDueDate).toBe('2026-11-10');
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
