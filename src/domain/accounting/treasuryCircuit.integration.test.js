/**
 * Circuito integrado real: otro ingreso → gasto → comprobantes → liquidar IVA → pagar.
 * Reproduce el cableado del store (sin React): si esto falla, Contabilidad no cierra caja.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CHART_OF_ACCOUNTS } from './chartOfAccounts';
import { approveExpense, createExpenseDraft, payExpense } from './expenses';
import {
  createComprobante,
  DEFAULT_FISCAL_PROFILE,
  journalForComprobante,
  journalForLiquidacion,
  journalForTaxPayment,
  liquidatePeriod,
  buildLiveImpuestos,
} from './impuestos';
import { buildLiveCashLedger } from './liveCashLedger';
import { createOtherIncome, journalForOtherIncome } from './otherIncomes';
import { sumDebits, sumCredits } from './journal';

const TODAY = new Date('2026-10-21T15:00:00-03:00');
const CUTOFF = '2026-10-13';
const RI = { ...DEFAULT_FISCAL_PROFILE, condition: 'responsable_inscripto', iibbPercent: 3 };

const SNAPSHOT = {
  asOf: CUTOFF,
  periodFrom: '2026-01-01',
  periodTo: CUTOFF,
  cards: {
    efectivo: { periodInflow: 0, balance: null },
    bancos: { periodInflow: 0 },
    cheques: { balance: 0 },
    total: { balance: 1000 },
  },
};
const BANKS = [{ id: 'bsj', balance: 400, isActive: true }];
// Al corte: total 1000 − bancos 400 = efectivo 600.

describe('circuito tesorería + impuestos (integrado)', () => {
  it('ingreso, gasto, comprobantes y pago de IVA mueven caja y liquidan el período', () => {
    const journalEntries = [];
    const otherIncomes = [];
    const expenses = [];
    const vouchers = [];
    const liquidaciones = [];

    // 1) Otro ingreso en efectivo (salón)
    const income = createOtherIncome({
      date: '2026-10-15',
      payerName: 'Quinta López',
      concept: 'Alquiler salón',
      group: 'eventos',
      paymentMethod: 'efectivo',
      amount: 10000,
    });
    const incomeEntry = journalForOtherIncome(income, DEFAULT_CHART_OF_ACCOUNTS);
    expect(sumDebits(incomeEntry.lines)).toBeCloseTo(sumCredits(incomeEntry.lines), 2);
    expect(incomeEntry.sourceModule).toBe('otros_ingresos');
    journalEntries.push(incomeEntry);
    otherIncomes.push({ ...income, journalEntryId: incomeEntry.id });

    // 2) Gasto aprobado y pagado (caja)
    let expense = createExpenseDraft({
      expenseDate: '2026-10-16',
      vendorName: 'Corralón',
      categoryAccountId: 'coa-5.1.04',
      paymentAccountId: 'coa-1.1.01',
      amount: 2500,
      concept: 'Insumos limpieza',
    });
    expense = approveExpense(expense);
    const paid = payExpense(expense, DEFAULT_CHART_OF_ACCOUNTS);
    expenses.push(paid.expense);
    journalEntries.push(paid.journalEntry);
    expect(paid.journalEntry.sourceModule).toBe('gastos');

    // 3) Comprobante de venta A (evento facturado) + asiento — débito IVA > crédito
    const venta = createComprobante({
      book: 'venta',
      letter: 'A',
      date: '2026-10-17',
      counterpartyName: 'Empresa X',
      paymentTerm: 'contado',
      paymentAccountId: 'coa-1.1.01',
      lines: [{ quantity: 1, unitPrice: 10000, aliquotId: 'iva-21' }],
    }, RI);
    const ventaEntry = journalForComprobante(venta, DEFAULT_CHART_OF_ACCOUNTS, RI);
    journalEntries.push(ventaEntry);
    vouchers.push({ ...venta, journalEntryId: ventaEntry.id });

    // 4) Comprobante de compra A (crédito fiscal menor)
    const compra = createComprobante({
      book: 'compra',
      letter: 'A',
      date: '2026-10-18',
      counterpartyName: 'Proveedor Y',
      paymentTerm: 'contado',
      paymentAccountId: 'coa-1.1.01',
      lines: [{ quantity: 1, unitPrice: 1000, aliquotId: 'iva-21' }],
    }, RI);
    const compraEntry = journalForComprobante(compra, DEFAULT_CHART_OF_ACCOUNTS, RI);
    journalEntries.push(compraEntry);
    vouchers.push({ ...compra, journalEntryId: compraEntry.id });

    // 5) Liquidar IVA del mes (oficial + actividad viva)
    const liveTax = buildLiveImpuestos({
      period: '2026-10',
      today: TODAY,
      profile: RI,
      vouchers,
      expenses,
      otherIncomes,
      journalEntries,
      chartOfAccounts: DEFAULT_CHART_OF_ACCOUNTS,
    });
    expect(liveTax.ingresosCount).toBeGreaterThanOrEqual(1);
    expect(liveTax.board.iva.debito).toBeCloseTo(venta.totals.iva, 2);
    expect(liveTax.board.iva.credito).toBeCloseTo(compra.totals.iva, 2);

    const iva = liquidatePeriod({
      period: '2026-10',
      kind: 'iva',
      vouchers,
      profile: RI,
    });
    expect(iva.aPagar).toBeCloseTo(venta.totals.iva - compra.totals.iva, 2);

    const closeEntry = journalForLiquidacion(iva, DEFAULT_CHART_OF_ACCOUNTS);
    journalEntries.push(closeEntry);
    const closed = { ...iva, status: 'closed', journalEntryId: closeEntry.id };
    liquidaciones.push(closed);

    const payEntry = journalForTaxPayment(closed, DEFAULT_CHART_OF_ACCOUNTS, 'coa-1.1.01');
    journalEntries.push(payEntry);
    liquidaciones[0] = { ...closed, status: 'paid', paymentJournalEntryId: payEntry.id };

    // 6) Caja viva: corte + movimientos de app vía asientos
    const cash = buildLiveCashLedger({
      snapshot: SNAPSHOT,
      bankAccounts: BANKS,
      journalEntries,
      otherIncomes,
      chartOfAccounts: DEFAULT_CHART_OF_ACCOUNTS,
      today: TODAY,
    });

    // Efectivo base 600
    // +10000 otro ingreso
    // -2500 gasto
    // +venta.total (débito caja)
    // -compra.total (crédito caja)
    // -iva.aPagar (pago liquidación)
    const expectedEfectivo = Math.round((
      600
      + 10000
      - 2500
      + venta.totals.total
      - compra.totals.total
      - iva.aPagar
    ) * 100) / 100;

    expect(cash.cutoff).toBe(CUTOFF);
    expect(cash.efectivo).toBeCloseTo(expectedEfectivo, 2);
    expect(cash.cobranzas.some((row) => row.concept === 'Alquiler salón')).toBe(true);
    expect(liquidaciones[0].status).toBe('paid');
    expect(journalEntries.every((entry) => (
      Math.abs(sumDebits(entry.lines) - sumCredits(entry.lines)) < 0.01
    ))).toBe(true);
  });
});
