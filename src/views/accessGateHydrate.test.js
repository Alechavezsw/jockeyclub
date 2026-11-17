import { describe, expect, it } from 'vitest';
import { gateMemberReady, hydrateGateMember } from './AccessControlView';

describe('gateMemberReady', () => {
  it('exige status y algún dato de cuota/saldo', () => {
    expect(gateMemberReady(null)).toBe(false);
    expect(gateMemberReady({ memberId: '1' })).toBe(false);
    expect(gateMemberReady({ memberId: '1', status: 'active' })).toBe(false);
    expect(gateMemberReady({ memberId: '1', status: 'active', unpaidCapital: 0 })).toBe(true);
    expect(gateMemberReady({ memberId: '1', status: 'active', outstandingBalance: 70000 })).toBe(true);
    expect(gateMemberReady({ memberId: '1', status: 'active', nextDueDate: '2026-12-10' })).toBe(true);
  });
});

describe('hydrateGateMember', () => {
  it('usa el padrón en memoria sin ir a la red si ya está listo', async () => {
    const seed = { memberId: '10927', name: 'María' };
    const roster = [{
      memberId: '10927',
      name: 'María Sol',
      status: 'active',
      unpaidCapital: 0,
      outstandingBalance: 0,
      nextDueDate: '2026-12-10',
    }];
    const { member, gateMembers } = await hydrateGateMember(seed, roster);
    expect(member.name).toBe('María Sol');
    expect(member.unpaidCapital).toBe(0);
    expect(gateMembers.some((m) => m.memberId === '10927')).toBe(true);
  });

  it('incluye al titular del grupo familiar desde el roster', async () => {
    const seed = {
      memberId: '200',
      name: 'Hijo',
      status: 'active',
      unpaidCapital: 0,
      meta: { familyPrincipalNumber: '100' },
      category: 'adherente',
    };
    const roster = [
      seed,
      {
        memberId: '100',
        name: 'Titular',
        status: 'active',
        unpaidCapital: 70000,
        outstandingBalance: 70000,
      },
    ];
    const { gateMembers } = await hydrateGateMember(seed, roster);
    expect(gateMembers.some((m) => m.memberId === '100' && m.unpaidCapital === 70000)).toBe(true);
  });
});
