import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  applyAutomaticDues,
  afterCollectDues,
  diffAutomaticDues,
  duesAmountForHousehold,
  duesAmountForMember,
  getOverdueMembers,
  getUpcomingDuesMembers,
  quotaHeadline,
  toWhatsAppPhone,
  buildWhatsAppDuesUrl,
  nextDuesDueDate,
  pinDuesDueDate,
  monthsBehindOnDues,
  firstUnpaidDuesDate,
  formatMonthsBehind,
} from './dues';
import { setRuntimeTierCatalog } from './tiers';

const testCatalog = [
  { id: 'socio_individual', name: 'SOCIO INDIVIDUAL', monthlyDues: 32000, sortOrder: 1 },
  { id: 'grupo_familiar_familiar', name: 'GRUPO FAMILIAR (Familiar)', monthlyDues: 38000, sortOrder: 2 },
  { id: 'socio_vitalicio', name: 'SOCIO (Vitalicio)', monthlyDues: 45000, sortOrder: 3 },
];

beforeEach(() => setRuntimeTierCatalog(testCatalog));
afterEach(() => setRuntimeTierCatalog(null));

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

  it('detecta próximas a vencer antes del día 10', () => {
    const upcoming = getUpcomingDuesMembers(members, { withinDays: 20, today });
    expect(upcoming.map((m) => m.memberId)).toEqual(['2']);
  });

  it('genera deuda automática al vencer sin saldo previo', () => {
    const updated = applyAutomaticDues(members, today);
    expect(updated.find((m) => m.memberId === '4').outstandingBalance).toBe(32000);
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

  it('no marca “vence hoy” si hay saldo pero la fecha ancla no está vencida', () => {
    const overdue = getOverdueMembers([
      { memberId: 'x', name: 'X', tier: 'socio_individual', outstandingBalance: 1000, status: 'active', nextDueDate: '2026-09-01' },
    ], today);
    expect(overdue[0].daysOverdue).toBeNull();
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
