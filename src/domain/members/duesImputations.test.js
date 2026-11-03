import { describe, expect, it } from 'vitest';
import { payMemberDues } from './memberPayments';
import {
  imputeDuesPayment,
  openPeriodsFromChoices,
} from './duesImputations';

describe('imputeDuesPayment', () => {
  it('un pago parcial entra al mes más viejo y deja el recargo de ese mes', () => {
    const periods = openPeriodsFromChoices([
      { dueOn: '2026-10-10', capital: 70000, lateBase: 70000 },
      { dueOn: '2026-11-10', capital: 70000, lateBase: 70000 },
    ], 140000);
    const imputed = imputeDuesPayment(periods, 10000, '2026-11-12');
    expect(imputed.allocations).toHaveLength(1);
    expect(imputed.allocations[0].dueOn).toBe('2026-10-10');
    expect(imputed.allocations[0].capital).toBe(9090.91);
    expect(imputed.allocations[0].surcharge).toBe(909.09);
    expect(imputed.allocations[0].surchargeOpen).toBe(6090.91);
    expect(imputed.capital + imputed.surcharge).toBe(10000);
  });

  it('lo que sobra del saldo, sin mes, se cobra antes y sin recargo', () => {
    const periods = openPeriodsFromChoices([
      { dueOn: '2026-10-10', capital: 70000, lateBase: 70000 },
    ], 70000.03);
    expect(periods[0].dueOn).toBe('1900-01-10');
    expect(periods[0].capital).toBe(0.03);
    const imputed = imputeDuesPayment(periods, 0.03, '2026-11-12');
    expect(imputed.allocations[0].dueOn).toBe('1900-01-10');
    expect(imputed.allocations[0].surcharge).toBe(0);
    expect(imputed.capital).toBe(0.03);
  });
});

describe('payMemberDues', () => {
  it('muestra a qué mes fue un pago parcial', () => {
    const member = {
      memberId: '4400',
      name: 'Parcial',
      tier: 'socio_familiar',
      cuotaCategories: ['SOCIO FAMILIAR'],
      status: 'active',
      outstandingBalance: 70000,
      lastPaymentDate: '2026-09-10',
      nextDueDate: '2026-10-10',
      adherents: [],
    };
    const { member: next, payment } = payMemberDues(member, {
      method: 'efectivo',
      amount: 10000,
      today: new Date('2026-11-03T15:00:00-03:00'),
    });
    expect(payment.imputations[0].dueOn).toBe('2026-10-10');
    expect(payment.imputations[0].capital).toBe(9090.91);
    expect(payment.imputations[0].surcharge).toBe(909.09);
    expect(payment.imputations[0].surchargeOpen).toBe(6090.91);
    expect(payment.period).toBe('Octubre 2026');
    expect(next.outstandingBalance).toBe(60909.09);
  });
});
