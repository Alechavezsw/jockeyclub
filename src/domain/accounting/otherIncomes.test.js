import { describe, expect, it } from 'vitest';
import {
  createOtherIncome,
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
});
