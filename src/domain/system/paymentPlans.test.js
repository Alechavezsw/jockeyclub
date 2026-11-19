import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAYMENT_PLANS,
  activePaymentPlans,
  ensureOfficialPaymentPlans,
  findPaymentPlan,
  mergePaymentPlans,
} from './paymentPlans';

describe('paymentPlans', () => {
  it('completa el catálogo default si viene vacío', () => {
    const plans = mergePaymentPlans(null);
    expect(plans.length).toBe(DEFAULT_PAYMENT_PLANS.length);
    expect(plans[0].label).toMatch(/Visa/i);
    expect(findPaymentPlan(plans, 'data-3')?.label).toMatch(/DATA/i);
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

  it('agrega planes oficiales faltantes sin pisar los cargados', () => {
    const plans = ensureOfficialPaymentPlans([
      { id: 'visa-3', label: 'Visa 3 cuotas custom', installments: 3 },
    ]);
    expect(findPaymentPlan(plans, 'visa-3')?.label).toBe('Visa 3 cuotas custom');
    expect(findPaymentPlan(plans, 'data-3')?.installments).toBe(3);
    expect(plans.length).toBeGreaterThanOrEqual(DEFAULT_PAYMENT_PLANS.length);
  });

  it('busca por id entre los planes activos', () => {
    const plans = mergePaymentPlans(DEFAULT_PAYMENT_PLANS);
    expect(findPaymentPlan(plans, 'visa-3')?.installments).toBe(3);
    expect(findPaymentPlan(plans, 'no-existe')).toBeNull();
    expect(activePaymentPlans(plans).every((row) => row.active)).toBe(true);
  });
});
