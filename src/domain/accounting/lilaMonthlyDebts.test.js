import { describe, it, expect } from 'vitest';
import {
  buildLilaMonthlyDebts,
  listLilaDebtPeriods,
  listLilaMonthlyDebtors,
} from './lilaMonthlyDebts';

describe('lilaMonthlyDebts', () => {
  describe('buildLilaMonthlyDebts', () => {
    it('builds snapshot from debt totals and period debts', () => {
      const debtTotals = [
        {
          memberNumber: '1004',
          nombre: 'Cristina',
          apellido: 'Mugas',
          dni: '17078085',
          cuotaSocial: 'SOCIO INDIVIDUAL',
          categoriaDivision: '–',
          periodosAdeudados: 3,
          capital: 54000,
          recargos: 2000,
          intereses: 0,
          saldoSinImputar: 0,
          totalDeuda: 56000,
          asOfDate: '2026-10-20',
        },
        {
          memberNumber: '1',
          nombre: 'Jonas',
          apellido: 'Castañeda',
          dni: '50573357',
          cuotaSocial: 'GRUPO FAMILIAR',
          categoriaDivision: '–',
          periodosAdeudados: 0,
          capital: 0,
          recargos: 0,
          intereses: 0,
          saldoSinImputar: 0,
          totalDeuda: 0,
          asOfDate: '2026-10-20',
        },
      ];

      const periodDebts = [
        {
          memberNumber: '1004',
          periodKey: '2025-02',
          periodLabel: 'Febrero del 2025',
          capital: 9000,
          recargos: 0,
          intereses: 0,
          deudaAcumulada: 9000,
        },
        {
          memberNumber: '1004',
          periodKey: '2025-03',
          periodLabel: 'Marzo del 2025',
          capital: 20000,
          recargos: 1000,
          intereses: 0,
          deudaAcumulada: 30000,
        },
        {
          memberNumber: '1004',
          periodKey: '2025-04',
          periodLabel: 'Abril del 2025',
          capital: 25000,
          recargos: 1000,
          intereses: 0,
          deudaAcumulada: 56000,
        },
      ];

      const result = buildLilaMonthlyDebts({ debtTotals, periodDebts, movements: [] });

      expect(result.asOf).toBe('2026-10-20');
      expect(result.memberCount).toBe(1);
      expect(result.totalDebt).toBe(56000);
      expect(result.monthRowCount).toBe(3);
      expect(result.source).toBe('lila');

      const member = result.byNumber['1004'];
      expect(member).toBeDefined();
      expect(member.memberName).toBe('Cristina Mugas');
      expect(member.capital).toBe(54000);
      expect(member.interest).toBe(2000);
      expect(member.months).toHaveLength(3);
      expect(member.standing).toBe('En mora');
    });

    it('excludes members with zero debt', () => {
      const debtTotals = [
        { memberNumber: '1', totalDeuda: 0, periodosAdeudados: 0, capital: 0, recargos: 0, intereses: 0, saldoSinImputar: 0 },
      ];

      const result = buildLilaMonthlyDebts({ debtTotals, periodDebts: [], movements: [] });
      expect(result.memberCount).toBe(0);
      expect(Object.keys(result.byNumber)).toHaveLength(0);
    });
  });

  describe('listLilaDebtPeriods', () => {
    it('extracts unique periods sorted by key', () => {
      const byNumber = {
        '1004': {
          months: [
            { periodKey: '2025-03', periodLabel: 'Marzo del 2025' },
            { periodKey: '2025-02', periodLabel: 'Febrero del 2025' },
          ],
        },
        '2000': {
          months: [
            { periodKey: '2025-02', periodLabel: 'Febrero del 2025' },
            { periodKey: '2025-04', periodLabel: 'Abril del 2025' },
          ],
        },
      };

      const periods = listLilaDebtPeriods(byNumber);

      expect(periods).toHaveLength(3);
      expect(periods[0].periodKey).toBe('2025-02');
      expect(periods[1].periodKey).toBe('2025-03');
      expect(periods[2].periodKey).toBe('2025-04');
    });
  });

  describe('listLilaMonthlyDebtors', () => {
    it('filters by query', () => {
      const byNumber = {
        '1004': { memberNumber: '1004', memberName: 'Cristina Mugas', dni: '17078085', totalDebt: 56000 },
        '2000': { memberNumber: '2000', memberName: 'Juan Perez', dni: '12345678', totalDebt: 30000 },
      };

      const filtered = listLilaMonthlyDebtors({ byNumber, query: 'cristina', periodKey: 'all' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].memberNumber).toBe('1004');
    });

    it('filters by period', () => {
      const byNumber = {
        '1004': { memberNumber: '1004', totalDebt: 56000, months: [{ periodKey: '2025-02' }] },
        '2000': { memberNumber: '2000', totalDebt: 30000, months: [{ periodKey: '2025-03' }] },
      };

      const filtered = listLilaMonthlyDebtors({ byNumber, query: '', periodKey: '2025-02' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].memberNumber).toBe('1004');
    });

    it('sorts by totalDebt descending', () => {
      const byNumber = {
        '1004': { memberNumber: '1004', totalDebt: 30000, months: [] },
        '2000': { memberNumber: '2000', totalDebt: 60000, months: [] },
      };

      const sorted = listLilaMonthlyDebtors({ byNumber, query: '', periodKey: 'all' });
      expect(sorted[0].memberNumber).toBe('2000');
      expect(sorted[1].memberNumber).toBe('1004');
    });
  });
});
