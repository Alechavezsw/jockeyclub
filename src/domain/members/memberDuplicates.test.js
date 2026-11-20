import { describe, expect, it } from 'vitest';
import {
  documentsLikelySame,
  filterOperationalSearchHits,
  findDuplicateMemberGroups,
  membersLikelySamePerson,
  shouldHideDuplicateFromOperationalSearch,
} from './memberDuplicates.js';

describe('memberDuplicates', () => {
  const rutActive = {
    memberId: '12143',
    name: 'Rut Tamara Yacante Jaled',
    documentNumber: '38593056',
    status: 'active',
    outstandingBalance: 70000,
  };
  const rutInactive = {
    memberId: '10698',
    name: 'Rut Tamara Yacante Jaled',
    documentNumber: '3859356',
    status: 'inactive',
    outstandingBalance: 376100.78,
    historicalDuplicate: true,
    canonicalMemberNumber: '12143',
  };
  const yashira = {
    memberId: '12144',
    name: 'Yashira Elizabet Yacante Jaled',
    documentNumber: '42235280',
    status: 'active',
  };

  it('reconoce DNI truncado de Rut 10698 vs 12143', () => {
    expect(documentsLikelySame('3859356', '38593056')).toBe(true);
    expect(membersLikelySamePerson(rutActive, rutInactive)).toBe(true);
    expect(membersLikelySamePerson(rutActive, yashira)).toBe(false);
  });

  it('no fusiona solo por apellido común', () => {
    expect(membersLikelySamePerson(
      { memberId: '1', name: 'Claudia Mabel Yacante Allende', documentNumber: '24234222' },
      { memberId: '2', name: 'Agustina Yacante', documentNumber: '31366347' },
    )).toBe(false);
  });

  it('oculta 10698 en padrón aunque no venga 12143 en la misma página', () => {
    expect(shouldHideDuplicateFromOperationalSearch(rutInactive, { peers: [rutInactive], query: 'yacante' })).toBe(true);
    const hits = [rutActive, rutInactive, yashira];
    expect(shouldHideDuplicateFromOperationalSearch(rutActive, { peers: hits, query: 'yacante' })).toBe(false);
    expect(filterOperationalSearchHits(hits, 'yacante').map((m) => m.memberId)).toEqual(['12143', '12144']);
  });

  it('permite abrir la baja si buscan el Nº exacto 10698', () => {
    expect(shouldHideDuplicateFromOperationalSearch(rutInactive, {
      peers: [rutActive, rutInactive],
      query: '10698',
    })).toBe(false);
  });

  it('agrupa duplicados sin inventar deuda transferida', () => {
    const groups = findDuplicateMemberGroups([rutActive, rutInactive, yashira]);
    expect(groups).toHaveLength(1);
    expect(groups[0].canonicalMemberNumber).toBe('12143');
    expect(groups[0].members.map((m) => m.memberNumber).toSorted()).toEqual(['10698', '12143']);
    expect(groups[0].members.find((m) => m.memberNumber === '10698').outstandingBalance).toBe(376100.78);
  });
});
