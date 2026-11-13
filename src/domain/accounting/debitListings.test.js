import { describe, expect, it } from 'vitest';
import {
  applyDebitCardEdit,
  buildDebitListingMatrix,
  collectDebitBrands,
  debitListingHorizonPeriods,
  debitListingPeriodOptions,
  debitListingSheetName,
  previousDebitListingPeriod,
  remapDebitListingsToPeriod,
  excelSerialToISODate,
  filterDebitListings,
  groupDebitListings,
  isoDateToExcelSerial,
  isValidDebitCard,
  maskDebitCard,
  presentDebitCard,
  normalizeDebitCard,
  normalizeDebitBrand,
  parseDebitListingMatrix,
  parseDebitListingSheetName,
  summarizeDebitListings,
} from './debitListings';

describe('debitListingPeriodOptions', () => {
  it('solo muestra desde octubre 2026 (sin meses anteriores)', () => {
    const now = new Date(2026, 10, 1); // 1 nov 2026 local
    const periods = debitListingPeriodOptions([], now);
    expect(periods.map((p) => p.key)).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(debitListingHorizonPeriods(now).at(-1)).toMatchObject({ key: '2026-12' });
    expect(debitListingPeriodOptions([
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
      { year: 2026, month: 9 },
      { year: 2026, month: 11 },
    ], now).map((p) => p.key)).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(periods.every((p) => p.key >= '2026-10')).toBe(true);
  });

  it('enero aparece recién cuando termina diciembre', () => {
    expect(debitListingHorizonPeriods(new Date(2026, 11, 15)).map((p) => p.key))
      .toEqual(['2026-11', '2026-12']);
    expect(debitListingHorizonPeriods(new Date(2027, 0, 1)).map((p) => p.key))
      .toEqual(['2026-12', '2027-01', '2027-02']);
  });

  it('permite cargar el mes anterior sobre diciembre', () => {
    expect(previousDebitListingPeriod(2026, 12)).toMatchObject({ key: '2026-11' });
    const mapped = remapDebitListingsToPeriod([
      {
        id: 'dl-202611-credito-1',
        year: 2026,
        month: 11,
        sheetKind: 'credito',
        sortOrder: 1,
        brand: 'ARGENCARD',
        section: 'padron',
        cardNumber: '4111111111111111',
        memberId: '8192',
        holderName: 'Chacon, Jean',
        receipt: '112026',
        dueDate: '2026-11-10',
      },
      {
        id: 'dl-202611-credito-2',
        year: 2026,
        month: 11,
        sheetKind: 'credito',
        sortOrder: 2,
        brand: 'VISA',
        section: 'altas',
        cardNumber: '4111111111111111',
        memberId: '9394',
        holderName: 'Garces, Facundo',
        note: 'ALTA NOV',
      },
      {
        id: 'dl-202611-credito-3',
        year: 2026,
        month: 11,
        sheetKind: 'credito',
        sortOrder: 3,
        brand: 'ARGENCARD',
        section: 'bajas',
        cardNumber: '5555555555554444',
        memberId: '8407',
        holderName: 'Perez Gustavo',
      },
    ], { year: 2026, month: 12 });
    expect(mapped).toHaveLength(2);
    expect(mapped[0]).toMatchObject({
      id: 'dl-202612-credito-1',
      year: 2026,
      month: 12,
      section: 'padron',
      receipt: '122026',
      dueDate: '2026-12-10',
      sourceSheet: 'Diciembre 2026',
      holderName: 'Chacon, Jean',
    });
    expect(mapped[1]).toMatchObject({
      section: 'padron',
      memberId: '9394',
      holderName: 'Garces, Facundo',
      note: '',
    });
    expect(mapped.some((row) => row.memberId === '8407')).toBe(false);
  });
});

describe('collectDebitBrands', () => {
  it('incluye Argencard, Visa y Visa Débito', () => {
    const brands = collectDebitBrands([{ brand: 'VISA' }, { brand: 'ARGENCARD' }]);
    expect(brands.map((b) => b.id)).toEqual(['ARGENCARD', 'VISA', 'VISA DEBITO']);
    expect(normalizeDebitBrand('visa débito')).toBe('VISA DEBITO');
  });
});

describe('parseDebitListingSheetName', () => {
  it('distingue crédito y débito por el nombre de hoja', () => {
    expect(parseDebitListingSheetName('Noviembre 2026')).toMatchObject({
      sheetKind: 'credito', year: 2026, month: 11,
    });
    expect(parseDebitListingSheetName('Noviembre debito 2026')).toMatchObject({
      sheetKind: 'debito', year: 2026, month: 11,
    });
  });
});

describe('parseDebitListingMatrix', () => {
  it('arma filas con brand, sección altas y montos', () => {
    const matrix = [
      ['', 'ARGENCARD'],
      ['', 'MES: NOVIEMBRE 2026'],
      ['', 'N° TARJETA', 'COMPROBANTE', 'VENCIMIENTO', 'CUOTA ', 'ABONO ', 'TOTAL', 'N°SOCIO', 'ESTADO', 'TITULAR', 'DEBITO'],
      [1, '5591980057011931', 112026, 46326, 40000, '', 40000, 8192, 'N', 'Chacon, Jean', ''],
      ['', 'ALTAS DE TARJETAS'],
      [2, '4100820191944042', 112026, 46326, 40000, 12000, 52000, 9394, 'E', 'Garces, Facundo', 'DEBITO'],
      ['', 'BAJAS DE TARJETAS'],
      [3, '5276010061453846', 112026, 46326, 70000, '', 70000, 8407, 'N', 'Perez Gustavo', 'BAJA MAJO'],
    ];
    const rows = parseDebitListingMatrix(matrix, {
      year: 2026, month: 11, sheetKind: 'credito', sourceSheet: 'Noviembre 2026',
    });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      brand: 'ARGENCARD',
      section: 'padron',
      memberId: '8192',
      duesAmount: 40000,
      totalAmount: 40000,
      statusCode: 'N',
    });
    expect(rows[0].dueDate).toBe(excelSerialToISODate(46326));
    expect(rows[1]).toMatchObject({ section: 'altas', abonoAmount: 12000, note: 'DEBITO' });
    expect(rows[2]).toMatchObject({ section: 'bajas', note: 'BAJA MAJO' });
  });
});

describe('applyDebitCardEdit', () => {
  it('registra el cambio de tarjeta y actualiza la nota', () => {
    const next = applyDebitCardEdit(
      { id: 'dl-1', cardNumber: '5591980057011931', note: '', cardEdits: [] },
      '4111 1111 1111 1111',
      { at: '2026-11-01T12:00:00', by: 'Super' },
    );
    expect(next.cardNumber).toBe('4111111111111111');
    expect(next.cardEdits).toHaveLength(1);
    expect(next.cardEdits[0]).toMatchObject({ from: '5591980057011931', to: '4111111111111111', by: 'Super' });
    expect(next.note).toMatch(/CAMBIO TARJETA/);
    expect(applyDebitCardEdit(next, '4111111111111111')).toBeNull();
    expect(isValidDebitCard('1234')).toBe(false);
    expect(normalizeDebitCard('41-11')).toBe('4111');
  });
});

describe('helpers', () => {
  it('enmascara tarjeta y resume / filtra / agrupa', () => {
    expect(maskDebitCard('5591980057011931')).toMatch(/1931$/);
    expect(presentDebitCard('5591980057011931', true)).toBe('5591 9800 5701 1931');
    expect(presentDebitCard('5591980057011931', false)).toBe('•••• 1931');
    expect(presentDebitCard('1931', false)).toBe('•••• 1931');
    const rows = [
      { brand: 'ARGENCARD', section: 'padron', totalAmount: 100, holderName: 'A', memberId: '1' },
      { brand: 'ARGENCARD', section: 'altas', totalAmount: 50, holderName: 'B', memberId: '2' },
      { brand: 'VISA', section: 'bajas', totalAmount: 20, holderName: 'C', memberId: '3' },
    ];
    expect(summarizeDebitListings(rows)).toMatchObject({ total: 3, amount: 170, altas: 1, bajas: 1 });
    expect(groupDebitListings(rows)).toHaveLength(3);
    expect(filterDebitListings(rows, { section: 'altas' })).toHaveLength(1);
    expect(filterDebitListings(rows, { query: 'garces' })).toHaveLength(0);
    expect(filterDebitListings(rows, { query: '2' })).toHaveLength(1);
  });
});

describe('buildDebitListingMatrix', () => {
  it('reconstruye cabeceras, subtotal de padrón y secciones como la planilla', () => {
    expect(debitListingSheetName(2026, 11, 'debito')).toBe('Noviembre debito 2026');
    const due = excelSerialToISODate(46326);
    expect(isoDateToExcelSerial(due)).toBe(46326);

    const matrix = buildDebitListingMatrix([
      {
        sortOrder: 1, brand: 'ARGENCARD', section: 'padron',
        cardNumber: '5591980057011931', receipt: '112026', dueDate: due,
        duesAmount: 40000, abonoAmount: 0, totalAmount: 40000,
        memberId: '8192', statusCode: 'N', holderName: 'Chacon, Jean', note: '',
      },
      {
        sortOrder: 2, brand: 'ARGENCARD', section: 'altas',
        cardNumber: '4100820191944042', receipt: '112026', dueDate: due,
        duesAmount: 40000, abonoAmount: 12000, totalAmount: 52000,
        memberId: '9394', statusCode: 'E', holderName: 'Garces, Facundo', note: 'DEBITO',
      },
    ], { year: 2026, month: 11, sheetKind: 'credito' });

    expect(matrix[0][1]).toBe('ARGENCARD');
    expect(matrix[1][1]).toBe('MES: NOVIEMBRE 2026');
    expect(matrix[3][1]).toBe('N° TARJETA');
    expect(matrix[4][1]).toBe('5591980057011931');
    expect(matrix[4][3]).toBe(46326);
    const subtotal = matrix.find((row) => row[4] === 40000 && row[1] == null && row[7] == null);
    expect(subtotal?.[6]).toBe(40000);
    expect(matrix.some((row) => row[1] === 'ALTAS DE TARJETAS')).toBe(true);

    const roundtrip = parseDebitListingMatrix(matrix, {
      year: 2026, month: 11, sheetKind: 'credito', sourceSheet: 'Noviembre 2026',
    });
    expect(roundtrip).toHaveLength(2);
    expect(roundtrip[0]).toMatchObject({ section: 'padron', memberId: '8192', totalAmount: 40000 });
    expect(roundtrip[1]).toMatchObject({ section: 'altas', memberId: '9394', abonoAmount: 12000 });
  });
});
