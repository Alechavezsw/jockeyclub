import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  applyAutomaticDues,
  afterCollectDues,
  diffAutomaticDues,
  duesAmountForHousehold,
  duesAmountForMember,
  duesChargeBreakdown,
  duesPayableAmount,
  duesPayableForMember,
  getOverdueMembers,
  getDueTodayMembers,
  getUpcomingDuesMembers,
  quotaHeadline,
  isVitalicioMember,
  isDuesExemptMember,
  dbMemberIsDuesExempt,
  toWhatsAppPhone,
  buildWhatsAppDuesUrl,
  nextDuesDueDate,
  pinDuesDueDate,
  duesDueMoment,
  monthsBehindOnDues,
  firstUnpaidDuesDate,
  formatMonthsBehind,
  unpaidSocialDuesAmount,
  canChargeSocialDues,
  isAmetDuesMember,
  duesDueDayForMember,
  duesOnJoin,
  isMemberBillingActive,
  collectionPeriodChoices,
  memberDueFact,
} from './dues';
import { collectionPreview } from './memberPayments';
import { setRuntimeTierCatalog } from './tiers';
import { setRuntimeDiscountRules } from '../accounting/discountApplication';

const testCatalog = [
  { id: 'socio_individual', name: 'SOCIO INDIVIDUAL', monthlyDues: 32000, sortOrder: 1 },
  { id: 'grupo_familiar_familiar', name: 'GRUPO FAMILIAR (Familiar)', monthlyDues: 38000, sortOrder: 2 },
  { id: 'socio_vitalicio', name: 'SOCIO (Vitalicio)', monthlyDues: 45000, sortOrder: 3 },
];

beforeEach(() => setRuntimeTierCatalog(testCatalog));
afterEach(() => {
  setRuntimeTierCatalog(null);
  setRuntimeDiscountRules([]);
});

const members = [
  { memberId: '1', name: 'A', tier: 'socio_individual', outstandingBalance: 32000, status: 'active', nextDueDate: '2026-06-10' },
  { memberId: '2', name: 'B', tier: 'socio_familiar', outstandingBalance: 0, status: 'active', nextDueDate: '2026-08-10' },
  { memberId: '3', name: 'C', tier: 'socio_vitalicio', outstandingBalance: 0, status: 'active', nextDueDate: '2026-09-10' },
  { memberId: '4', name: 'D', tier: 'socio_individual', outstandingBalance: 0, status: 'active', nextDueDate: '2026-07-10' },
];

describe('dues classification', () => {
  const today = new Date('2026-07-23T12:00:00');

  it('detecta cuotas vencidas por saldo', () => {
    const overdue = getOverdueMembers(members, today);
    expect(overdue.map((m) => m.memberId)).toContain('1');
    expect(overdue.map((m) => m.memberId)).toContain('4');
  });

  it('después del 10 la cuota impaga está en mora', () => {
    const overdue = getOverdueMembers([
      { memberId: 'm', name: 'M', tier: 'socio_individual', outstandingBalance: 0, status: 'active', nextDueDate: '2026-10-10' },
    ], new Date('2026-10-11T12:00:00'));
    expect(overdue).toHaveLength(1);
    expect(overdue[0].duesStatus).toBe('mora');
  });

  it('el día 10 todavía vence, no entra en mora', () => {
    const member = { memberId: 'm', name: 'M', tier: 'socio_individual', outstandingBalance: 0, status: 'active', nextDueDate: '2026-10-10' };
    const today = new Date('2026-10-10T12:00:00');
    expect(getOverdueMembers([member], today)).toHaveLength(0);
    expect(getDueTodayMembers([member], today)[0]?.duesStatus).toBe('due');
    expect(getUpcomingDuesMembers([member], { today })).toHaveLength(0);
  });

  it('el saldo de cuota del padrón cuenta como mora aunque no tenga vencimiento cargado', () => {
    const overdue = getOverdueMembers([
      { memberId: 'l', name: 'Lila', tier: 'socio_familiar', outstandingBalance: 77000, status: 'active' },
    ], new Date('2026-10-17T12:00:00'));
    expect(overdue).toHaveLength(1);
    expect(overdue[0].amountDue).toBe(77000);
  });

  it('débitos importados con unpaidCapital LILA en 0 no figuran en mora', () => {
    const overdue = getOverdueMembers([
      {
        memberId: '11147',
        name: 'Elizabeth Beatriz Onsalo',
        tier: 'socio_familiar',
        outstandingBalance: 70000,
        unpaidCapital: 0,
        lastPaymentDate: '2026-11-01',
        status: 'active',
      },
      {
        memberId: '10559',
        name: 'Egla Anabel Costa',
        tier: 'socio_familiar',
        outstandingBalance: 709000,
        unpaidCapital: 717000,
        status: 'active',
      },
    ], new Date('2026-11-08T12:00:00'));
    expect(overdue.map((m) => m.memberId)).toEqual(['10559']);
    expect(overdue[0].amountDue).toBe(717000);
  });

  it('un alquiler en la cuenta no es mora de cuota', () => {
    const overdue = getOverdueMembers([
      {
        memberId: 's',
        name: 'Salón',
        tier: 'socio_individual',
        outstandingBalance: 80000,
        status: 'active',
        lastPaymentDate: '2026-10-12',
        nextDueDate: '2026-11-10',
      },
    ], new Date('2026-10-17T12:00:00'));
    expect(overdue).toHaveLength(0);
  });

  it('detecta próximas a vencer antes del día 10', () => {
    const upcoming = getUpcomingDuesMembers(members, { withinDays: 20, today });
    expect(upcoming.map((m) => m.memberId)).toEqual(['2']);
  });

  it('genera deuda automática al vencer sin saldo previo', () => {
    const updated = applyAutomaticDues(members, today);
    // Solo capital en ficha; el 10 % se suma al cobrar.
    expect(updated.find((m) => m.memberId === '4').outstandingBalance).toBe(40000);
    // Socio 1 ya tenía saldo y dos meses vencidos: completa a $ 40.000 × 2.
    expect(updated.find((m) => m.memberId === '1').outstandingBalance).toBe(80000);
    expect(updated.find((m) => m.memberId === '2').outstandingBalance).toBe(0);
  });

  it('acumula varios meses vencidos cuando el saldo estaba en cero', () => {
    const updated = applyAutomaticDues([{
      memberId: 'multi',
      name: 'Multi',
      tier: 'socio_individual',
      outstandingBalance: 0,
      status: 'active',
      nextDueDate: '2026-06-10',
    }], today);
    // Jun + Jul: $ 40.000 × 2 de capital, también antes de octubre.
    expect(updated[0].outstandingBalance).toBe(80000);
  });

  it('ciclo: cuota + cuota sin pagar = 2; recargo solo si paga después del 10', () => {
    setRuntimeTierCatalog(null);
    // Octubre liquidado, no pagó. Noviembre se suma encima.
    const afterOct = {
      memberId: '111591',
      name: 'Chávez',
      tier: 'socio_individual',
      status: 'active',
      outstandingBalance: 40000,
      nextDueDate: '2026-10-10',
      lastPaymentDate: null,
      adherents: [],
    };
    const afterNov = {
      ...afterOct,
      outstandingBalance: afterOct.outstandingBalance + 40000, // liquidación 1º nov
    };
    expect(afterNov.outstandingBalance).toBe(80000);

    // Paga el 5/11 (antes del 10 de nov): recargo solo sobre octubre vencido.
    const beforeTen = duesChargeBreakdown(afterNov, { paidOn: '2026-11-05' });
    expect(beforeTen.quota).toBe(80000);
    expect(beforeTen.surcharge).toBe(4000); // 10 % de oct
    expect(beforeTen.total).toBe(84000);

    // Paga el 12/11: oct y nov vencidos → 10 % de cada uno.
    const afterTen = duesChargeBreakdown({
      ...afterNov,
      nextDueDate: '2026-10-10',
    }, { paidOn: '2026-11-12' });
    expect(afterTen.quota).toBe(80000);
    expect(afterTen.surcharge).toBe(8000);
    expect(afterTen.total).toBe(88000);

    // Paga el 10 exacto de octubre con una sola cuota: sin recargo.
    expect(duesChargeBreakdown({
      ...afterOct,
      outstandingBalance: 40000,
      nextDueDate: '2026-10-10',
    }, { paidOn: '2026-10-10' })).toMatchObject({
      quota: 40000,
      surcharge: 0,
      total: 40000,
    });
  });

  it('al cobrar programa el próximo vencimiento', () => {
    const paid = afterCollectDues(members[0], today);
    expect(paid.outstandingBalance).toBe(0);
    expect(paid.nextDueDate).toBe('2026-08-10');
  });

  it('todas las cuotas vencen el día 10', () => {
    expect(nextDuesDueDate('2026-09-12')).toBe('2026-10-10');
    expect(nextDuesDueDate('2026-10-05')).toBe('2026-10-10');
    expect(nextDuesDueDate('2026-10-10')).toBe('2026-10-10');
    expect(pinDuesDueDate('2026-10-25')).toBe('2026-10-10');
  });

  it('AMET vence el 18, sin recargo del 10 %', () => {
    const amet = {
      memberId: 'amet-1',
      name: 'AMET',
      tier: 'socio_familiar_amet',
      cuotaCategories: ['SOCIO FAMILIAR (AMET)'],
      outstandingBalance: 0,
      status: 'active',
      nextDueDate: '2026-10-10',
      adherents: [],
    };
    expect(isAmetDuesMember(amet)).toBe(true);
    expect(duesDueDayForMember(amet)).toBe(18);
    expect(pinDuesDueDate('2026-10-10', amet)).toBe('2026-10-18');
    expect(nextDuesDueDate('2026-10-12', amet)).toBe('2026-10-18');
    expect(nextDuesDueDate('2026-10-18', amet)).toBe('2026-10-18');
    expect(nextDuesDueDate('2026-10-19', amet)).toBe('2026-11-18');
    expect(duesPayableAmount(68250, { paidOn: '2026-10-19', dueOn: '2026-10-18', tier: 'socio_familiar_amet' })).toBe(68250);
    expect(getOverdueMembers([amet], new Date('2026-10-11T12:00:00'))).toHaveLength(0);
    expect(getDueTodayMembers([{ ...amet, nextDueDate: '2026-10-18' }], new Date('2026-10-18T12:00:00'))).toHaveLength(1);
    const charged = applyAutomaticDues([{ ...amet, nextDueDate: '2026-10-18' }], new Date('2026-10-19T12:00:00'))[0];
    expect(charged.outstandingBalance).toBe(68250);
    expect(afterCollectDues(charged, new Date('2026-10-19T12:00:00')).nextDueDate).toBe('2026-11-18');
  });

  it('normaliza vencimientos guardados al día 10', () => {
    const updated = applyAutomaticDues([
      { memberId: 'n', name: 'N', tier: 'socio_individual', outstandingBalance: 0, status: 'active', nextDueDate: '2026-10-12' },
    ], new Date('2026-09-12T12:00:00'));
    expect(updated[0].nextDueDate).toBe('2026-10-10');
    expect(updated[0].outstandingBalance).toBe(0);
    expect(diffAutomaticDues(
      [{ memberId: 'n', outstandingBalance: 0, nextDueDate: '2026-10-12' }],
      updated,
    ).map((m) => m.memberId)).toEqual(['n']);
  });

  it('al alta el grupo tiene el valor único del titular, no suma cuota social de adherentes', () => {
    const october = new Date('2026-10-20T12:00:00');
    expect(duesAmountForHousehold('socio_individual', [], october)).toBe(40000);
    expect(duesAmountForHousehold('socio_individual', [
      { tier: 'socio_individual' },
      { tier: 'grupo_familiar_familiar' },
    ], october)).toBe(40000);
    expect(duesAmountForHousehold('socio_familiar', [
      { tier: 'grupo_familiar_familiar' },
      { tier: 'abono_tenis' },
    ], october)).toBe(82000);
  });

  it('calcula cuota del socio con adherentes activos', () => {
    const october = new Date('2026-10-20T12:00:00');
    expect(duesAmountForMember({
      tier: 'socio_vitalicio',
      adherents: [
        { tier: 'socio_vitalicio', status: 'active' },
        { tier: 'socio_individual', status: 'inactive' },
      ],
    }, october)).toBe(0);
    expect(duesAmountForMember({
      tier: 'socio_familiar',
      adherents: [
        { tier: 'socio_familiar', status: 'active' },
        { tier: 'grupo_familiar_familiar', status: 'active' },
        { tier: 'abono_tenis', status: 'active', cuotaCategories: ['ABONO TENIS'] },
      ],
    }, october)).toBe(82000);
    expect(duesAmountForMember({
      memberId: '3501',
      familyPrincipalNumber: '10009',
      tier: 'socio_familiar',
      cuotaCategories: ['SOCIO FAMILIAR', 'ABONO TENIS'],
    }, october)).toBe(0);
    expect(duesChargeBreakdown({
      tier: 'socio_familiar',
      adherents: [],
    }, { paidOn: '2026-10-11', dueOn: '2026-10-10', on: '2026-10-11' })).toEqual({
      quota: 70000,
      surcharge: 7000,
      total: 77000,
      capital: 70000,
      payable: 77000,
      waivedSurcharge: 0,
    });
  });

  it('excluye suspended y pending de mora y cuota automática', () => {
    const extra = [
      { memberId: 's', name: 'S', tier: 'socio_individual', outstandingBalance: 8000, status: 'suspended', nextDueDate: '2026-06-01' },
      { memberId: 'p', name: 'P', tier: 'socio_individual', outstandingBalance: 0, status: 'pending', nextDueDate: '2026-06-01' },
    ];
    const overdue = getOverdueMembers([...members, ...extra], today);
    expect(overdue.map((m) => m.memberId)).not.toContain('s');
    expect(overdue.map((m) => m.memberId)).not.toContain('p');
    const updated = applyAutomaticDues(extra, today);
    expect(updated.find((m) => m.memberId === 'p').outstandingBalance).toBe(0);
  });

  it('detecta diffs de cuotas automáticas para persistir', () => {
    const updated = applyAutomaticDues(members, today);
    const changed = diffAutomaticDues(members, updated);
    expect(changed.map((m) => m.memberId).toSorted()).toEqual(['1', '4']);
  });

  it('normaliza teléfonos AR para WhatsApp', () => {
    expect(toWhatsAppPhone('+54 9 264 555-1234')).toBe('5492645551234');
    expect(toWhatsAppPhone('2645551234')).toBe('5492645551234');
  });

  it('baja del padrón no figura «al día» aunque el saldo sea 0', () => {
    expect(quotaHeadline({ status: 'inactive', outstandingBalance: 0 }).title).toBe('Sin cuota');
    expect(quotaHeadline({ status: 'inactive', outstandingBalance: 0 }).kind).toBe('off');
    expect(quotaHeadline({ status: 'active', outstandingBalance: 0 }).title).toBe('Al día');
    expect(quotaHeadline({ status: 'inactive', outstandingBalance: 500 }).kind).toBe('debt');
  });

  it('comisión y presidente no figuran en mora de cuota', () => {
    expect(isDuesExemptMember({ tier: 'comision', cuotaCategories: ['COMISION'] })).toBe(true);
    expect(isDuesExemptMember({
      tier: 'comision',
      cuotaCategories: ['COMISION', 'SOCIO FAMILIAR'],
    })).toBe(false);
    const overdue = getOverdueMembers([
      {
        memberId: '8377',
        name: 'Presidente',
        tier: 'comision',
        cuotaCategories: ['COMISION'],
        outstandingBalance: 1466000,
        status: 'active',
      },
    ], new Date('2026-10-17T12:00:00'));
    expect(overdue).toHaveLength(0);
    expect(quotaHeadline({
      status: 'active',
      outstandingBalance: 1466000,
      tier: 'comision',
      cuotaCategories: ['COMISION'],
    }).title).toBe('Comisión');
  });

  it('vitalicio no factura ni figura al día', () => {
    expect(isVitalicioMember({ tier: 'socio_vitalicio' })).toBe(true);
    expect(isVitalicioMember({ tier: 'grupo_familiar_vitalicio' })).toBe(true);
    expect(isVitalicioMember({ cuotaCategories: ['SOCIO (Vitalicio)'] })).toBe(true);
    expect(isVitalicioMember({ tier: 'socio_individual' })).toBe(false);
    const quota = quotaHeadline({ status: 'active', outstandingBalance: 0, tier: 'socio_vitalicio' });
    expect(quota.title).toBe('Vitalicio');
    expect(quota.billing).toBe(false);
    expect(quota.kind).toBe('off');
    expect(unpaidSocialDuesAmount({
      tier: 'socio_vitalicio',
      lastPaymentDate: '2026-07-13',
      nextDueDate: '2026-08-10',
      outstandingBalance: 32000,
    }, new Date('2026-10-20T12:00:00'))).toBe(0);
    expect(getOverdueMembers([{
      memberId: 'v1',
      name: 'Vitalicia',
      tier: 'socio_vitalicio',
      outstandingBalance: 32000,
      status: 'active',
      nextDueDate: '2026-08-10',
    }], new Date('2026-10-20T12:00:00'))).toHaveLength(0);
    expect(canChargeSocialDues({ status: 'active', tier: 'socio_vitalicio' })).toBe(false);
    expect(canChargeSocialDues({ status: 'active', tier: 'socio_individual' })).toBe(true);
    expect(canChargeSocialDues({
      status: 'active',
      tier: 'socio_familiar',
      memberId: '3501',
      familyPrincipalNumber: '10009',
    })).toBe(false);
    expect(duesAmountForMember({
      tier: 'socio_vitalicio',
      outstandingBalance: 32000,
      adherents: [{ tier: 'socio_familiar', status: 'active' }],
    }, new Date('2026-10-20T12:00:00'))).toBe(0);
    expect(buildWhatsAppDuesUrl({
      tier: 'socio_vitalicio',
      phone: '2645551234',
      amountDue: 32000,
    })).toBeNull();
  });

  it('fundador no abona cuota ni entra en mora', () => {
    expect(isDuesExemptMember({ tier: 'fundador' })).toBe(true);
    expect(isDuesExemptMember({ tier: 'grupo_familiar_fundador' })).toBe(true);
    expect(isDuesExemptMember({ cuotaCategories: ['FUNDADOR'] })).toBe(true);
    expect(isDuesExemptMember({
      tier: 'fundador',
      cuotaCategories: ['FUNDADOR', 'SOCIO FAMILIAR'],
    })).toBe(false);
    expect(dbMemberIsDuesExempt('vitalicio', { cuotaCategories: ['SOCIO FAMILIAR'] })).toBe(true);
    expect(dbMemberIsDuesExempt('socio_familiar', { cuotaCategories: ['SOCIO FAMILIAR'] })).toBe(false);
    expect(dbMemberIsDuesExempt('socio_familiar', { cuotaCategories: ['COMISION'] })).toBe(true);
    expect(dbMemberIsDuesExempt('comision', null)).toBe(true);
    expect(canChargeSocialDues({ status: 'active', tier: 'fundador' })).toBe(false);
    const quota = quotaHeadline({
      status: 'active',
      outstandingBalance: 50000,
      tier: 'fundador',
    });
    expect(quota.title).toBe('Fundador');
    expect(quota.hint).toMatch(/no abona cuota social/i);
    expect(quota.billing).toBe(false);
    expect(unpaidSocialDuesAmount({
      tier: 'fundador',
      outstandingBalance: 50000,
      nextDueDate: '2026-08-10',
    }, new Date('2026-10-20T12:00:00'))).toBe(0);
    expect(getOverdueMembers([{
      memberId: 'f1',
      name: 'Fundador',
      tier: 'fundador',
      outstandingBalance: 50000,
      status: 'active',
      nextDueDate: '2026-08-10',
    }], new Date('2026-10-20T12:00:00'))).toHaveLength(0);
    expect(duesAmountForMember({ tier: 'fundador', adherents: [] }, new Date('2026-10-20T12:00:00'))).toBe(0);
    expect(buildWhatsAppDuesUrl({
      tier: 'fundador',
      phone: '2645551234',
      amountDue: 50000,
    })).toBeNull();
    const before = {
      memberId: 'f2',
      name: 'Fundador',
      tier: 'fundador',
      status: 'active',
      outstandingBalance: 0,
      nextDueDate: '2026-09-10',
    };
    const after = applyAutomaticDues([before], new Date('2026-10-20T12:00:00'));
    expect(after[0].outstandingBalance).toBe(0);
  });

  it('un saldo de cuenta no es mora si la cuota todavía no venció', () => {
    const overdue = getOverdueMembers([
      { memberId: 'x', name: 'X', tier: 'socio_individual', outstandingBalance: 1000, status: 'active', nextDueDate: '2026-09-01' },
    ], today);
    expect(overdue).toHaveLength(0);
  });
});

describe('tarifa desde octubre 2026', () => {
  const october = new Date('2026-10-01T12:00:00');
  const afterDue = new Date('2026-10-11T12:00:00');

  it('cobra la liquidación de octubre de Lila, línea por línea', () => {
    expect(duesAmountForMember({ tier: 'socio_individual', adherents: [] }, october)).toBe(40000);
    expect(duesAmountForMember({ tier: 'socio_familiar', adherents: [] }, october)).toBe(70000);
    expect(duesAmountForMember({ tier: 'socio_individual_amet', adherents: [] }, october)).toBe(39000);
    expect(duesAmountForMember({ tier: 'socio_familiar_amet', adherents: [] }, october)).toBe(68250);
    expect(duesAmountForMember({ tier: 'abono_tenis', adherents: [] }, october)).toBe(12000);
    expect(duesAmountForMember({ tier: 'grupo_familiar_familiar', adherents: [] }, october)).toBe(0);
    expect(duesAmountForMember({ tier: 'socio_vitalicio', adherents: [] }, october)).toBe(0);
    expect(duesAmountForMember({
      tier: 'interes_por_transaccion_25_grupo_familiar_amet',
      adherents: [],
    }, october)).toBe(1750);
    expect(duesAmountForMember({
      tier: 'socio_familiar',
      cuotaCategories: ['SOCIO FAMILIAR', 'ABONO TENIS'],
      adherents: [],
    }, october)).toBe(82000);
  });

  it('el individual es 40.000 en septiembre, en noviembre y en cualquier mes', () => {
    const member = { tier: 'socio_individual', adherents: [] };
    expect(duesAmountForMember(member, new Date('2026-09-29T12:00:00'))).toBe(40000);
    expect(duesAmountForMember(member, new Date('2026-11-10T12:00:00'))).toBe(40000);
    expect(duesAmountForMember(member, new Date('2026-06-10T12:00:00'))).toBe(40000);
  });

  it('desde octubre la cuota en mora después del 10 lleva 10 %', () => {
    expect(duesPayableAmount(40000, {
      paidOn: '2026-11-10',
      dueOn: '2026-11-10',
      tier: 'socio_individual',
    })).toBe(40000);
    expect(duesPayableAmount(40000, {
      paidOn: '2026-11-11',
      dueOn: '2026-11-10',
      tier: 'socio_individual',
    })).toBe(44000);
    expect(duesPayableAmount(40000, {
      paidOn: '2026-11-10',
      dueOn: '2026-10-10',
      tier: 'socio_individual',
    })).toBe(44000);
    expect(duesPayableAmount(70000, {
      paidOn: '2026-11-10',
      dueOn: '2026-10-10',
      tier: 'socio_familiar',
    })).toBe(77000);
    expect(duesPayableAmount(70000, {
      paidOn: '2026-10-10',
      dueOn: '2026-10-10',
      tier: 'socio_familiar',
    })).toBe(70000);
  });

  it('el recargo es el 10 % de cada mes vencido, por separado', () => {
    setRuntimeTierCatalog(null);
    const member = {
      memberId: '10',
      tier: 'socio_familiar',
      cuotaCategories: ['SOCIO FAMILIAR'],
      status: 'active',
      outstandingBalance: 130000,
      lastPaymentDate: '2026-08-13',
      nextDueDate: '2026-09-10',
      adherents: [],
    };
    expect(duesChargeBreakdown({
      ...member,
      outstandingBalance: 140000,
    }, { paidOn: '2026-10-22' })).toMatchObject({
      quota: 140000,
      surcharge: 14000,
      total: 154000,
    });
    expect(duesChargeBreakdown({
      ...member,
      outstandingBalance: 154000,
    }, { paidOn: '2026-10-22' })).toMatchObject({
      quota: 140000,
      surcharge: 14000,
      total: 154000,
    });
    expect(duesChargeBreakdown({
      ...member,
      outstandingBalance: 200000,
    }, { paidOn: '2026-10-22' }).surcharge).toBe(14000);
    expect(duesChargeBreakdown({
      ...member,
      cuotaCategories: ['SOCIO FAMILIAR', 'ABONO TENIS'],
      outstandingBalance: 162000,
    }, { paidOn: '2026-10-22' })).toMatchObject({
      quota: 162000,
      surcharge: 14000,
      total: 176000,
    });
  });

  it('después del 10 suma el 10 % y el día 10 no', () => {
    const member = {
      memberId: '8',
      name: 'Octubre',
      tier: 'socio_individual',
      outstandingBalance: 0,
      status: 'active',
      nextDueDate: '2026-10-10',
      adherents: [],
    };
    expect(duesPayableAmount(40000, { paidOn: '2026-10-10', dueOn: '2026-10-10' })).toBe(40000);
    expect(duesPayableAmount(70000, { paidOn: '2026-10-11', dueOn: '2026-10-10', tier: 'socio_familiar' })).toBe(77000);
    const nightOfTheTenth = new Date('2026-11-10T23:30:00-03:00');
    expect(duesPayableAmount(70000, { paidOn: nightOfTheTenth, dueOn: '2026-11-10', tier: 'socio_familiar' })).toBe(70000);
    expect(duesPayableAmount(70000, { paidOn: nightOfTheTenth, tier: 'socio_familiar' })).toBe(70000);
    expect(duesPayableAmount(68250, { paidOn: '2026-10-11', dueOn: '2026-10-10', tier: 'socio_familiar_amet' })).toBe(68250);
    expect(duesPayableAmount(10000, { paidOn: '2026-10-11', dueOn: '2026-10-10', tier: 'abono_tenis' })).toBe(10000);
    expect(applyAutomaticDues([member], new Date('2026-10-10T12:00:00'))[0].outstandingBalance).toBe(0);
    // Ficha = capital; el 10 % aparece en duesChargeBreakdown / cobro, no en el saldo.
    expect(applyAutomaticDues([member], afterDue)[0].outstandingBalance).toBe(40000);
    expect(duesChargeBreakdown({
      ...member,
      outstandingBalance: 40000,
    }, { paidOn: afterDue })).toMatchObject({
      quota: 40000,
      surcharge: 4000,
      total: 44000,
    });
  });
});

describe('descuentos extras sobre la cuota viva', () => {
  const october = new Date('2026-10-01T12:00:00');
  const rule = {
    id: 'disc-9216',
    category: 'members',
    memberIds: ['9216'],
    memberNumber: '9216',
    valueType: 'percent',
    value: 100,
    validFrom: '2026-06-12',
    validTo: '2027-04-30',
    isActive: true,
  };

  it('un 100 % vigente deja la cuota y el recargo en cero', () => {
    const member = {
      memberId: '9216',
      tier: 'socio_familiar',
      cuotaCategories: ['SOCIO FAMILIAR'],
      status: 'active',
      adherents: [],
    };
    expect(duesAmountForMember(member, october, { rules: [rule] })).toBe(0);
    expect(duesPayableForMember(member, {
      paidOn: '2026-10-11',
      dueOn: '2026-10-10',
      on: '2026-10-01',
      rules: [rule],
    })).toBe(0);
  });
});

describe('atraso desde último pago (vence el 10)', () => {
  const today = new Date('2026-09-21T12:00:00');

  it('pago del 13/08 cubre agosto: el 21/09 hay 1 mes atrasado', () => {
    expect(firstUnpaidDuesDate({ lastPaymentDate: '2026-08-13', today })).toBe('2026-09-10');
    expect(monthsBehindOnDues({ lastPaymentDate: '2026-08-13', today })).toBe(1);
    expect(formatMonthsBehind(1)).toBe('1 mes atrasado');
  });

  it('nextDueDate gana: no reabre meses anteriores ya cerrados en ficha', () => {
    // lastPayment viejo no debe inventar jul–sep si el vencimiento abierto es octubre.
    expect(monthsBehindOnDues({
      lastPaymentDate: '2026-06-13',
      nextDueDate: '2026-10-10',
      today: new Date('2026-11-05T12:00:00'),
    })).toBe(1);
    expect(firstUnpaidDuesDate({
      lastPaymentDate: '2026-06-13',
      nextDueDate: '2026-10-10',
      today: new Date('2026-11-05T12:00:00'),
    })).toBe('2026-10-10');
  });

  it('pago de julio deja 2 meses atrasados en septiembre', () => {
    expect(monthsBehindOnDues({ lastPaymentDate: '2026-07-13', today })).toBe(2);
    expect(formatMonthsBehind(2)).toBe('2 meses atrasados');
  });

  it('pago en septiembre deja al día aunque sea antes del 10', () => {
    expect(monthsBehindOnDues({ lastPaymentDate: '2026-09-05', today })).toBe(0);
    expect(monthsBehindOnDues({ lastPaymentDate: '2026-09-13', today })).toBe(0);
  });
});

describe('memberDueFact', () => {
  it('en noviembre un nextDue de octubre con saldo es cuota vencida, no próximo', () => {
    const fact = memberDueFact({
      nextDueDate: '2026-10-10',
      outstandingBalance: 36000,
    }, new Date('2026-11-07T12:00:00'));
    expect(fact.label).toBe('Cuota vencida');
    expect(fact.overdue).toBe(true);
    expect(fact.hint).toBe('Pendiente de cobro');
  });

  it('una fecha futura sigue como próximo vencimiento', () => {
    const fact = memberDueFact({
      nextDueDate: '2026-12-10',
      outstandingBalance: 0,
    }, new Date('2026-11-07T12:00:00'));
    expect(fact.label).toBe('Próximo vencimiento');
    expect(fact.overdue).toBe(false);
  });
});

describe('duesDueMoment', () => {
  it('el 10 es el día de vencimiento', () => {
    const moment = duesDueMoment('2026-09-10');
    expect(moment.phase).toBe('today');
    expect(moment.dueLabel).toBe('10 de septiembre');
    expect(moment.daysUntil).toBe(0);
  });

  it('antes del 10 cuenta los días que faltan', () => {
    const moment = duesDueMoment('2026-09-09');
    expect(moment.phase).toBe('before');
    expect(moment.daysUntil).toBe(1);
  });

  it('después del 10 el vencimiento de ese mes ya pasó', () => {
    const moment = duesDueMoment('2026-09-27');
    expect(moment.phase).toBe('after');
    expect(moment.daysSince).toBe(17);
    expect(moment.dueLabel).toBe('10 de septiembre');
  });
});

describe('duesOnJoin', () => {
  it('alta a mitad de mes cobra el mes entero y vence el siguiente', () => {
    const alta = duesOnJoin({
      memberId: '1',
      status: 'active',
      tier: 'socio_individual',
      cuotaCategories: ['SOCIO INDIVIDUAL'],
    }, '2026-10-15');
    expect(alta.outstandingBalance).toBe(40000);
    expect(alta.nextDueDate).toBe('2026-11-10');
  });

  it('alta antes del 10 vence ese mes', () => {
    const alta = duesOnJoin({
      memberId: '1',
      status: 'active',
      tier: 'socio_individual',
      cuotaCategories: ['SOCIO INDIVIDUAL'],
    }, '2026-10-05');
    expect(alta.outstandingBalance).toBe(40000);
    expect(alta.nextDueDate).toBe('2026-10-10');
  });

  it('deja de facturar el día de la baja programada', () => {
    const member = {
      memberId: '1',
      status: 'active',
      bajaFecha: '2026-11-01',
      tier: 'socio_individual',
    };
    expect(isMemberBillingActive(member, new Date('2026-10-20T12:00:00'))).toBe(true);
    expect(isMemberBillingActive(member, new Date('2026-11-01T12:00:00'))).toBe(false);
  });
});

describe('buildWhatsAppDuesUrl', () => {
  it('arma wa.me si hay teléfono y omite si no', () => {
    const formatCurrency = (n) => `$${n}`;
    const url = buildWhatsAppDuesUrl({
      name: 'Ana',
      phone: '2644123456',
      amountDue: 12000,
      nextDueDate: '2026-08-01',
    }, formatCurrency);
    expect(url).toMatch(/^https:\/\/wa\.me\/5492644123456\?text=/);
    expect(buildWhatsAppDuesUrl({ name: 'Ana', phone: '' }, formatCurrency)).toBeNull();
  });
});

describe('collectionPeriodChoices vs saldo de ficha', () => {
  it('completa meses hacia atrás si el saldo supera el nextDueDate', () => {
    const member = {
      memberId: '111591',
      name: 'Manuel',
      tier: 'socio_individual',
      status: 'active',
      outstandingBalance: 152000,
      nextDueDate: '2026-10-10',
      overdueSince: '2026-10-10',
    };
    const today = new Date('2026-11-05T15:00:00-03:00');
    const choices = collectionPeriodChoices(member, today);
    const capital = choices.reduce((sum, row) => sum + (Number(row.capital) || 0), 0);
    expect(capital).toBe(152000);
    expect(choices.length).toBeGreaterThan(1);
    const preview = collectionPreview(member, today);
    expect(preview.quota).toBe(152000);
    expect(preview.cash).toBeGreaterThan(152000);
  });

  it('no re-cobra jul–sep si el saldo y nextDue dicen solo octubre', () => {
    const member = {
      memberId: '111591',
      name: 'Manuel',
      tier: 'socio_individual',
      status: 'active',
      outstandingBalance: 36000,
      nextDueDate: '2026-10-10',
      lastPaymentDate: '2026-06-13',
    };
    const today = new Date('2026-11-07T15:00:00-03:00');
    const choices = collectionPeriodChoices(member, today);
    expect(choices.map((row) => row.dueOn)).toEqual(['2026-10-10']);
    const preview = collectionPreview(member, today);
    expect(preview.quota).toBe(36000);
  });

  it('Alameda en noviembre: sep y oct a $70.000; noviembre ya pago no se ofrece', () => {
    setRuntimeTierCatalog([
      { id: 'socio_familiar', name: 'SOCIO FAMILIAR', monthlyDues: 70000, sortOrder: 1 },
    ]);
    const member = {
      memberId: '9624',
      name: 'Gustavo Ariel Alameda',
      tier: 'socio_familiar',
      status: 'active',
      outstandingBalance: 130000,
      nextDueDate: '2026-09-10',
      cuotaCategories: ['SOCIO FAMILIAR'],
      paymentHistory: [
        { date: '2026-11-05', amount: 70000, periodDueOns: ['2026-11-10'], concept: 'Cuota noviembre' },
      ],
    };
    const today = new Date(2026, 10, 9, 12, 0, 0);
    const choices = collectionPeriodChoices(member, today);
    expect(choices.map((row) => ({ dueOn: row.dueOn, capital: row.capital, surcharge: row.surcharge }))).toEqual([
      { dueOn: '2026-09-10', capital: 70000, surcharge: 7000 },
      { dueOn: '2026-10-10', capital: 70000, surcharge: 7000 },
    ]);
    expect(choices.some((row) => row.dueOn === '2026-11-10')).toBe(false);
    expect(choices.some((row) => row.dueOn === '2026-12-10')).toBe(false);
    const preview = collectionPreview(member, today);
    expect(preview.quota).toBe(140000);
    expect(preview.surcharge).toBe(14000);
    expect(preview.cash).toBe(154000);
  });

  it('en noviembre, con noviembre pago, no se cobra diciembre: sale en la liquidación', () => {
    const member = {
      memberId: '6136',
      name: 'Emilio Isern',
      tier: 'socio_individual',
      status: 'active',
      outstandingBalance: 0,
      unpaidCapital: 0,
      nextDueDate: '2026-12-10',
      lastPaymentDate: '2026-11-11',
      cuotaCategories: ['ABONO TENIS', 'SOCIO INDIVIDUAL'],
      paymentHistory: [{
        date: '2026-11-11',
        amount: 57200,
        status: 'paid',
        periodDueOns: ['2026-11-10'],
        concept: 'Cuota noviembre',
      }],
    };
    const preview = collectionPreview(member, new Date('2026-11-11T15:00:00-03:00'));
    expect(preview.periods).toEqual([]);
    expect(preview.cash).toBe(0);
    expect(preview.clear).toBe(true);
  });

  it('en noviembre un familiar con saldo de $70.000 cobra noviembre con el 10 %, no diciembre', () => {
    setRuntimeTierCatalog([
      { id: 'socio_familiar', name: 'SOCIO FAMILIAR', monthlyDues: 70000, sortOrder: 1 },
    ]);
    const member = {
      memberId: '1',
      name: 'Familiar',
      tier: 'socio_familiar',
      status: 'active',
      outstandingBalance: 70000,
      nextDueDate: '2026-12-10',
    };
    const today = new Date('2026-11-11T12:00:00-03:00');
    const preview = collectionPreview(member, today);
    expect(preview.periods.map((row) => row.dueOn)).toEqual(['2026-11-10']);
    expect(preview.quota).toBe(70000);
    expect(preview.surcharge).toBe(7000);
    expect(preview.cash).toBe(77000);
    expect(preview.quota + preview.surcharge).toBe(preview.cash);
  });

  it('en diciembre sí ofrece la cuota de diciembre', () => {
    setRuntimeTierCatalog([
      { id: 'socio_familiar', name: 'SOCIO FAMILIAR', monthlyDues: 70000, sortOrder: 1 },
    ]);
    const member = {
      memberId: '9624',
      name: 'Gustavo Ariel Alameda',
      tier: 'socio_familiar',
      status: 'active',
      outstandingBalance: 270000,
      nextDueDate: '2026-09-10',
      cuotaCategories: ['SOCIO FAMILIAR'],
    };
    const today = new Date(2026, 11, 5, 12, 0, 0);
    const choices = collectionPeriodChoices(member, today);
    expect(choices.map((row) => row.dueOn)).toEqual([
      '2026-09-10',
      '2026-10-10',
      '2026-11-10',
      '2026-12-10',
    ]);
  });

  it('completa hacia atrás si el saldo pide meses atrasados', () => {
    setRuntimeTierCatalog([
      { id: 'socio_familiar', name: 'SOCIO FAMILIAR', monthlyDues: 70000, sortOrder: 1 },
    ]);
    const member = {
      memberId: '9624',
      name: 'Gustavo Ariel Alameda',
      tier: 'socio_familiar',
      status: 'active',
      outstandingBalance: 260000,
      nextDueDate: '2026-10-10',
      cuotaCategories: ['SOCIO FAMILIAR'],
    };
    const today = new Date(2026, 10, 9, 12, 0, 0);
    const choices = collectionPeriodChoices(member, today);
    expect(choices.map((row) => row.dueOn)).toContain('2026-08-10');
    expect(choices.map((row) => row.dueOn)).toContain('2026-09-10');
    expect(choices.map((row) => row.dueOn)).toContain('2026-10-10');
    expect(choices.map((row) => row.dueOn)).toContain('2026-11-10');
    expect(choices.some((row) => row.dueOn === '2026-12-10')).toBe(false);
    const capital = choices.reduce((sum, row) => sum + (Number(row.capital) || 0), 0);
    expect(capital).toBe(280000);
    const august = choices.find((row) => row.dueOn === '2026-08-10');
    const september = choices.find((row) => row.dueOn === '2026-09-10');
    expect(august).toMatchObject({ capital: 70000, surcharge: 7000, payable: 77000 });
    expect(september).toMatchObject({ capital: 70000, surcharge: 7000, payable: 77000 });
  });

  it('sin nextDue y con una cuota de saldo, el 10 de noviembre ofrece noviembre sin recargo', () => {
    setRuntimeTierCatalog([
      { id: 'socio_familiar', name: 'SOCIO FAMILIAR', monthlyDues: 70000, sortOrder: 1 },
    ]);
    const member = {
      memberId: '1205',
      tier: 'socio_familiar',
      status: 'active',
      outstandingBalance: 70000,
      nextDueDate: null,
      cuotaCategories: ['SOCIO FAMILIAR'],
    };
    const today = new Date(2026, 10, 10, 12, 0, 0);
    const choices = collectionPeriodChoices(member, today);
    expect(choices.map((row) => ({ dueOn: row.dueOn, capital: row.capital, surcharge: row.surcharge, kind: row.kind }))).toEqual([
      { dueOn: '2026-11-10', capital: 70000, surcharge: 0, kind: 'upcoming' },
    ]);
    const preview = collectionPreview(member, today);
    expect(preview.quota).toBe(70000);
    expect(preview.surcharge).toBe(0);
    expect(preview.cash).toBe(70000);
  });

  it('un individual con apertura vieja cobra 40.000, no el saldo más bajo', () => {
    setRuntimeTierCatalog([
      { id: 'socio_individual', name: 'SOCIO INDIVIDUAL', monthlyDues: 40000, sortOrder: 1 },
    ]);
    const member = {
      memberId: '8063',
      tier: 'socio_individual',
      status: 'active',
      outstandingBalance: 28000,
      unpaidCapital: 40000,
      nextDueDate: null,
      cuotaCategories: ['SOCIO INDIVIDUAL'],
    };
    const today = new Date(2026, 10, 10, 12, 0, 0);
    const choices = collectionPeriodChoices(member, today);
    expect(choices).toHaveLength(1);
    expect(choices[0].dueOn).toBe('2026-11-10');
    expect(choices[0].capital).toBe(40000);
    expect(choices[0].surcharge).toBe(0);
  });

  it('un saldo sin vencimiento de tres cuotas de $40.000 no inventa septiembre a $36.000', () => {
    setRuntimeTierCatalog([
      { id: 'socio_individual', name: 'SOCIO INDIVIDUAL', monthlyDues: 40000, sortOrder: 1 },
    ]);
    const member = {
      memberId: '101202',
      tier: 'socio_individual',
      status: 'active',
      outstandingBalance: 128000,
      unpaidCapital: 120400,
      unpaidSurcharges: 7600,
      nextDueDate: null,
      cuotaCategories: ['SOCIO INDIVIDUAL'],
    };
    const today = new Date(2026, 10, 10, 12, 0, 0);
    const choices = collectionPeriodChoices(member, today);
    expect(choices.map((row) => ({
      dueOn: row.dueOn,
      capital: row.capital,
      surcharge: row.surcharge,
      kind: row.kind,
    }))).toEqual([
      { dueOn: '2026-09-10', capital: 40000, surcharge: 4000, kind: 'overdue' },
      { dueOn: '2026-10-10', capital: 40000, surcharge: 4000, kind: 'overdue' },
      { dueOn: '2026-11-10', capital: 40000, surcharge: 0, kind: 'upcoming' },
    ]);
    const preview = collectionPreview(member, today);
    expect(preview.quota).toBe(120000);
    expect(preview.surcharge).toBe(8000);
    expect(preview.cash).toBe(128000);
  });

  it('capital con un mes a tarifa vieja no inventa agosto ni baja septiembre', () => {
    setRuntimeTierCatalog([
      { id: 'socio_individual', name: 'SOCIO INDIVIDUAL', monthlyDues: 40000, sortOrder: 1 },
    ]);
    const member = {
      memberId: '7037',
      name: 'Ivana Campos',
      tier: 'socio_individual',
      status: 'active',
      outstandingBalance: 123600,
      unpaidCapital: 116000,
      unpaidSurcharges: 7600,
      nextDueDate: null,
      cuotaCategories: ['SOCIO INDIVIDUAL'],
    };
    const today = new Date(2026, 10, 10, 12, 0, 0);
    const choices = collectionPeriodChoices(member, today);
    expect(choices.map((row) => ({
      dueOn: row.dueOn,
      capital: row.capital,
      surcharge: row.surcharge,
      kind: row.kind,
    }))).toEqual([
      { dueOn: '2026-09-10', capital: 40000, surcharge: 4000, kind: 'overdue' },
      { dueOn: '2026-10-10', capital: 40000, surcharge: 4000, kind: 'overdue' },
      { dueOn: '2026-11-10', capital: 40000, surcharge: 0, kind: 'upcoming' },
    ]);
    expect(choices.map((row) => row.lateBase)).toEqual([40000, 40000, 40000]);
    expect(choices.some((row) => row.dueOn === '2026-08-10')).toBe(false);
  });

  it('un último pago viejo no reabre agosto cuando el saldo no tiene vencimiento', () => {
    setRuntimeTierCatalog([
      { id: 'socio_individual', name: 'SOCIO INDIVIDUAL', monthlyDues: 40000, sortOrder: 1 },
    ]);
    const member = {
      memberId: '7037',
      name: 'Ivana Campos',
      tier: 'socio_individual',
      status: 'active',
      outstandingBalance: 123600,
      unpaidCapital: 116000,
      unpaidSurcharges: 7600,
      nextDueDate: null,
      lastPaymentDate: '2026-06-13',
      cuotaCategories: ['SOCIO INDIVIDUAL'],
    };
    const today = new Date(2026, 10, 10, 12, 0, 0);
    const choices = collectionPeriodChoices(member, today);
    const withoutTier = collectionPeriodChoices({ ...member, tier: '' }, today);
    expect(withoutTier.map((row) => row.lateBase)).toEqual([40000, 40000, 40000]);
    expect(choices.map((row) => row.dueOn)).toEqual(['2026-09-10', '2026-10-10', '2026-11-10']);
    expect(choices.some((row) => row.dueOn.startsWith('2026-08'))).toBe(false);
  });
});
