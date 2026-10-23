import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAYMENT_PLANS,
  activePaymentPlans,
  findPaymentPlan,
  mergePaymentPlans,
} from './paymentPlans';

describe('paymentPlans', () => {
  it('completa el catálogo default si viene vacío', () => {
    const plans = mergePaymentPlans(null);
    expect(plans.length).toBe(DEFAULT_PAYMENT_PLANS.length);
    expect(plans[0].label).toMatch(/Visa/i);
  });

  it('limpia ids, cuotas y activos', () => {
    const plans = mergePaymentPlans([
      { id: ' Visa 6 ', label: '  Visa 6  ', cardBrand: 'Visa', installments: 6.4, active: false },
      { id: 'visa-6', label: 'duplicado', installments: 3 },
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0].id).toBe('visa-6');
    expect(plans[0].installments).toBe(6);
    expect(plans[0].active).toBe(false);
    expect(activePaymentPlans(plans)).toHaveLength(0);
  });

  it('busca por id entre los planes activos', () => {
    const plans = mergePaymentPlans(DEFAULT_PAYMENT_PLANS);
    expect(findPaymentPlan(plans, 'visa-3')?.installments).toBe(3);
    expect(findPaymentPlan(plans, 'no-existe')).toBeNull();
    expect(activePaymentPlans(plans).every((row) => row.active)).toBe(true);
  });
});
