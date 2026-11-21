import { describe, expect, it } from 'vitest';
import { authorizePosCardFinancing } from './posFinancing';

const planA = {
  id: 'visa-3-a',
  label: 'Visa 3 A',
  installments: 3,
  financingMode: 'club_keeps',
  financingPercent: 10,
  allowOperatorOverride: false,
};

describe('B14 cupón declarado vs comprobante vs calculado', () => {
  it('rechaza cupón declarado distinto del comprobante aunque uno coincida con el plan', () => {
    // Calculado: 70000 + 7000 = 77000. Declarado 77000, parse 88000.
    expect(() => authorizePosCardFinancing({
      financingBase: 70000,
      surchargeAmount: 0,
      plans: [planA],
      paymentPlanId: 'visa-3-a',
      receiptVoucher: 77000,
      receiptParse: { amount: 88000, reference: 'X' },
    })).toThrow(/declarado|comprobante/i);
  });

  it('rechaza comprobante distinto del calculado aunque no haya voucherAmount', () => {
    expect(() => authorizePosCardFinancing({
      financingBase: 70000,
      surchargeAmount: 0,
      plans: [planA],
      paymentPlanId: 'visa-3-a',
      receiptParse: { amount: 88000, reference: 'X' },
    })).toThrow(/comprobante|calculado|cupón/i);
  });

  it('acepta cuando declarado, parse y calculado coinciden', () => {
    const meta = authorizePosCardFinancing({
      financingBase: 70000,
      surchargeAmount: 0,
      plans: [planA],
      paymentPlanId: 'visa-3-a',
      receiptVoucher: 77000,
      receiptParse: { amount: 77000, reference: 'OK' },
    });
    expect(meta.voucherTotal).toBe(77000);
    expect(meta.financingAmount).toBe(7000);
  });
});
