import { describe, expect, it } from 'vitest';
import { buildFeePeriodCharges } from '../accounting/feeBilling';
import { appMonthlyDebtForMember } from '../accounting/appMonthlyDebts';
import {
  collectionPeriodChoices,
  duesOnJoin,
  firstSocialQuotaSource,
  shouldChargeFirstSocialQuota,
} from './dues';

const REFERENCE_ALTAS = [
  ['111598', 70000],
  ['111624', 70000],
  ['111627', 70000],
  ['111615', 40000],
  ['111617', 40000],
  ['111618', 40000],
  ['111620', 40000],
  ['111622', 40000],
  ['111623', 40000],
  ['111633', 40000],
];

function titular(extra = {}) {
  return {
    memberId: '200001',
    status: 'active',
    tier: 'socio_individual',
    cuotaCategories: ['SOCIO INDIVIDUAL'],
    ...extra,
  };
}

describe('primera cuota social del alta', () => {
  it('el individual genera una sola cuota del mes de ingreso', () => {
    const alta = duesOnJoin(titular(), '2026-11-03');
    expect(alta.socialCapital).toBe(40000);
    expect(alta.firstSocial).toMatchObject({
      dueOn: '2026-11-10',
      capital: 40000,
      lateBase: 40000,
      chargeScope: 'cuota_social',
      joinedAfterDue: false,
      label: 'Primera cuota social — Noviembre de 2026',
    });
    expect(alta.duesOpenPeriods).toHaveLength(1);
    expect(alta.nextDueDate).toBe('2026-12-10');
  });

  it('el familiar cobra la cuota del titular y el integrante no abre otra', () => {
    const familiar = duesOnJoin({
      ...titular({ memberId: '200002', tier: 'socio_familiar', cuotaCategories: ['SOCIO FAMILIAR'] }),
    }, '2026-11-03');
    expect(familiar.socialCapital).toBe(70000);
    expect(familiar.duesOpenPeriods).toHaveLength(1);

    const child = titular({
      memberId: '200003',
      tier: 'grupo_familiar_familiar',
      familyPrincipalNumber: '200002',
      cuotaCategories: ['GRUPO FAMILIAR (Familiar)'],
    });
    expect(duesOnJoin(child, '2026-11-03').socialCapital).toBe(0);
    expect(duesOnJoin(child, '2026-11-03').duesOpenPeriods).toBeUndefined();
    expect(shouldChargeFirstSocialQuota(child)).toBe(false);
  });

  it('después del 10 no hay recargo retroactivo', () => {
    const alta = duesOnJoin(titular(), '2026-11-27');
    expect(alta.firstSocial.joinedAfterDue).toBe(true);
    expect(alta.firstSocial.lateBase).toBe(0);
    const choices = collectionPeriodChoices({
      ...titular(),
      ...alta,
      joinDate: '2026-11-27',
      outstandingBalance: 40000,
    }, new Date('2026-11-27T12:00:00'));
    expect(choices).toHaveLength(1);
    expect(choices[0].dueOn).toBe('2026-11-10');
    expect(choices[0].capital).toBe(40000);
    expect(choices[0].surcharge).toBe(0);
    expect(choices[0].payable).toBe(40000);
    expect(choices[0].label).toBe('Primera cuota social — Noviembre de 2026');
  });

  it('el último día del mes sigue siendo la cuota de ese mes', () => {
    const alta = duesOnJoin(titular(), '2026-11-30');
    expect(alta.firstSocial.dueOn).toBe('2026-11-10');
    expect(alta.firstSocial.periodKey).toBe('2026-11');
    expect(alta.nextDueDate).toBe('2026-12-10');
  });

  it('AMET usa la tarifa del convenio y no el 10 %', () => {
    const alta = duesOnJoin({
      ...titular({
        tier: 'socio_familiar_amet',
        cuotaCategories: ['SOCIO FAMILIAR (AMET)'],
      }),
    }, '2026-11-20');
    expect(alta.socialCapital).toBe(68250);
    expect(alta.firstSocial.dueOn).toBe('2026-11-18');
    expect(alta.firstSocial.lateBase).toBe(0);
    expect(alta.nextDueDate).toBe('2026-12-18');
  });

  it('el abono de tenis queda aparte de la cuota social', () => {
    const alta = duesOnJoin(titular({
      cuotaCategories: ['SOCIO INDIVIDUAL', 'ABONO TENIS'],
      disciplines: ['Tenis'],
    }), '2026-11-03');
    expect(alta.socialCapital).toBe(40000);
    expect(alta.tennisCapital).toBe(12000);
    expect(alta.outstandingBalance).toBe(52000);
    expect(alta.duesOpenPeriods).toEqual([
      expect.objectContaining({ capital: 40000, chargeScope: 'cuota_social' }),
    ]);
  });

  it('un reintento usa la misma clave y no abre otra obligación', () => {
    const member = {
      ...titular(),
      joinDate: '2026-11-27',
      chargeFirstDues: true,
      duesOpenPeriods: duesOnJoin(titular(), '2026-11-27').duesOpenPeriods,
    };
    expect(firstSocialQuotaSource(member.memberId)).toBe('alta:200001');
    expect(firstSocialQuotaSource(member.memberId)).toBe(firstSocialQuotaSource('200001'));
    expect(shouldChargeFirstSocialQuota(member)).toBe(false);
  });

  it('la liquidación del mes de alta no suma otra cuota social y la del mes siguiente sí', () => {
    const member = titular({ joinDate: '2026-11-08' });
    const november = buildFeePeriodCharges([member], { year: 2026, month: 11 }, new Date('2026-11-01T12:00:00'));
    expect(november.filter((row) => row.tierId !== 'abono_tenis')).toEqual([]);
    const december = buildFeePeriodCharges([member], { year: 2026, month: 12 }, new Date('2026-12-01T12:00:00'));
    expect(december).toEqual([
      expect.objectContaining({
        memberId: '200001',
        addAmount: 40000,
        dueOn: '2026-12-10',
        tierId: 'socio_individual',
      }),
    ]);
  });

  it('un socio inactivo no entra en la liquidación', () => {
    const charges = buildFeePeriodCharges(
      [titular({ status: 'inactive', joinDate: '2026-10-01' })],
      { year: 2026, month: 12 },
      new Date('2026-12-01T12:00:00'),
    );
    expect(charges).toEqual([]);
  });

  it('reabrir un alta ya conciliada no genera otra cuota', () => {
    const member = titular({
      memberId: '111598',
      tier: 'socio_familiar',
      cuotaCategories: ['SOCIO FAMILIAR'],
      joinDate: '2026-11-12',
      outstandingBalance: 70000,
      meta: { altaMonthlyQuotaReconciliation: { preserved: true } },
      duesOpenPeriods: [{ dueOn: '2026-11-10', capital: 70000, lateBase: 0, kind: 'alta', chargeScope: 'cuota_social' }],
    });
    expect(shouldChargeFirstSocialQuota({ ...member, chargeFirstDues: true })).toBe(false);
    const choices = collectionPeriodChoices(member, new Date('2026-11-27T12:00:00'));
    expect(choices.map((row) => row.dueOn)).toEqual(['2026-11-10']);
    expect(choices[0].capital).toBe(70000);
    expect(choices[0].surcharge).toBe(0);
  });

  it('los diez socios conciliados conservan $ 490.000 en una sola cuota cada uno', () => {
    let total = 0;
    for (const [memberId, capital] of REFERENCE_ALTAS) {
      const familiar = capital === 70000;
      const member = {
        memberId,
        status: 'active',
        tier: familiar ? 'socio_familiar' : 'socio_individual',
        cuotaCategories: [familiar ? 'SOCIO FAMILIAR' : 'SOCIO INDIVIDUAL'],
        joinDate: '2026-11-12',
        outstandingBalance: capital,
        meta: { altaMonthlyQuotaReconciliation: { preserved: true } },
        duesOpenPeriods: [{
          dueOn: '2026-11-10',
          capital,
          lateBase: 0,
          kind: 'alta',
          chargeScope: 'cuota_social',
        }],
      };
      expect(shouldChargeFirstSocialQuota(member)).toBe(false);
      const choices = collectionPeriodChoices(member, new Date('2026-11-27T12:00:00'));
      expect(choices).toHaveLength(1);
      expect(choices[0].capital).toBe(capital);
      expect(choices[0].surcharge).toBe(0);
      expect(choices[0].dueOn).toBe('2026-11-10');
      const debt = appMonthlyDebtForMember(member, { today: new Date('2026-11-27T12:00:00') });
      expect(debt.months).toHaveLength(1);
      expect(debt.months[0].capital).toBe(capital);
      expect(debt.months[0].interest).toBe(0);
      expect(debt.totalDebt).toBe(capital);
      total += capital;
    }
    expect(total).toBe(490000);
    expect(REFERENCE_ALTAS).toHaveLength(10);
  });
});
