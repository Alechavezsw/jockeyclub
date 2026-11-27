import { describe, expect, it } from 'vitest';
import { buildFeePeriodCharges, promotePendingFeePeriods } from '../accounting/feeBilling';
import {
  advanceSocialPeriodChoices,
  collectionPeriodChoices,
} from './dues';
import { collectionPreview, payMemberDues } from './memberPayments';

const TODAY = new Date('2026-11-27T12:00:00-03:00');

function familiar(extra = {}) {
  return {
    memberId: '10',
    id: '10',
    name: 'Titular',
    status: 'active',
    tier: 'socio_familiar',
    cuotaCategories: ['SOCIO FAMILIAR'],
    outstandingBalance: 0,
    nextDueDate: '2026-12-10',
    lastPaymentDate: '2026-11-05',
    paymentHistory: [{
      id: 'pay-nov',
      status: 'paid',
      date: '2026-11-05',
      amount: 70000,
      chargeScope: 'social',
      periodDueOns: ['2026-11-10'],
    }],
    ...extra,
  };
}

describe('adelanto de cuota social', () => {
  it('ofrece los próximos meses y no los trata como deuda', () => {
    const member = familiar();
    const owed = collectionPeriodChoices(member, TODAY, { chargeScope: 'social' });
    const advance = advanceSocialPeriodChoices(member, TODAY);
    expect(owed.map((row) => row.dueOn)).not.toContain('2026-12-10');
    expect(advance.map((row) => row.dueOn)).toEqual([
      '2026-12-10',
      '2027-01-10',
      '2027-02-10',
      '2027-03-10',
      '2027-04-10',
      '2027-05-10',
    ]);
    expect(advance.every((row) => row.kind === 'advance' && row.surcharge === 0 && row.capital === 70000)).toBe(true);
    expect(advanceSocialPeriodChoices({ ...member, tier: 'comision', cuotaCategories: ['COMISION'] }, TODAY)).toEqual([]);
  });

  it('cobra uno o varios meses sin bajar el saldo ni sumar recargo', () => {
    const preview = collectionPreview(familiar(), TODAY, {
      periodDueOns: ['2026-12-10', '2027-01-10'],
      chargeScope: 'social',
    });
    expect(preview.quota).toBe(140000);
    expect(preview.surcharge).toBe(0);
    expect(preview.cash).toBe(140000);

    const paid = payMemberDues(familiar(), {
      method: 'efectivo',
      amount: 140000,
      today: TODAY,
      periodDueOns: ['2026-12-10', '2027-01-10'],
      chargeScope: 'social',
    });
    expect(paid.member.outstandingBalance).toBe(0);
    expect(paid.payment.surcharge).toBe(0);
    expect(paid.payment.periodDueOns).toEqual(['2026-12-10', '2027-01-10']);
    expect(paid.payment.concept).toMatch(/diciembre de 2026/i);
    expect(paid.payment.concept).toMatch(/enero de 2027/i);
    expect(paid.member.nextDueDate).toBe('2027-02-10');
    expect(paid.member.meta.prepaidSocialDueOns).toEqual(['2026-12-10', '2027-01-10']);
  });

  it('suma el adelanto arriba de la deuda vencida y el 10 % queda solo en el mes vencido', () => {
    const member = familiar({
      outstandingBalance: 70000,
      nextDueDate: '2026-11-10',
      lastPaymentDate: '2026-10-05',
      paymentHistory: [{
        id: 'pay-oct',
        status: 'paid',
        date: '2026-10-05',
        amount: 70000,
        chargeScope: 'social',
        periodDueOns: ['2026-10-10'],
      }],
    });
    const paid = payMemberDues(member, {
      method: 'efectivo',
      amount: 147000,
      today: TODAY,
      periodDueOns: ['2026-11-10', '2026-12-10'],
      chargeScope: 'social',
    });
    expect(paid.payment.surcharge).toBe(7000);
    expect(paid.payment.quota).toBe(140000);
    expect(paid.member.outstandingBalance).toBe(0);
    expect(paid.payment.periodDueOns).toEqual(['2026-11-10', '2026-12-10']);
    expect(paid.member.nextDueDate).toBe('2027-01-10');
  });

  it('la liquidación del mes adelantado lo muestra pago y no genera deuda', () => {
    const paid = payMemberDues(familiar(), {
      method: 'efectivo',
      amount: 70000,
      today: TODAY,
      periodDueOns: ['2026-12-10'],
      chargeScope: 'social',
    });
    const december = buildFeePeriodCharges(
      [paid.member, familiar({ memberId: '11', tier: 'socio_individual', cuotaCategories: ['SOCIO INDIVIDUAL'], paymentHistory: [] })],
      { year: 2026, month: 12 },
      new Date('2026-12-01T12:00:00-03:00'),
    );
    const prepaid = december.find((row) => row.memberId === '10');
    const open = december.find((row) => row.memberId === '11');
    expect(prepaid).toMatchObject({ addAmount: 0, prepaid: true, billedAmount: 70000, dueOn: '2026-12-10' });
    expect(open.addAmount).toBe(40000);
    expect(open.prepaid).toBeUndefined();

    const promoted = promotePendingFeePeriods([{
      id: 'fp-2026-12',
      status: 'pending',
      availableAt: '2026-12-01',
      pack: { charges: december },
    }], new Date('2026-12-02T12:00:00-03:00'));
    expect(promoted.memberUpdates.map((row) => row.memberId)).toEqual(['11']);
  });

  it('no vuelve a cobrar un mes ya adelantado', () => {
    const paid = payMemberDues(familiar(), {
      method: 'efectivo',
      amount: 70000,
      today: TODAY,
      periodDueOns: ['2026-12-10'],
      chargeScope: 'social',
    });
    expect(advanceSocialPeriodChoices(paid.member, TODAY).map((row) => row.dueOn)).not.toContain('2026-12-10');
    expect(() => payMemberDues(paid.member, {
      method: 'efectivo',
      amount: 70000,
      today: TODAY,
      periodDueOns: ['2026-12-10'],
      chargeScope: 'social',
    })).toThrow(/no se puede cobrar|ya está pago|no está entre los meses/i);
  });
});
