import { describe, expect, it } from 'vitest';
import { DEFAULT_CHART_OF_ACCOUNTS } from './chartOfAccounts';
import { sumCredits, sumDebits } from './journal';
import {
  createOtherIncome,
  journalForOtherIncome,
  totalAmountHintFromNotes,
  lineTotal,
  linesTotal,
  porterIncomeBooks,
  porterIncomeBooksByDate,
  PORTERIA_TABLE_PAGE_SIZE,
  validateOtherIncomeAttachment,
} from './otherIncomes';

describe('otherIncomes', () => {
  it('lee el total declarado en la nota de rendición', () => {
    expect(totalAmountHintFromNotes(
      '… $ 104.000 EFECTIVO- total entre efectivo y QR $ 150.000',
    )).toBe(150000);
    expect(totalAmountHintFromNotes('sin total')).toBeNull();
  });

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

  it('portería por Mercado Pago va a la cuenta MP, no a caja', () => {
    const income = createOtherIncome({
      date: '2026-11-13',
      payerName: 'Ana López',
      renderedBy: 'Ana López',
      concept: 'Rendición portería',
      group: 'porteria',
      paymentMethod: 'mercadopago',
      amount: 18000,
      bookNumber: '200',
    });
    expect(income.paymentMethod).toBe('mercadopago');
    const entry = journalForOtherIncome(income, DEFAULT_CHART_OF_ACCOUNTS);
    expect(entry.lines.some((line) => line.accountId === 'coa-1.1.08' && line.debit === 18000)).toBe(true);
    expect(entry.lines.some((line) => line.accountId === 'coa-1.1.01' && line.debit > 0)).toBe(false);
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

  it('no duplica el talonario si ya está en la nota', () => {
    const income = createOtherIncome({
      date: '2026-11-13',
      payerName: 'Adrian Pablo Suarez',
      renderedBy: 'Adrian Pablo Suarez',
      concept: 'Rendición estacionamiento',
      group: 'porteria',
      paymentMethod: 'efectivo',
      amount: 150000,
      bookNumber: '928',
      notes: 'talonario 928 - se vendio 19 tiket x2000',
    });
    const entry = journalForOtherIncome(income, DEFAULT_CHART_OF_ACCOUNTS);
    expect(entry.description).toBe(
      'Rendición estacionamiento — rindió Adrian Pablo Suarez · talonario 928 - se vendio 19 tiket x2000',
    );
    expect(entry.description.match(/talonario 928/gi)).toHaveLength(1);
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

  it('agrupa el acumulado por fecha, más nueva primero', () => {
    const porters = [
      { id: 'p1', fullName: 'Ana López' },
      { id: 'p2', fullName: 'Jorge Galdeano' },
    ];
    const days = porterIncomeBooksByDate([
      { group: 'porteria', renderedById: 'p1', renderedBy: 'Ana López', date: '2026-11-10', amount: 10000, status: 'posted' },
      { group: 'porteria', renderedById: 'p2', renderedBy: 'Jorge Galdeano', date: '2026-11-16', amount: 40000, status: 'posted' },
      { group: 'porteria', renderedById: 'p1', renderedBy: 'Ana López', date: '2026-11-16', amount: 5000, status: 'posted' },
      { group: 'porteria', renderedById: 'p1', date: '2026-11-16', amount: 1000, status: 'void' },
    ], porters);
    expect(PORTERIA_TABLE_PAGE_SIZE).toBe(20);
    expect(days.map((row) => row.date)).toEqual(['2026-11-16', '2026-11-10']);
    expect(days[0]).toMatchObject({ date: '2026-11-16', total: 45000, count: 2 });
    expect(days[0].books).toEqual([
      { id: 'p1', name: 'Ana López', total: 5000, count: 1 },
      { id: 'p2', name: 'Jorge Galdeano', total: 40000, count: 1 },
    ]);
  });
});
