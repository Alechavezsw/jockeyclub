import { describe, expect, it } from 'vitest';
import { DEFAULT_CHART_OF_ACCOUNTS } from './chartOfAccounts';
import { sumCredits, sumDebits } from './journal';
import {
  createOtherIncome,
  journalForOtherIncome,
  lineTotal,
  linesTotal,
  validateOtherIncomeAttachment,
} from './otherIncomes';

describe('otherIncomes', () => {
  it('calcula total de líneas', () => {
    expect(lineTotal({ quantity: 2, unitPrice: 150 })).toBe(300);
    expect(linesTotal([
      { quantity: 2, unitPrice: 100 },
      { quantity: 1, unitPrice: 50.5 },
    ])).toBe(250.5);
  });

  it('usa el total de líneas cuando hay desglose', () => {
    const income = createOtherIncome({
      payerName: 'Juan Pérez',
      concept: 'Alquiler salón',
      amount: 1,
      lines: [{ description: 'Hora', quantity: 3, unitPrice: 1000 }],
    });
    expect(income.amount).toBe(3000);
  });

  it('valida adjuntos PDF/JPG/PNG ≤ 5MB', () => {
    expect(() => validateOtherIncomeAttachment({
      name: 'a.pdf',
      type: 'application/pdf',
      size: 1000,
    })).not.toThrow();
    expect(() => validateOtherIncomeAttachment({
      name: 'a.exe',
      type: 'application/octet-stream',
      size: 100,
    })).toThrow(/PDF/);
  });

  it('exige nombre y concepto', () => {
    expect(() => createOtherIncome({ concept: 'X', amount: 10 })).toThrow(/nombre/);
    expect(() => createOtherIncome({ payerName: 'A', amount: 10 })).toThrow(/concepto/);
  });

  it('asienta contra caja o banco según el medio', () => {
    const income = createOtherIncome({
      date: '2026-10-15',
      payerName: 'Quinta',
      concept: 'Salón',
      group: 'eventos',
      paymentMethod: 'transferencia',
      amount: 500,
    });
    const entry = journalForOtherIncome(income, DEFAULT_CHART_OF_ACCOUNTS);
    expect(entry.sourceModule).toBe('otros_ingresos');
    expect(sumDebits(entry.lines)).toBeCloseTo(sumCredits(entry.lines), 2);
    expect(entry.lines.some((line) => line.accountId === 'coa-1.1.03' && line.debit === 500)).toBe(true);
  });

  it('la rendición de portería entra a caja como otro ingreso, no como cuota', () => {
    const income = createOtherIncome({
      date: '2026-10-22',
      payerName: 'Portería',
      concept: 'Rendición portería',
      group: 'porteria',
      paymentMethod: 'efectivo',
      amount: 45000,
    });
    expect(income.group).toBe('porteria');
    const entry = journalForOtherIncome(income, DEFAULT_CHART_OF_ACCOUNTS);
    expect(entry.description).toMatch(/Rendición portería/i);
    expect(entry.lines.some((line) => line.accountId === 'coa-1.1.01' && line.debit === 45000)).toBe(true);
  });
});
