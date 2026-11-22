/**
 * Hotfix: socia 101600 (datos anonimizados) — «Al día» no debe ofrecer $70.000.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setRuntimeTierCatalog } from './tiers.js';
import {
  collectionPeriodChoices,
  socialDuesStoredBalance,
} from './dues.js';
import {
  collectionPreview,
  payMemberDues,
  recordDuesCollection,
} from './memberPayments.js';
import { buildOperationalDuesStanding } from './operationalDuesStanding.js';

const TODAY = new Date('2026-11-22T15:00:00-03:00');

function familiarTitular(extra = {}) {
  return {
    id: 'db-anon-101600',
    memberId: 'anon-101600',
    memberNumber: 'anon-101600',
    name: 'Socia Anónima Familiar',
    status: 'active',
    category: 'socio_familiar',
    tier: 'socio_familiar',
    cuotaCategories: ['SOCIO FAMILIAR'],
    outstandingBalance: 0,
    unpaidCapital: 0,
    nextDueDate: '2026-10-10',
    overdueSince: '2026-10-10',
    lastPaymentDate: '2026-11-09',
    paymentHistory: [{
      id: 'pay-nov-anon',
      paidAt: '2026-11-09',
      date: '2026-11-09',
      amount: 70000,
      status: 'paid',
      concept: 'Cuota social · Noviembre de 2026',
      periodDueOns: ['2026-11-10'],
      periodLabel: 'Noviembre de 2026',
      receiptNumber: 'R-ANON-NOV',
    }],
    duesOpenPeriods: [],
    meta: {
      unpaidCapital: 0,
      duesOpenPeriods: [],
      adminOperationalClear: {
        id: 'admin-clear-anon-2026-10-10',
        memberNumber: 'anon-101600',
        periodDueOns: ['2026-10-10'],
        dueOn: '2026-10-10',
        amount: 6363.64,
        reason: 'Remanente octubre 2026 autorizado en cero operativo',
        authorizedBy: 'Administración · Tesorería',
        authorizedAt: '2026-11-21',
      },
    },
    ...extra,
  };
}

describe('hotfix cobro $0 con nextDueDate desfasado (caso 101600 anonimizado)', () => {
  beforeEach(() => {
    setRuntimeTierCatalog([
      { id: 'socio_familiar', name: 'SOCIO FAMILIAR', monthlyDues: 70000, sortOrder: 1 },
      { id: 'socio_individual', name: 'SOCIO INDIVIDUAL', monthlyDues: 40000, sortOrder: 2 },
    ]);
  });
  afterEach(() => setRuntimeTierCatalog(null));

  it('Caso A: hoy 22/11/2026, saldo $0, nov pago y oct regularizado → $0 exigible', () => {
    const emptySnap = familiarTitular();
    const withResidual = familiarTitular({
      duesOpenPeriods: [{ dueOn: '2026-10-10', capital: 6363.64, capitalOpen: 6363.64 }],
      meta: {
        ...familiarTitular().meta,
        duesOpenPeriods: [{ dueOn: '2026-10-10', capital: 6363.64, capitalOpen: 6363.64 }],
      },
    });

    for (const member of [emptySnap, withResidual]) {
      expect(socialDuesStoredBalance(member)).toBe(0);
      const standing = buildOperationalDuesStanding(member, { today: TODAY });
      expect(standing.seal).toBe('Al día');
      expect(standing.totalExigible).toBe(0);

      for (const scope of ['all', 'social']) {
        const choices = collectionPeriodChoices(member, TODAY, { chargeScope: scope });
        expect(choices).toEqual([]);
        const preview = collectionPreview(member, TODAY, { chargeScope: scope });
        expect(preview.clear).toBe(true);
        expect(preview.cash).toBe(0);
        expect(preview.quota).toBe(0);
        expect(preview.periods).toEqual([]);
      }

      expect(() => payMemberDues(member, {
        method: 'efectivo',
        today: TODAY,
        periodDueOns: ['2026-10-10'],
      })).toThrow(/regularizado|pendiente|saldo/i);

      expect(() => recordDuesCollection(member, {
        method: 'efectivo',
        today: TODAY,
        periodDueOns: ['2026-10-10'],
        amount: 70000,
      })).toThrow(/regularizado|pendiente|cuota/i);
    }
  });

  it('Caso B: diciembre liquidado y sin pagar → solo esa obligación nueva', () => {
    const member = familiarTitular({
      outstandingBalance: 70000,
      unpaidCapital: 70000,
      nextDueDate: '2026-12-10',
      overdueSince: null,
      duesOpenPeriods: [{ dueOn: '2026-12-10', capital: 70000, capitalOpen: 70000 }],
      meta: {
        unpaidCapital: 70000,
        duesOpenPeriods: [{ dueOn: '2026-12-10', capital: 70000, capitalOpen: 70000 }],
        adminOperationalClear: familiarTitular().meta.adminOperationalClear,
      },
    });
    const todayDec = new Date('2026-12-05T12:00:00-03:00');
    expect(socialDuesStoredBalance(member)).toBe(70000);
    const choices = collectionPeriodChoices(member, todayDec, { chargeScope: 'social' });
    expect(choices.map((row) => ({ dueOn: row.dueOn, capital: row.capital }))).toEqual([
      { dueOn: '2026-12-10', capital: 70000 },
    ]);
    const preview = collectionPreview(member, todayDec, { chargeScope: 'social' });
    expect(preview.quota).toBe(70000);
    expect(preview.clear).toBe(false);
    expect(preview.periods.map((row) => row.dueOn)).toEqual(['2026-12-10']);
  });

  it('Caso C: deuda positiva auténtica conserva cobro normal', () => {
    const member = {
      memberId: 'anon-deuda',
      memberNumber: 'anon-deuda',
      name: 'Socio con mora',
      status: 'active',
      tier: 'socio_familiar',
      cuotaCategories: ['SOCIO FAMILIAR'],
      outstandingBalance: 140000,
      unpaidCapital: 140000,
      nextDueDate: '2026-10-10',
      overdueSince: '2026-10-10',
      lastPaymentDate: '2026-09-05',
      paymentHistory: [],
      duesOpenPeriods: [
        { dueOn: '2026-10-10', capital: 70000, capitalOpen: 70000 },
        { dueOn: '2026-11-10', capital: 70000, capitalOpen: 70000 },
      ],
    };
    expect(socialDuesStoredBalance(member)).toBe(140000);
    const choices = collectionPeriodChoices(member, TODAY, { chargeScope: 'social' });
    expect(choices.map((row) => row.dueOn)).toEqual(['2026-10-10', '2026-11-10']);
    expect(choices.every((row) => row.capital === 70000)).toBe(true);
    const preview = collectionPreview(member, TODAY, { chargeScope: 'social' });
    expect(preview.quota).toBe(140000);
    expect(preview.clear).toBe(false);
  });

  it('Caso D: nov pago + nextDue antiguo + clear admin → no reconstruye alta ni noviembre', () => {
    const member = familiarTitular({
      joinDate: '2026-10-01',
      duesOpenPeriods: [{ dueOn: '2026-10-10', capital: 6363.64, capitalOpen: 6363.64 }],
    });
    const choices = collectionPeriodChoices(member, TODAY, { chargeScope: 'social' });
    expect(choices).toEqual([]);
    const preview = collectionPreview(member, TODAY, { chargeScope: 'social' });
    expect(preview.cash).toBe(0);
    expect(preview.periods.some((row) => row.dueOn === '2026-11-10')).toBe(false);
    expect(preview.periods.some((row) => row.kind === 'alta')).toBe(false);
    expect(preview.periods.some((row) => row.capital === 70000)).toBe(false);
  });

  it('cobertura parcial: open $10.000 − clear $6.363,64 → ofrece $3.636,36 (no $70.000)', () => {
    const member = familiarTitular({
      outstandingBalance: 3636.36,
      unpaidCapital: 3636.36,
      nextDueDate: '2026-10-10',
      duesOpenPeriods: [{ dueOn: '2026-10-10', capital: 10000, capitalOpen: 10000 }],
      meta: {
        unpaidCapital: 3636.36,
        duesOpenPeriods: [{ dueOn: '2026-10-10', capital: 10000, capitalOpen: 10000 }],
        adminOperationalClear: {
          id: 'admin-clear-partial-oct',
          memberNumber: 'anon-101600',
          periodDueOns: ['2026-10-10'],
          dueOn: '2026-10-10',
          amount: 6363.64,
          reason: 'Clear parcial octubre',
          authorizedBy: 'Administración · Tesorería',
          authorizedAt: '2026-11-21',
        },
      },
    });
    expect(socialDuesStoredBalance(member)).toBe(3636.36);
    for (const scope of ['all', 'social']) {
      const choices = collectionPeriodChoices(member, TODAY, { chargeScope: scope });
      expect(choices).toHaveLength(1);
      expect(choices[0].dueOn).toBe('2026-10-10');
      expect(choices[0].capital).toBe(3636.36);
      expect(choices.some((row) => row.capital === 70000)).toBe(false);
      expect(choices.some((row) => row.capital === 10000)).toBe(false);
    }
    const preview = collectionPreview(member, TODAY, { chargeScope: 'social' });
    expect(preview.quota).toBe(3636.36);
    expect(preview.clear).toBe(false);
  });

  it('nov pago + dic deuda: cobrar nov explícito se rechaza sin imputar diciembre', () => {
    const todayDec = new Date('2026-12-05T12:00:00-03:00');
    const member = familiarTitular({
      outstandingBalance: 70000,
      unpaidCapital: 70000,
      nextDueDate: '2026-12-10',
      overdueSince: null,
      duesOpenPeriods: [{ dueOn: '2026-12-10', capital: 70000, capitalOpen: 70000 }],
      meta: {
        unpaidCapital: 70000,
        duesOpenPeriods: [{ dueOn: '2026-12-10', capital: 70000, capitalOpen: 70000 }],
        adminOperationalClear: familiarTitular().meta.adminOperationalClear,
      },
    });
    const choices = collectionPeriodChoices(member, todayDec, { chargeScope: 'social' });
    expect(choices.map((row) => row.dueOn)).toEqual(['2026-12-10']);

    const beforeHistory = member.paymentHistory.map((p) => ({ ...p }));
    expect(() => payMemberDues(member, {
      method: 'efectivo',
      today: todayDec,
      periodDueOns: ['2026-11-10'],
      chargeScope: 'social',
    })).toThrow(/ya está pago|no es cobrable|no se sustituye/i);

    expect(() => recordDuesCollection(member, {
      method: 'efectivo',
      today: todayDec,
      periodDueOns: ['2026-11-10'],
      amount: 70000,
      chargeScope: 'social',
    })).toThrow(/ya está pago|no es cobrable|no se sustituye/i);

    // Sin pago ni imputación a diciembre: ficha intacta.
    expect(member.paymentHistory).toEqual(beforeHistory);
    expect(member.outstandingBalance).toBe(70000);
    expect(member.duesOpenPeriods).toEqual([
      { dueOn: '2026-12-10', capital: 70000, capitalOpen: 70000 },
    ]);
  });
});
