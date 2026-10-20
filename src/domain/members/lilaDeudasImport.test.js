import { describe, it, expect } from 'vitest';
import {
  extractDeudasAsOfDate,
  periodLabelToKey,
  parseDeudaPorMes,
  parseDeudaPorSocio,
  parseTotales,
  periodDebtToDbRow,
  movementToDbRow,
  totalToDbRow,
  computeGrandTotals,
  findDuplicateSocios,
} from './lilaDeudasImport';

describe('lilaDeudasImport', () => {
  describe('extractDeudasAsOfDate', () => {
    it('extracts date from Fecha line', () => {
      const aoa = [
        [''],
        ['Generado el 20 de Octubre del 2026 a las 07:25'],
        ['Fecha 20 de Octubre del 2026'],
      ];
      expect(extractDeudasAsOfDate(aoa)).toBe('2026-10-20');
    });

    it('returns today if no date found', () => {
      const aoa = [['header', 'col2']];
      const result = extractDeudasAsOfDate(aoa);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('periodLabelToKey', () => {
    it('converts Febrero del 2025', () => {
      expect(periodLabelToKey('Febrero del 2025')).toBe('2025-02');
    });

    it('converts Octubre del 2026', () => {
      expect(periodLabelToKey('Octubre del 2026')).toBe('2026-10');
    });

    it('converts Septiembre 2025', () => {
      expect(periodLabelToKey('Septiembre 2025')).toBe('2025-09');
    });

    it('returns null for invalid', () => {
      expect(periodLabelToKey('')).toBe(null);
      expect(periodLabelToKey('Invalid')).toBe(null);
    });
  });

  describe('parseDeudaPorMes', () => {
    it('parses period rows with debt', () => {
      const aoa = [
        ['PERIODO', 'NRO DE SOCIO', 'NOMBRE', 'APELLIDO', 'DNI', 'CUOTA SOCIAL', 'CAT', 'CAPITAL', 'RECARGOS', 'INTERESES', 'DEUDA ACUMULADA'],
        ['Febrero del 2025', 1004, 'Cristina', 'Mugas', 17078085, 'SOCIO INDIVIDUAL', '–', 9000, 0, 0, 9000],
        ['Marzo del 2025', 1004, 'Cristina', 'Mugas', 17078085, 'SOCIO INDIVIDUAL', '–', 20000, 1000, 0, 30000],
      ];

      const { periodDebts, duplicates } = parseDeudaPorMes(aoa, '2026-10-20');
      
      expect(periodDebts).toHaveLength(2);
      expect(periodDebts[0].memberNumber).toBe('1004');
      expect(periodDebts[0].periodKey).toBe('2025-02');
      expect(periodDebts[0].capital).toBe(9000);
      expect(periodDebts[0].deudaAcumulada).toBe(9000);
      expect(periodDebts[1].periodKey).toBe('2025-03');
      expect(periodDebts[1].recargos).toBe(1000);
      expect(duplicates).toHaveLength(0);
    });

    it('skips zero-value rows', () => {
      const aoa = [
        ['PERIODO', 'NRO DE SOCIO', 'NOMBRE', 'APELLIDO', 'DNI', 'CUOTA', 'CAT', 'CAPITAL', 'RECARGOS', 'INTERESES', 'DEUDA'],
        ['', 1, 'Jonas', 'Castañeda', 50573357, 'GRUPO FAMILIAR', '–', 0, 0, 0, 0],
      ];

      const { periodDebts } = parseDeudaPorMes(aoa, '2026-10-20');
      expect(periodDebts).toHaveLength(0);
    });
  });

  describe('parseDeudaPorSocio', () => {
    it('parses movement rows', () => {
      const excelDate = 45689; // Feb 2025
      const aoa = [
        ['#', 'NRO DE SOCIO', 'NOMBRE', 'APELLIDO', 'DNI', 'CUOTA SOCIAL', 'CAT', 'TIPO', 'DESCRIPCIÓN', 'FECHA', 'MONTO', 'ADEUDADO'],
        [444219, 1004, 'Cristina', 'Mugas', 17078085, 'SOCIO INDIVIDUAL', '–', 'Cuota', 'Febrero del 2025', excelDate, 20000, 9000],
        [514952, 1004, 'Cristina', 'Mugas', 17078085, 'SOCIO INDIVIDUAL', '–', 'Cuota', 'Marzo del 2025', 45717, 20000, 20000],
      ];

      const { movements } = parseDeudaPorSocio(aoa, '2026-10-20');

      expect(movements).toHaveLength(2);
      expect(movements[0].memberNumber).toBe('1004');
      expect(movements[0].lilaRowId).toBe('444219');
      expect(movements[0].typeLabel).toBe('Cuota');
      expect(movements[0].monto).toBe(20000);
      expect(movements[0].adeudado).toBe(9000);
    });

    it('skips SALDO SIN IMPUTAR and TOTAL rows', () => {
      const aoa = [
        ['#', 'NRO DE SOCIO', 'NOMBRE', 'APELLIDO', 'DNI', 'CUOTA', 'CAT', 'TIPO', 'DESC', 'FECHA', 'MONTO', 'ADEUDADO'],
        ['', 1004, 'Cristina', 'Mugas', 17078085, 'SOCIO', '–', '', '', '', 'SALDO SIN IMPUTAR', 0],
        ['', 1004, 'Cristina', 'Mugas', 17078085, 'SOCIO', '–', '', '', '', 'TOTAL', 56000],
      ];

      const { movements } = parseDeudaPorSocio(aoa, '2026-10-20');
      expect(movements).toHaveLength(0);
    });
  });

  describe('parseTotales', () => {
    it('parses TOTALES rows', () => {
      const aoa = [
        ['#', 'NRO', 'NOMBRE', 'APELLIDO', 'DNI', 'CUOTA', 'CAT', 'PERIODOS', 'CAPITAL', 'RECARGOS', 'INTERESES', 'SIN IMP', 'TOTAL'],
        [89984, 1, 'Jonas', 'Castañeda', 50573357, 'GRUPO FAMILIAR', '–', 0, 0, 0, 0, 0, 0],
        [12345, 1004, 'Cristina', 'Mugas', 17078085, 'SOCIO INDIVIDUAL', '–', 3, 54000, 2000, 0, 0, 56000],
      ];

      const { totals, duplicates } = parseTotales(aoa, '2026-10-20');

      expect(totals).toHaveLength(2);
      expect(totals[1].memberNumber).toBe('1004');
      expect(totals[1].periodosAdeudados).toBe(3);
      expect(totals[1].capital).toBe(54000);
      expect(totals[1].totalDeuda).toBe(56000);
      expect(duplicates).toHaveLength(0);
    });
  });

  describe('periodDebtToDbRow', () => {
    it('transforms to DB row', () => {
      const record = {
        memberNumber: '1004',
        periodKey: '2025-02',
        periodLabel: 'Febrero del 2025',
        nombre: 'Cristina',
        apellido: 'Mugas',
        dni: '17078085',
        cuotaSocial: 'SOCIO INDIVIDUAL',
        categoriaDivision: '–',
        capital: 9000,
        recargos: 0,
        intereses: 0,
        deudaAcumulada: 9000,
        asOfDate: '2026-10-20',
      };

      const dbRow = periodDebtToDbRow(record);

      expect(dbRow.member_number).toBe('1004');
      expect(dbRow.period_key).toBe('2025-02');
      expect(dbRow.capital).toBe(9000);
      expect(dbRow.as_of_date).toBe('2026-10-20');
    });
  });

  describe('computeGrandTotals', () => {
    it('sums all values', () => {
      const totals = [
        { capital: 54000, recargos: 2000, intereses: 100, saldoSinImputar: 500, totalDeuda: 56600 },
        { capital: 30000, recargos: 1500, intereses: 0, saldoSinImputar: 0, totalDeuda: 31500 },
        { capital: 0, recargos: 0, intereses: 0, saldoSinImputar: 0, totalDeuda: 0 },
      ];

      const grand = computeGrandTotals(totals);

      expect(grand.capital).toBe(84000);
      expect(grand.recargos).toBe(3500);
      expect(grand.intereses).toBe(100);
      expect(grand.totalDeuda).toBe(88100);
      expect(grand.sociosWithDebt).toBe(2);
      expect(grand.sociosTotal).toBe(3);
    });
  });

  describe('findDuplicateSocios', () => {
    it('detects different people with same nro', () => {
      const totals = [
        { memberNumber: '11150', nombre: 'Juan', apellido: 'Perez', dni: '12345678', totalDeuda: 1000 },
        { memberNumber: '11150', nombre: 'Maria', apellido: 'Garcia', dni: '87654321', totalDeuda: 2000 },
      ];

      const dups = findDuplicateSocios(totals);

      expect(dups).toHaveLength(1);
      expect(dups[0].memberNumber).toBe('11150');
      expect(dups[0].entries).toHaveLength(2);
    });

    it('ignores same person with same nro', () => {
      const totals = [
        { memberNumber: '1004', nombre: 'Cristina', apellido: 'Mugas', dni: '17078085', totalDeuda: 56000 },
      ];

      const dups = findDuplicateSocios(totals);
      expect(dups).toHaveLength(0);
    });
  });
});
