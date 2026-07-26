import { describe, expect, it } from 'vitest';
import {
  applyAutomaticDues,
  afterCollectDues,
  duesAmountForHousehold,
  duesAmountForMember,
  getOverdueMembers,
  getUpcomingDuesMembers,
} from './dues';

const members = [
  { memberId: '1', name: 'A', tier: 'gold', outstandingBalance: 32000, status: 'active', nextDueDate: '2026-06-01' },
  { memberId: '2', name: 'B', tier: 'platinum', outstandingBalance: 0, status: 'active', nextDueDate: '2026-07-28' },
  { memberId: '3', name: 'C', tier: 'royal', outstandingBalance: 0, status: 'active', nextDueDate: '2026-09-01' },
  { memberId: '4', name: 'D', tier: 'gold', outstandingBalance: 0, status: 'active', nextDueDate: '2026-07-01' },
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
    expect(duesAmountForHousehold('gold', [])).toBe(32000);
    expect(duesAmountForHousehold('gold', [{ tier: 'gold' }, { tier: 'platinum' }])).toBe(32000 + 32000 + 38000);
  });

  it('calcula cuota del socio con adherentes activos', () => {
    expect(duesAmountForMember({
      tier: 'royal',
      adherents: [
        { tier: 'royal', status: 'active' },
        { tier: 'gold', status: 'inactive' },
      ],
    })).toBe(45000 + 45000);
  });
});
