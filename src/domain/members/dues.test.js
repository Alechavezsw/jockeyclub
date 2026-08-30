import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  applyAutomaticDues,
  afterCollectDues,
  diffAutomaticDues,
  duesAmountForHousehold,
  duesAmountForMember,
  getOverdueMembers,
  getUpcomingDuesMembers,
  toWhatsAppPhone,
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
  { memberId: '1', name: 'A', tier: 'socio_individual', outstandingBalance: 32000, status: 'active', nextDueDate: '2026-06-01' },
  { memberId: '2', name: 'B', tier: 'grupo_familiar_familiar', outstandingBalance: 0, status: 'active', nextDueDate: '2026-07-28' },
  { memberId: '3', name: 'C', tier: 'socio_vitalicio', outstandingBalance: 0, status: 'active', nextDueDate: '2026-09-01' },
  { memberId: '4', name: 'D', tier: 'socio_individual', outstandingBalance: 0, status: 'active', nextDueDate: '2026-07-01' },
];

describe('dues classification', () => {
  const today = new Date('2026-07-23T12:00:00');

  it('detecta cuotas vencidas por saldo', () => {
    const overdue = getOverdueMembers(members, today);
    expect(overdue.map((m) => m.memberId)).toContain('1');
    expect(overdue.map((m) => m.memberId)).toContain('4');
  });

  it('detecta próximas a vencer en 15 días', () => {
    const upcoming = getUpcomingDuesMembers(members, { withinDays: 15, today });
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
    expect(paid.nextDueDate).toBe('2026-08-01');
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

  it('detecta diffs de cuotas automáticas para persistir', () => {
    const updated = applyAutomaticDues(members, today);
    const changed = diffAutomaticDues(members, updated);
    expect(changed.map((m) => m.memberId)).toEqual(['4']);
  });

  it('normaliza teléfonos AR para WhatsApp', () => {
    expect(toWhatsAppPhone('+54 9 264 555-1234')).toBe('5492645551234');
    expect(toWhatsAppPhone('2645551234')).toBe('5492645551234');
  });

  it('no marca “vence hoy” si hay saldo pero la fecha ancla no está vencida', () => {
    const overdue = getOverdueMembers([
      { memberId: 'x', name: 'X', tier: 'socio_individual', outstandingBalance: 1000, status: 'active', nextDueDate: '2026-09-01' },
    ], today);
    expect(overdue[0].daysOverdue).toBeNull();
  });
});
