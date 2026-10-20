import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  applyAutomaticDues,
  afterCollectDues,
  diffAutomaticDues,
  duesAmountForHousehold,
  duesAmountForMember,
  duesPayableAmount,
  duesPayableForMember,
  getOverdueMembers,
  getDueTodayMembers,
  getUpcomingDuesMembers,
  quotaHeadline,
  isVitalicioMember,
  isDuesExemptMember,
  toWhatsAppPhone,
  buildWhatsAppDuesUrl,
  nextDuesDueDate,
  pinDuesDueDate,
  duesDueMoment,
  monthsBehindOnDues,
  firstUnpaidDuesDate,
  formatMonthsBehind,
} from './dues';
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
  { memberId: '2', name: 'B', tier: 'grupo_familiar_familiar', outstandingBalance: 0, status: 'active', nextDueDate: '2026-08-10' },
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
    expect(updated.find((m) => m.memberId === '4').outstandingBalance).toBe(35200);
    expect(updated.find((m) => m.memberId === '1').outstandingBalance).toBe(32000);
    expect(updated.find((m) => m.memberId === '2').outstandingBalance).toBe(0);
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

  it('suma cuota del titular y adherentes al alta', () => {
    expect(duesAmountForHousehold('socio_individual', [])).toBe(32000);
    expect(duesAmountForHousehold('socio_individual', [
      { tier: 'socio_individual' },
      { tier: 'grupo_familiar_familiar' },
    ])).toBe(32000 + 32000 + 38000);
  });

  it('calcula cuota del socio con adherentes activos', () => {
    expect(duesAmountForMember({
      tier: 'socio_vitalicio',
      adherents: [
        { tier: 'socio_vitalicio', status: 'active' },
        { tier: 'socio_individual', status: 'inactive' },
      ],
    })).toBe(45000 + 45000);
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
    expect(changed.map((m) => m.memberId)).toEqual(['4']);
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
    expect(duesAmountForMember({ tier: 'abono_tenis', adherents: [] }, october)).toBe(10000);
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
    }, october)).toBe(80000);
  });

  it('en septiembre no reemplaza la cuota que ya estaba en el catálogo', () => {
    expect(duesAmountForMember({
      tier: 'socio_individual',
      adherents: [],
    }, new Date('2026-09-29T12:00:00'))).toBe(32000);
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
    expect(duesPayableAmount(68250, { paidOn: '2026-10-11', dueOn: '2026-10-10', tier: 'socio_familiar_amet' })).toBe(68250);
    expect(duesPayableAmount(10000, { paidOn: '2026-10-11', dueOn: '2026-10-10', tier: 'abono_tenis' })).toBe(10000);
    expect(applyAutomaticDues([member], new Date('2026-10-10T12:00:00'))[0].outstandingBalance).toBe(0);
    expect(applyAutomaticDues([member], afterDue)[0].outstandingBalance).toBe(44000);
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

  it('prioriza el último pago aunque nextDueDate esté más adelante', () => {
    expect(monthsBehindOnDues({
      lastPaymentDate: '2026-08-13',
      nextDueDate: '2026-10-10',
      today,
    })).toBe(1);
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
