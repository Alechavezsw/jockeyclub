import { describe, it, expect } from 'vitest';
import {
  findSaldosHeaderRow,
  extractAsOfDate,
  parseSaldosRow,
  aoaToSaldosBalances,
  summarizeSaldos,
  balanceToDbRow,
} from './lilaSaldosImport.js';

describe('lilaSaldosImport', () => {
  describe('findSaldosHeaderRow', () => {
    it('finds header row with # and NRO DE SOCIO', () => {
      const aoa = [
        ['Generado el', '20 de Octubre del 2026'],
        ['Saldo al', '20 de Octubre del 2026'],
        ['#', 'NRO DE SOCIO', 'NOMBRE', 'APELLIDO'],
        [1, 100, 'Juan', 'Pérez'],
      ];
      expect(findSaldosHeaderRow(aoa)).toBe(2);
    });

    it('returns -1 if no header found', () => {
      const aoa = [['foo', 'bar'], ['baz', 'qux']];
      expect(findSaldosHeaderRow(aoa)).toBe(-1);
    });
  });

  describe('extractAsOfDate', () => {
    it('extracts date from Spanish format', () => {
      const aoa = [
        ['Generado el', '20 de Octubre del 2026'],
        ['Saldo al 20 de Octubre del 2026'],
      ];
      expect(extractAsOfDate(aoa)).toBe('2026-10-20');
    });

    it('extracts ISO date', () => {
      const aoa = [['Saldo al 2026-10-20']];
      expect(extractAsOfDate(aoa)).toBe('2026-10-20');
    });
  });

  describe('parseSaldosRow', () => {
    it('parses a valid row', () => {
      const row = [89984, 1, 'Jonas', 'Castañeda', 50573357, 'GRUPO FAMILIAR', '–', 54000, 2000, 0, -100, 55900];
      const balance = parseSaldosRow(row, '2026-10-20');
      expect(balance).toEqual({
        memberNumber: '1',
        lilaRowId: '89984',
        nombre: 'Jonas',
        apellido: 'Castañeda',
        dni: '50573357',
        cuotaSocial: 'GRUPO FAMILIAR',
        cuotaDeportiva: '–',
        capital: 54000,
        recargos: 2000,
        intereses: 0,
        noImputado: -100,
        saldoResultante: 55900,
        asOfDate: '2026-10-20',
      });
    });

    it('returns null for non-numeric member number', () => {
      const row = [1, 'ABC', 'Juan', 'Test'];
      expect(parseSaldosRow(row, '2026-10-20')).toBeNull();
    });
  });

  describe('aoaToSaldosBalances', () => {
    it('parses full AOA with header detection', () => {
      const aoa = [
        ['Generado el', '20 de Octubre del 2026'],
        ['Saldo al 20 de Octubre del 2026'],
        ['#', 'NRO DE SOCIO', 'NOMBRE', 'APELLIDO', 'DNI', 'CUOTA SOCIAL', 'CUOTA DEP', 'CAPITAL', 'RECARGOS', 'INTERESES', 'NO IMPUTADO', 'SALDO'],
        [1, 100, 'Juan', 'Pérez', 12345678, 'SOCIO', '–', 10000, 500, 0, 0, 10500],
        [2, 200, 'María', 'García', 87654321, 'SOCIO', '–', 0, 0, 0, 0, 0],
      ];
      const result = aoaToSaldosBalances(aoa);
      expect(result.error).toBeNull();
      expect(result.balances).toHaveLength(2);
      expect(result.asOfDate).toBe('2026-10-20');
      expect(result.totals.capital).toBe(10000);
      expect(result.totals.saldo).toBe(10500);
    });

    it('handles duplicate nro_socio', () => {
      const aoa = [
        ['#', 'NRO DE SOCIO', 'NOMBRE', 'APELLIDO', 'DNI', 'CUOTA', 'DEP', 'CAPITAL', 'REC', 'INT', 'NO IMP', 'SALDO'],
        [1, 100, 'Juan', 'Pérez', 11111111, 'S', '–', 10000, 0, 0, 0, 10000],
        [2, 100, 'Pedro', 'López', 22222222, 'S', '–', 5000, 0, 0, 0, 5000],
      ];
      const result = aoaToSaldosBalances(aoa);
      expect(result.duplicates).toHaveLength(1);
      expect(result.duplicates[0].memberNumber).toBe('100');
      expect(result.balances).toHaveLength(1);
      expect(result.balances[0].saldoResultante).toBe(5000);
    });
  });

  describe('summarizeSaldos', () => {
    it('summarizes balances correctly', () => {
      const result = {
        balances: [
          { memberNumber: '1', saldoResultante: 10000, nombre: 'A', apellido: 'B', capital: 9000, recargos: 1000 },
          { memberNumber: '2', saldoResultante: 0, nombre: 'C', apellido: 'D', capital: 0, recargos: 0 },
          { memberNumber: '3', saldoResultante: -500, nombre: 'E', apellido: 'F', capital: 0, recargos: 0 },
        ],
        duplicates: [],
        totals: { capital: 9000, recargos: 1000, intereses: 0, noImputado: 0, saldo: 9500 },
        asOfDate: '2026-10-20',
      };
      const summary = summarizeSaldos(result);
      expect(summary.totalRows).toBe(3);
      expect(summary.withBalance).toBe(1);
      expect(summary.withZero).toBe(1);
      expect(summary.withNegative).toBe(1);
    });
  });

  describe('balanceToDbRow', () => {
    it('converts balance to DB row format', () => {
      const balance = {
        memberNumber: '123',
        lilaRowId: '456',
        nombre: 'Test',
        apellido: 'User',
        dni: '12345678',
        cuotaSocial: 'SOCIO',
        cuotaDeportiva: '–',
        capital: 10000,
        recargos: 500,
        intereses: 100,
        noImputado: -200,
        saldoResultante: 10400,
        asOfDate: '2026-10-20',
      };
      const row = balanceToDbRow(balance);
      expect(row.member_number).toBe('123');
      expect(row.capital_no_pagado).toBe(10000);
      expect(row.saldo_resultante).toBe(10400);
      expect(row.as_of_date).toBe('2026-10-20');
    });
  });
});
