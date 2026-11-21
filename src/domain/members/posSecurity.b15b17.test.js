import { describe, expect, it } from 'vitest';
import {
  assertMixedPosMoraAllocation,
  normalizePaymentSplits,
  validatePaymentSplits,
} from './memberPayments';
import { journalAccountForPayment } from './clubBanks';
import { authorizePosCardFinancing, POS_CARD_RECEIVABLE_ACCOUNT } from './posFinancing';

const plan10 = {
  id: 'visa-10',
  label: 'Visa 10%',
  installments: 3,
  financingMode: 'club_keeps',
  financingPercent: 10,
  allowOperatorOverride: false,
};

describe('B15 cuentas contables autorizadas (cliente)', () => {
  it('POS siempre resuelve Tarjetas a cobrar', () => {
    expect(journalAccountForPayment('tarjeta')).toBe(POS_CARD_RECEIVABLE_ACCOUNT);
    expect(journalAccountForPayment('pos')).toBe(POS_CARD_RECEIVABLE_ACCOUNT);
  });

  it('rechaza journalAccount arbitrario (Caja General / Gastos / Cuotas) en tramo POS', () => {
    for (const bad of ['Caja General', 'Gastos', 'Cuotas Sociales', 'Ingresos varios']) {
      expect(() => normalizePaymentSplits([{
        method: 'tarjeta',
        amount: 70000,
        journalAccount: bad,
        paymentPlanId: 'visa-10',
        receiptName: 'POS-1',
        receiptPath: 'dues/x.pdf',
      }], { authorize: true, plans: [plan10] })).toThrow(/no está autorizada|autorizada/i);
    }
  });

  it('acepta la cuenta canónica del medio', () => {
    const splits = normalizePaymentSplits([{
      method: 'tarjeta',
      amount: 70000,
      journalAccount: POS_CARD_RECEIVABLE_ACCOUNT,
      paymentPlanId: 'visa-10',
      voucherAmount: 77000,
      receiptParse: { amount: 77000, reference: 'OK' },
      receiptName: 'POS-1',
      receiptPath: 'dues/x.pdf',
    }], { authorize: true, plans: [plan10] });
    expect(splits[0].journalAccount).toBe(POS_CARD_RECEIVABLE_ACCOUNT);
  });

  it('mixto: cada tramo usa cuenta de servidor (efectivo → Caja, POS → Tarjetas)', () => {
    const { splits } = validatePaymentSplits([
      {
        method: 'efectivo',
        amount: 20000,
        capitalAmount: 20000,
        surchargeAmount: 0,
      },
      {
        method: 'tarjeta',
        amount: 50000,
        capitalAmount: 50000,
        surchargeAmount: 0,
        paymentPlanId: 'visa-10',
        voucherAmount: 55000,
        receiptParse: { amount: 55000, reference: 'OK' },
        receiptName: 'POS-mix',
        receiptPath: 'dues/mix.pdf',
        journalAccount: POS_CARD_RECEIVABLE_ACCOUNT,
      },
    ], 70000, { plans: [plan10], capital: 70000, surcharge: 0 });
    expect(splits.find((s) => s.method === 'efectivo').journalAccount).toMatch(/Caja/i);
    expect(splits.find((s) => s.method === 'tarjeta').journalAccount).toBe(POS_CARD_RECEIVABLE_ACCOUNT);
  });
});

describe('B16 financiación en mixtos con mora', () => {
  it('bloquea mixto POS+mora sin capitalAmount/surchargeAmount por tramo', () => {
    expect(() => assertMixedPosMoraAllocation([
      { method: 'efectivo', amount: 20000 },
      { method: 'tarjeta', amount: 57000, paymentPlanId: 'visa-10' },
    ], { capital: 70000, surcharge: 7000 })).toThrow(/capitalAmount|surchargeAmount|mora/i);
  });

  it('rechaza tramo donde capital+mora ≠ importe', () => {
    expect(() => assertMixedPosMoraAllocation([
      { method: 'efectivo', amount: 20000, capitalAmount: 20000, surchargeAmount: 0 },
      { method: 'tarjeta', amount: 57000, capitalAmount: 50000, surchargeAmount: 5000 },
    ], { capital: 70000, surcharge: 7000 })).toThrow(/igualar el importe/i);
  });

  it('financia solo el capital del tramo POS (no los 57000 con mora)', () => {
    // Capital 70k + mora 7k. Efectivo 20k capital. POS 57k = 50k capital + 7k mora.
    const { splits } = validatePaymentSplits([
      {
        method: 'efectivo',
        amount: 20000,
        capitalAmount: 20000,
        surchargeAmount: 0,
      },
      {
        method: 'tarjeta',
        amount: 57000,
        capitalAmount: 50000,
        surchargeAmount: 7000,
        paymentPlanId: 'visa-10',
        // 10% sobre 50.000 capital = 5.000 → cupón 55.000
        voucherAmount: 55000,
        receiptParse: { amount: 55000, reference: 'MIX-MORA' },
        receiptName: 'POS-mora',
        receiptPath: 'dues/mora.pdf',
      },
    ], 77000, { plans: [plan10], capital: 70000, surcharge: 7000 });

    const pos = splits.find((s) => s.method === 'tarjeta');
    expect(pos.capitalAmount).toBe(50000);
    expect(pos.surchargeAmount).toBe(7000);
    expect(pos.cardFinancing.financingAmount).toBe(5000);
    expect(pos.cardFinancing.financingAmount).not.toBe(5700); // no 10% sobre 57k
    expect(pos.voucherAmount).toBe(55000);
  });

  it('si se financiara mal sobre 57k el cupón no cerraría con 10%', () => {
    expect(() => authorizePosCardFinancing({
      financingBase: 57000,
      surchargeAmount: 0,
      plans: [plan10],
      paymentPlanId: 'visa-10',
      receiptVoucher: 55000,
      receiptParse: { amount: 55000, reference: 'BAD' },
    })).toThrow(/cupón|comprobante|calculado/i);
  });
});

describe('B17 snapshot inmutable (dominio)', () => {
  it('normalize no pisa cardFinancing ya autorizado cuando authorize=false', () => {
    const locked = {
      planId: 'visa-10',
      financingAmount: 7000,
      mode: 'club_keeps',
      voucherTotal: 77000,
      appliedPercent: 10,
    };
    const [row] = normalizePaymentSplits([{
      method: 'tarjeta',
      amount: 70000,
      cardFinancing: locked,
      paymentPlanId: 'other-plan',
      financingPercent: 99,
    }], { authorize: false });
    expect(row.cardFinancing).toEqual(locked);
  });
});
