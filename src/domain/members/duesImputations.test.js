import { describe, expect, it } from 'vitest';
import { payMemberDues } from './memberPayments';
import {
  duesMonthsPhrase,
  imputeDuesPayment,
  openPeriodsFromChoices,
} from './duesImputations';

describe('duesMonthsPhrase', () => {
  it('nombra noviembre en el recibo', () => {
    expect(duesMonthsPhrase(['2026-09-10', '2026-10-10', '2026-11-10']))
      .toBe('Septiembre de 2026, Octubre de 2026 y Noviembre de 2026');
  });
});

describe('imputeDuesPayment', () => {
  it('un pago parcial entra al capital del mes más viejo, sin descontar intereses', () => {
    const periods = openPeriodsFromChoices([
      { dueOn: '2026-10-10', capital: 70000, lateBase: 70000 },
      { dueOn: '2026-11-10', capital: 70000, lateBase: 70000 },
    ], 140000);
    const imputed = imputeDuesPayment(periods, 10000, '2026-11-12');
    expect(imputed.allocations).toHaveLength(1);
    expect(imputed.allocations[0].dueOn).toBe('2026-10-10');
    expect(imputed.allocations[0].capital).toBe(10000);
    expect(imputed.allocations[0].surcharge).toBe(0);
    expect(imputed.allocations[0].capitalOpen).toBe(60000);
    expect(imputed.capital + imputed.surcharge).toBe(10000);
  });

  it('la cuota entera es capital; el 10 % solo entra si pagan de más un mes vencido', () => {
    const periods = openPeriodsFromChoices([
      { dueOn: '2026-10-10', capital: 70000, lateBase: 70000 },
    ], 70000);
    const cuota = imputeDuesPayment(periods, 70000, '2026-11-10');
    expect(cuota.capital).toBe(70000);
    expect(cuota.surcharge).toBe(0);
    const conRecargo = imputeDuesPayment(periods, 77000, '2026-11-12');
    expect(conRecargo.capital).toBe(70000);
    expect(conRecargo.surcharge).toBe(7000);
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
    expect(payment.imputations[0].capital).toBe(10000);
    expect(payment.imputations[0].surcharge).toBe(0);
    expect(payment.imputations[0].capitalOpen).toBe(60000);
    expect(payment.period).toBe('Octubre 2026');
    expect(payment.concept).toMatch(/Octubre de 2026/);
    expect(next.outstandingBalance).toBe(60000);
  });
});
