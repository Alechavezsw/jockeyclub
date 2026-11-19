import { describe, expect, it } from 'vitest';
import {
  accountLabel,
  isTennisAbonoPayment,
  paymentCorrespondsTo,
  paymentPeriodLabel,
  receiptCategoryLabel,
  receiptChargeLines,
  receiptCreditLeftover,
  receiptDiscountLine,
  receiptDuesKindLabel,
  receiptMethodLabel,
  receiptPaymentSplits,
} from './exportPaymentReceiptPdf';

describe('exportPaymentReceiptPdf helpers', () => {
  it('muestra la categoría del socio (grupo / socio familiar)', () => {
    expect(receiptCategoryLabel({ tier: 'socio_familiar' })).toMatch(/FAMILIAR/i);
    expect(receiptCategoryLabel({ cuotaCategories: ['GRUPO FAMILIAR (Familiar)'] }))
      .toBe('GRUPO FAMILIAR (FAMILIAR)');
  });

  it('el abono tenis no se etiqueta como cuota social', () => {
    expect(paymentCorrespondsTo({
      chargeScope: 'abono_tenis',
      concept: 'Abono tenis · Efectivo',
      periodDueOns: ['2026-11-10'],
      amount: 12000,
      imputations: [{ dueOn: '2026-11-10', capital: 12000, surcharge: 0 }],
    })).toBe('Pago de abono tenis Noviembre 2026');

    expect(receiptChargeLines({
      chargeScope: 'abono_tenis',
      concept: 'Abono tenis · Noviembre de 2026',
      amount: 12000,
      periodDueOns: ['2026-11-10'],
      imputations: [{ dueOn: '2026-11-10', capital: 12000, surcharge: 0 }],
    })).toEqual([{
      dueOn: '2026-11-10',
      detail: 'Pago de abono tenis Noviembre 2026',
      payable: 12000,
    }]);
  });

  it('arma a qué corresponde el cobro sin mezclar el medio', () => {
    expect(paymentCorrespondsTo({
      concept: 'Cuota social · Transferencia',
      period: 'Octubre 2026',
    })).toBe('Pago de cuota social Octubre 2026');

    expect(paymentCorrespondsTo({
      imputations: [
        { dueOn: '2026-10-10', capital: 70000, surcharge: 0 },
      ],
    })).toMatch(/Pago de cuota social Octubre( de)? 2026/i);

    expect(paymentCorrespondsTo({
      amount: 70000,
      periodDueOns: ['2026-11-10'],
      imputations: [
        { dueOn: '2026-11-10', capital: 59000, surcharge: 0 },
        { dueOn: '2026-12-10', capital: 11000, surcharge: 0, kind: 'adelanto' },
      ],
    })).toBe('Pago de cuota social Noviembre 2026');

    expect(receiptChargeLines({
      amount: 70000,
      periodDueOns: ['2026-11-10'],
      imputations: [
        { dueOn: '2026-11-10', capital: 59000, surcharge: 0 },
        { dueOn: '2026-12-10', capital: 11000, surcharge: 0, kind: 'adelanto' },
      ],
    })).toEqual([{
      dueOn: '2026-11-10',
      detail: 'Pago de cuota social Noviembre 2026',
      payable: 70000,
    }]);

    const sepOct = {
      amount: 154000,
      periodDueOns: ['2026-09-10', '2026-10-10'],
      imputations: [
        { dueOn: '2026-11-10', capital: 60000, surcharge: 6000 },
        { dueOn: '2026-12-10', capital: 88000, surcharge: 0, kind: 'adelanto' },
      ],
    };
    expect(paymentCorrespondsTo(sepOct)).toMatch(/Septiembre de 2026/);
    expect(paymentCorrespondsTo(sepOct)).toMatch(/Octubre de 2026/);
    expect(paymentCorrespondsTo(sepOct)).not.toMatch(/[Dd]iciembre/);
    expect(receiptChargeLines({
      amount: 154000,
      periodDueOns: ['2026-09-10', '2026-10-10'],
      imputations: [
        { dueOn: '2026-09-10', capital: 70000, surcharge: 7000 },
        { dueOn: '2026-10-10', capital: 70000, surcharge: 7000 },
        { dueOn: '2026-12-10', capital: 1, surcharge: 0, kind: 'adelanto' },
      ],
    }).map((row) => row.dueOn)).toEqual(['2026-09-10', '2026-10-10']);
  });

  it('el recibo de varios meses dice solo capital, intereses y el mes sin intereses', () => {
    const payment = {
      imputations: [
        { dueOn: '1900-01-10', capital: 3600, surcharge: 0 },
        { dueOn: '2026-09-10', capital: 40000, surcharge: 4000 },
        { dueOn: '2026-10-10', capital: 40000, surcharge: 4000 },
        { dueOn: '2026-11-10', capital: 40000, surcharge: 0 },
      ],
    };
    const lines = receiptChargeLines(payment);
    expect(lines.map((row) => row.payable)).toEqual([44000, 44000, 40000]);
    expect(paymentCorrespondsTo(payment)).toMatch(/Septiembre de 2026 · capital .+ · intereses .+/);
    expect(paymentCorrespondsTo(payment)).toMatch(/Octubre de 2026 · capital .+ · intereses .+/);
    expect(paymentCorrespondsTo(payment)).toMatch(/Noviembre de 2026 · sin intereses/);
    expect(paymentCorrespondsTo(payment)).not.toMatch(/agosto|saldo anterior/i);
  });

  it('el descuento va aparte, con el detalle, y no reescribe el mes', () => {
    const payment = {
      imputations: [{ dueOn: '2026-11-10', capital: 36000, surcharge: 3600 }],
      discount: 1000,
      discountDetail: 'Convenio de caja',
    };
    expect(receiptChargeLines(payment)[0].payable).toBe(39600);
    expect(receiptChargeLines(payment)[0].detail).toMatch(/Noviembre de 2026 · capital/);
    expect(receiptChargeLines({
      amount: 38600,
      discount: 1000,
      periodDueOns: ['2026-11-10'],
    })[0].payable).toBe(39600);
    expect(receiptDiscountLine(payment)).toEqual({
      detail: 'Descuento · Convenio de caja',
      amount: 1000,
    });
    expect(paymentCorrespondsTo(payment)).not.toMatch(/descuento/i);
  });

  it('usa el período guardado o los vencimientos imputados', () => {
    expect(paymentPeriodLabel({ period: 'Octubre 2026' })).toBe('Octubre 2026');
    expect(paymentPeriodLabel({ periodDueOns: ['2026-11-10'] })).toMatch(/Noviembre( de)? 2026/i);
  });

  it('pago mixto no se etiqueta como sola transferencia y detalla tramos', () => {
    const payment = {
      method: 'mixto',
      methodLabel: 'Pago mixto (Transferencia Mercado Pago + Pago POS · POSNET EN 3 CUOTAS)',
      amount: 693000,
      quota: 620000,
      surcharge: 62000,
      paymentSplits: [
        {
          method: 'transferencia',
          label: 'Transferencia Mercado Pago',
          amount: 300000,
          bankId: 'mercadopago',
          journalAccount: 'Mercado Pago',
          receiptName: 'plan de pago.jpeg',
        },
        {
          method: 'tarjeta',
          label: 'Tarjeta DATA · 3 cuotas',
          amount: 393000,
          paymentPlanLabel: 'DATA 3 cuotas',
          journalAccount: 'Tarjetas a cobrar',
          voucherAmount: 432383.78,
        },
      ],
    };
    expect(receiptMethodLabel(payment)).toBe('Pago mixto');
    expect(receiptPaymentSplits(payment).map((row) => row.amount)).toEqual([300000, 393000]);
    expect(receiptPaymentSplits(payment)[0].reference).toBe('');
    expect(receiptPaymentSplits(payment)[1].reference).toBe('DATA 3 cuotas');
    expect(receiptPaymentSplits(payment)[1].voucherAmount).toBe(432383.78);
    expect(accountLabel(payment)).toBe('Mercado Pago + Tarjetas a cobrar');
    expect(receiptCreditLeftover(payment)).toBe(11000);
    expect(receiptCreditLeftover({ ...payment, creditLeftover: 0 })).toBe(0);
  });

  it('muestra Transferencia bancaria sin el nombre del banco', () => {
    expect(receiptMethodLabel({
      method: 'transferencia',
      methodLabel: 'Transferencia Banco Macro',
      bankName: 'Banco Macro',
    })).toBe('Transferencia bancaria');
  });

  it('a cuenta figura como medio y nombra el pago a cuenta', () => {
    expect(receiptMethodLabel({ method: 'a_cuenta' })).toBe('A cuenta');
    expect(paymentCorrespondsTo({
      method: 'a_cuenta',
      periodDueOns: ['2026-09-10', '2026-10-10'],
      amount: 50000,
    })).toMatch(/^Pago a cuenta ·/);
  });

  it('no pone Banco Macro como cuenta; usa el alias', () => {
    expect(accountLabel({
      method: 'transferencia',
      bankId: 'macro',
      bankName: 'Banco Macro',
    })).toBe('Alias Jockey.club.sj');
    expect(accountLabel({
      method: 'transferencia',
      bankName: 'Banco Macro',
    })).not.toMatch(/nación/i);
  });

  it('abono tenis no se etiqueta como cuota social', () => {
    const tennis = {
      chargeScope: 'abono_tenis',
      concept: 'Abono tenis · Octubre de 2026',
      period: 'Octubre de 2026',
      periodDueOns: ['2026-10-10'],
      amount: 14000,
      quota: 14000,
    };
    expect(isTennisAbonoPayment(tennis)).toBe(true);
    expect(receiptDuesKindLabel(tennis)).toBe('Abono tenis');
    expect(paymentCorrespondsTo(tennis)).toMatch(/^Pago de abono tenis/);
    expect(paymentCorrespondsTo(tennis)).not.toMatch(/cuota social/i);
    expect(receiptChargeLines(tennis)[0].detail).toMatch(/^Pago de abono tenis/);
  });
});
