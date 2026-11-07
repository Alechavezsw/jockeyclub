import { describe, expect, it } from 'vitest';
import {
  accountLabel,
  paymentCorrespondsTo,
  paymentPeriodLabel,
  receiptCategoryLabel,
  receiptMethodLabel,
} from './exportPaymentReceiptPdf';

describe('exportPaymentReceiptPdf helpers', () => {
  it('muestra la categoría del socio (grupo / socio familiar)', () => {
    expect(receiptCategoryLabel({ tier: 'socio_familiar' })).toMatch(/FAMILIAR/i);
    expect(receiptCategoryLabel({ cuotaCategories: ['GRUPO FAMILIAR (Familiar)'] }))
      .toBe('GRUPO FAMILIAR (FAMILIAR)');
  });

  it('arma a qué corresponde el cobro sin mezclar el medio', () => {
    expect(paymentCorrespondsTo({
      concept: 'Cuota social · Transferencia',
      period: 'Octubre 2026',
    })).toBe('Cuota social · Octubre 2026');

    expect(paymentCorrespondsTo({
      imputations: [
        { dueOn: '2026-10-10', capital: 70000, surcharge: 0 },
      ],
    })).toMatch(/Cuota social Octubre( de)? 2026/i);
  });

  it('usa el período guardado o los vencimientos imputados', () => {
    expect(paymentPeriodLabel({ period: 'Octubre 2026' })).toBe('Octubre 2026');
    expect(paymentPeriodLabel({ periodDueOns: ['2026-11-10'] })).toMatch(/Noviembre( de)? 2026/i);
  });

  it('muestra Transferencia bancaria sin el nombre del banco', () => {
    expect(receiptMethodLabel({
      method: 'transferencia',
      methodLabel: 'Transferencia Banco Nación',
      bankName: 'Banco Nación',
    })).toBe('Transferencia bancaria');
  });

  it('no pone Banco Nación como cuenta; usa el alias', () => {
    expect(accountLabel({
      method: 'transferencia',
      bankId: 'nacion',
      bankName: 'Banco Nación',
    })).toBe('Alias Jockey.club.sj');
    expect(accountLabel({
      method: 'transferencia',
      bankName: 'Banco Nación',
    })).not.toMatch(/nación/i);
  });
});
