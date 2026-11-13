import { describe, expect, it } from 'vitest';
import { DEFAULT_CHART_OF_ACCOUNTS } from './chartOfAccounts';
import { sumCredits, sumDebits } from './journal';
import {
  createOtherIncome,
  journalForOtherIncome,
  lineTotal,
  linesTotal,
  porterIncomeBooks,
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

  it('la rendición nombra a quien rinde', () => {
    const income = createOtherIncome({
      date: '2026-11-10',
      payerName: 'Ana López',
      renderedBy: 'Ana López',
      concept: 'Rendición portería',
      group: 'porteria',
      paymentMethod: 'efectivo',
      amount: 12000,
    });
    expect(income.renderedBy).toBe('Ana López');
    const entry = journalForOtherIncome(income, DEFAULT_CHART_OF_ACCOUNTS);
    expect(entry.description).toBe('Rendición portería — rindió Ana López');
  });

  it('la rendición lleva talonario y descripción', () => {
    const income = createOtherIncome({
      date: '2026-11-10',
      payerName: 'Ana López',
      renderedBy: 'Ana López',
      concept: 'Rendición portería',
      group: 'porteria',
      paymentMethod: 'efectivo',
      amount: 12000,
      bookNumber: '145',
      notes: 'Visitas del sábado',
    });
    expect(income.bookNumber).toBe('145');
    const entry = journalForOtherIncome(income, DEFAULT_CHART_OF_ACCOUNTS);
    expect(entry.description).toBe('Rendición portería — rindió Ana López · talonario 145 · Visitas del sábado');
  });

  it('en el plan de la nube el debe cae en Caja General', () => {
    const chart = [
      { id: 'aaaaaaaa-0001-0001-0001-000000000111', code: '1.1.01', name: 'Caja General', isPostable: true, accountType: 'asset' },
      { id: 'aaaaaaaa-0004-0004-0004-000000000113', code: '4.1.03', name: 'Eventos y Fiestas', isPostable: true, accountType: 'income' },
    ];
    const income = createOtherIncome({
      date: '2026-11-10',
      payerName: 'Ana López',
      renderedBy: 'Ana López',
      concept: 'Rendición portería',
      group: 'porteria',
      paymentMethod: 'efectivo',
      amount: 12000,
      bookNumber: '145',
      notes: 'Visitas del sábado',
    });
    const entry = journalForOtherIncome(income, chart);
    expect(entry.lines.find((line) => line.debit > 0)?.accountId)
      .toBe('aaaaaaaa-0001-0001-0001-000000000111');
    expect(entry.lines.find((line) => line.credit > 0)?.accountId)
      .toBe('aaaaaaaa-0004-0004-0004-000000000113');
  });

  it('acumula lo que rinde cada portero, hoy y el total', () => {
    const porters = [{ id: 'p1', fullName: 'Ana López' }];
    const books = porterIncomeBooks([
      { group: 'porteria', renderedById: 'p1', renderedBy: 'Ana López', date: '2026-11-10', amount: 10000, status: 'posted' },
      { group: 'porteria', renderedBy: 'Ana López', date: '2026-11-09', amount: 5000, status: 'posted' },
      { group: 'porteria', renderedById: 'p1', date: '2026-11-10', amount: 2000, status: 'void' },
    ], porters, '2026-11-10');
    expect(books).toEqual([
      { id: 'p1', name: 'Ana López', today: 10000, total: 15000, count: 2 },
    ]);
  });
});
