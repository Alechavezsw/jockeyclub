import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAYMENT_PLANS,
  FINANCING_MODE_ISSUER,
  activePaymentPlans,
  canEditPaymentPlanFinancing,
  ensureOfficialPaymentPlans,
  findPaymentPlan,
  mergePaymentPlans,
  normalizePaymentPlan,
  paymentPlanSnapshot,
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
    expect(findPaymentPlan(plans, 'visa-3')?.allowOperatorOverride).toBe(true);
    expect(findPaymentPlan(plans, 'data-3')?.installments).toBe(3);
    expect(plans.length).toBeGreaterThanOrEqual(DEFAULT_PAYMENT_PLANS.length);
  });

  it('no pisa allowOperatorOverride false guardado a propósito', () => {
    const plans = ensureOfficialPaymentPlans([
      { id: 'visa-3', label: 'Visa 3', installments: 3, allowOperatorOverride: false },
    ]);
    expect(findPaymentPlan(plans, 'visa-3')?.allowOperatorOverride).toBe(false);
  });

  it('busca por id entre los planes activos', () => {
    const plans = mergePaymentPlans(DEFAULT_PAYMENT_PLANS);
    expect(findPaymentPlan(plans, 'visa-3')?.installments).toBe(3);
    expect(findPaymentPlan(plans, 'no-existe')).toBeNull();
    expect(activePaymentPlans(plans).every((row) => row.active)).toBe(true);
  });

  it('defaults oficiales quedan en modalidad B provisional', () => {
    const plans = mergePaymentPlans(null);
    expect(plans.every((row) => row.financingMode === FINANCING_MODE_ISSUER)).toBe(true);
  });

  it('snapshot inmutable del plan y permiso de edición de tasas', () => {
    const plan = normalizePaymentPlan({
      id: 'x',
      label: 'X',
      installments: 3,
      financingMode: 'club_keeps',
      financingPercent: 12,
    });
    const snap = paymentPlanSnapshot(plan);
    expect(snap.financingMode).toBe('club_keeps');
    expect(snap.financingPercent).toBe(12);
    expect(canEditPaymentPlanFinancing('admin')).toBe(true);
    expect(canEditPaymentPlanFinancing('cajero')).toBe(false);
    expect(canEditPaymentPlanFinancing('operador')).toBe(false);
  });
});
