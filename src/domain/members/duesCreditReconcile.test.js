import { describe, expect, it } from 'vitest';
import { collectionPeriodChoices } from './dues.js';
import {
  collectionPreview,
  payMemberDues,
  recordDuesCollection,
} from './memberPayments.js';
import { openPeriodsFromChoices } from './duesImputations.js';
import { detectMemberDuesAnomalies } from './duesBalanceAudit.js';

const TODAY = new Date('2026-11-20T18:00:00-03:00');

function familiarTitular(overrides = {}) {
  return {
    memberId: '100214',
    name: 'Daiana Noel Rodríguez',
    tier: 'socio_familiar',
    status: 'active',
    nextDueDate: '2026-10-10',
    outstandingBalance: 135000,
    unpaidCapital: 140000,
    duesOpenPeriods: [
      { dueOn: '2026-10-10', capital: 70000, lateBase: 70000 },
      { dueOn: '2026-11-10', capital: 70000, lateBase: 70000 },
    ],
    cuotaCategories: ['SOCIO FAMILIAR'],
    paymentHistory: [],
    ...overrides,
  };
}

describe('conciliación crédito ficticio / tarifa (100214)', () => {
  it('Daiana 100214: oct+nov a tarifa sin inventar adelanto de $5500', () => {
    const member = familiarTitular();
    const choices = collectionPeriodChoices(member, TODAY);
    expect(choices.map((row) => row.dueOn)).toEqual(['2026-10-10', '2026-11-10']);
    expect(choices.every((row) => row.capital === 70000)).toBe(true);

    const preview = collectionPreview(member, TODAY, {
      periodDueOns: ['2026-10-10', '2026-11-10'],
    });
    expect(preview.quota).toBe(140000);
    expect(preview.surcharge).toBe(14000);
    expect(preview.cash).toBe(154000);

    const paid = payMemberDues(member, {
      method: 'transferencia',
      amount: 154000,
      today: TODAY,
      periodDueOns: ['2026-10-10', '2026-11-10'],
    });
    expect(paid.payment.quota).toBe(140000);
    expect(paid.payment.surcharge).toBe(14000);
    expect(paid.payment.creditLeftover || 0).toBe(0);
    expect(paid.payment.imputations).toEqual([
      expect.objectContaining({ dueOn: '2026-10-10', capital: 70000, surcharge: 7000 }),
      expect.objectContaining({ dueOn: '2026-11-10', capital: 70000, surcharge: 7000 }),
    ]);
    expect(paid.member.outstandingBalance).toBe(0);
    expect(paid.member.creditBalance || 0).toBe(0);
  });

  it('pago exacto de dos cuotas con recargos', () => {
    const member = familiarTitular({
      outstandingBalance: 140000,
      unpaidCapital: 140000,
    });
    const result = recordDuesCollection(member, {
      method: 'efectivo',
      amount: 154000,
      today: TODAY,
      periodDueOns: ['2026-10-10', '2026-11-10'],
    });
    expect(result.payment.amount).toBe(154000);
    expect(result.payment.quota).toBe(140000);
    expect(result.payment.surcharge).toBe(14000);
    expect(result.member.outstandingBalance).toBe(0);
  });

  it('pago parcial legítimo deja capital abierto sin crédito', () => {
    const member = familiarTitular({ outstandingBalance: 140000 });
    const paid = payMemberDues(member, {
      method: 'a_cuenta',
      amount: 70000,
      today: TODAY,
      periodDueOns: ['2026-10-10', '2026-11-10'],
    });
    expect(paid.fullyPaid).toBe(false);
    expect(paid.member.outstandingBalance).toBeGreaterThan(0.01);
    expect(paid.payment.creditLeftover || 0).toBe(0);
  });

  it('adelanto real voluntario solo si supera la obligación a tarifa', () => {
    const member = familiarTitular({ outstandingBalance: 140000 });
    expect(() => payMemberDues(member, {
      method: 'efectivo',
      amount: 160000,
      today: TODAY,
      periodDueOns: ['2026-10-10', '2026-11-10'],
    })).toThrow(/supera el saldo/i);

    const onAccount = payMemberDues(member, {
      method: 'a_cuenta',
      amount: 160000,
      today: TODAY,
      periodDueOns: ['2026-10-10', '2026-11-10'],
    });
    expect(onAccount.payment.creditLeftover).toBe(6000);
  });

  it('descuento administrativo baja el efectivo, no el capital ni el 10 %', () => {
    const member = familiarTitular({ outstandingBalance: 140000 });
    const result = recordDuesCollection(member, {
      method: 'efectivo',
      amount: 120000,
      discount: 34000,
      discountDetail: 'fecha del comprobante 6/10/26',
      today: TODAY,
      periodDueOns: ['2026-10-10', '2026-11-10'],
    });
    expect(result.payment.discount).toBe(34000);
    expect(result.payment.amount).toBe(120000);
    expect(result.payment.quota).toBe(140000);
    expect(result.payment.surcharge).toBe(14000);
  });

  it('ficha corta vs tarifa: schedule a capital de tarifa, no al outstanding', () => {
    const member = familiarTitular();
    const choices = collectionPeriodChoices(member, TODAY);
    const tariff = choices.reduce((sum, row) => sum + row.capital, 0);
    expect(tariff).toBe(140000);
    const schedule = openPeriodsFromChoices(choices, tariff);
    expect(schedule.map((row) => row.capital)).toEqual([70000, 70000]);
    const shrunk = openPeriodsFromChoices(choices, 135000);
    expect(shrunk.map((row) => row.capital)).toEqual([70000, 65000]);
  });

  it('reintento del mismo pago no duplica en detección de anomalías', () => {
    const payment = {
      id: 'pay-1',
      amount: 154000,
      receiptNumber: 'RC-100214-20261120',
      paidAt: '2026-11-20',
      date: '2026-11-20',
    };
    const member = familiarTitular({
      outstandingBalance: 0,
      paymentHistory: [payment, { ...payment, id: 'pay-2' }],
    });
    const findings = detectMemberDuesAnomalies(member, { today: TODAY });
    expect(findings.some((row) => row.code === 'duplicate_payment')).toBe(true);
  });

  it('saldo negativo con períodos abiertos marca anomalía de conciliación', () => {
    const member = familiarTitular({
      outstandingBalance: -5500,
      duesOpenPeriods: [
        { dueOn: '2026-10-10', capital: 70000, lateBase: 70000 },
        { dueOn: '2026-11-10', capital: 70000, lateBase: 70000 },
      ],
    });
    const findings = detectMemberDuesAnomalies(member, { today: TODAY });
    expect(findings.some((row) => row.code === 'negative_balance_review')).toBe(true);
  });

  it('después de conciliar: al día, sin crédito, diciembre no cobrable en noviembre', () => {
    const member = familiarTitular({
      outstandingBalance: 0,
      unpaidCapital: 0,
      nextDueDate: '2026-12-10',
      duesOpenPeriods: [],
      duesCoveredThrough: '2026-11',
    });
    const choices = collectionPeriodChoices(member, TODAY);
    expect(choices.some((row) => String(row.dueOn).startsWith('2026-12'))).toBe(false);
    const preview = collectionPreview(member, TODAY);
    expect(preview.clear || preview.cash === 0).toBe(true);
    expect(memberCreditIsZero(member)).toBe(true);
  });
});

function memberCreditIsZero(member) {
  const stored = Number(member.outstandingBalance) || 0;
  const explicit = Number(member.creditBalance || member.meta?.creditBalance) || 0;
  return stored >= -0.01 && explicit <= 0.01;
}
