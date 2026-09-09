import { describe, expect, it } from 'vitest';
import {
  ACCESSIN_FAMILY_GROUP_BALANCES_AS_OF,
  ACCESSIN_FAMILY_GROUP_BALANCES_SNAPSHOT,
  lookupFamilyGroupBalance,
} from './familyGroupBalances';
import { familyBalanceForMember } from './memberBalances';

describe('familyGroupBalances', () => {
  it('carga snapshot LILA de grupos familiares', () => {
    expect(ACCESSIN_FAMILY_GROUP_BALANCES_AS_OF).toBe('2026-09-03');
    expect(ACCESSIN_FAMILY_GROUP_BALANCES_SNAPSHOT.groupCount).toBeGreaterThan(700);
    expect(ACCESSIN_FAMILY_GROUP_BALANCES_SNAPSHOT.withBalance).toBeGreaterThan(200);
  });

  it('lookup por nombre y por nro de socio 11017', () => {
    const byName = lookupFamilyGroupBalance({ name: 'GF - Rodriguez 11017' });
    const byNumber = lookupFamilyGroupBalance({ memberNumber: '11017' });
    expect(byName?.total).toBe(0);
    expect(byNumber?.name).toMatch(/11017/);
    expect(byNumber?.months.length).toBeGreaterThanOrEqual(2);
  });

  it('el balance familiar operativo suma saldos vivos del grupo', () => {
    const titular = {
      memberId: '11017',
      name: 'Rodríguez Mariana Andrea',
      familyGroupName: 'GF - Rodriguez 11017',
      outstandingBalance: 60000,
    };
    const fam = familyBalanceForMember(titular, [titular]);
    expect(fam.isTitular).toBe(true);
    expect(fam.source).toBe('ledger');
    expect(fam.amount).toBe(60000);
    expect(fam.officialAmount).toBe(0);
  });

  it('si no hay grupo LILA, suma saldos individuales', () => {
    const titular = {
      memberId: '100',
      name: 'Titular Demo',
      outstandingBalance: 1000,
      adherents: [{ memberId: '101', name: 'Hijo', outstandingBalance: 200, fromPadron: true }],
    };
    expect(familyBalanceForMember(titular, [titular]).amount).toBe(1200);
  });
});
