import { describe, expect, it } from 'vitest';
import { buildLiveFamilyGroupBalances, liveFamilyBalanceForMember } from './liveFamilyGroupBalances';

const titular = {
  memberId: '100',
  name: 'Juan Titular',
  lastName: 'Titular',
  tier: 'socio_familiar',
  status: 'active',
  familyGroupName: 'Familia Titular',
  outstandingBalance: 40000,
  lastPaymentDate: '2026-09-13',
  nextDueDate: '2026-10-10',
};

const hijo = {
  memberId: '101',
  name: 'Pedro Hijo',
  tier: 'socio_familiar',
  status: 'active',
  familyPrincipalNumber: '100',
  outstandingBalance: 15000,
};

describe('liveFamilyGroupBalances', () => {
  it('suma el saldo vivo del titular y los integrantes', () => {
    const book = buildLiveFamilyGroupBalances([titular, hijo], { today: '2026-10-19' });
    expect(book.groups).toHaveLength(1);
    expect(book.groups[0].total).toBe(55000);
    expect(book.groups[0].size).toBe(2);
  });

  it('marca titular con el saldo del grupo', () => {
    const family = liveFamilyBalanceForMember(titular, [titular, hijo]);
    expect(family.isTitular).toBe(true);
    expect(family.amount).toBe(55000);
  });
});
