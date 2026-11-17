import { describe, expect, it } from 'vitest';
import { collectMemberMeta } from './memberAdminActions';
import { memberFromRow, memberToRow } from '../../data/mappers';
import { detachMemberFromFamilyGroup, isFamilyDependent } from './households';

/**
 * Mismo shape que MemberProfilePanel.persistNewFamilyMember → upsertMember.
 * Garantiza que familyPrincipalNumber llega a meta (fuente de verdad del hogar).
 */
describe('alta de familiar (payload cloud)', () => {
  it('persiste el vínculo al titular en meta y sobrevive el roundtrip', () => {
    const familyPrincipalNumber = 111635;
    const groupName = 'Grupo 111635';
    const newMember = {
      name: 'Familiar de Prueba',
      memberId: '99999111636',
      documentType: 'DNI',
      documentNumber: '90909091',
      birthDate: '2012-05-10',
      phone: '',
      email: '',
      tier: 'grupo_familiar_familiar',
      disciplines: [],
      photo: '',
      relationship: 'Grupo familiar',
      status: 'active',
      joinDate: '2026-11-16',
      outstandingBalance: 0,
      yearsActive: 0,
      familyPrincipalNumber,
      familyGroupName: groupName,
      adherents: [],
      meta: collectMemberMeta({
        familyPrincipalNumber,
        familyGroupName: groupName,
      }),
    };

    const row = memberToRow(newMember);
    row.meta = { ...collectMemberMeta(newMember), ...(row.meta || {}) };

    expect(row.member_number).toBe('99999111636');
    expect(row.tier).toBe('grupo_familiar_familiar');
    expect(row.meta.familyPrincipalNumber).toBe(111635);
    expect(row.meta.familyGroupName).toBe(groupName);

    const ui = memberFromRow({
      ...row,
      id: '00000000-0000-4000-8000-000000000001',
      member_adherents: [],
    }, []);

    expect(String(ui.familyPrincipalNumber)).toBe('111635');
    expect(ui.familyGroupName).toBe(groupName);
    expect(ui.tier).toBe('grupo_familiar_familiar');
    expect(ui.name).toBe('Familiar de Prueba');
  });

  it('collectMemberMeta copia familyPrincipalNumber desde el top-level', () => {
    const meta = collectMemberMeta({
      familyPrincipalNumber: 111635,
      familyGroupName: 'Grupo 111635',
      name: 'no-va-a-meta',
    });
    expect(meta.familyPrincipalNumber).toBe(111635);
    expect(meta.familyGroupName).toBe('Grupo 111635');
    expect(meta.name).toBeUndefined();
  });

  it('sacar del grupo limpia el vínculo en el payload cloud', () => {
    const linked = {
      name: 'Familiar de Prueba',
      memberId: '99999111636',
      tier: 'grupo_familiar_familiar',
      status: 'active',
      familyPrincipalNumber: 111635,
      familyGroupName: 'Grupo 111635',
      meta: collectMemberMeta({
        familyPrincipalNumber: 111635,
        familyGroupName: 'Grupo 111635',
      }),
    };
    const detached = detachMemberFromFamilyGroup(linked);
    const row = memberToRow(detached);
    row.meta = { ...collectMemberMeta(detached), ...(row.meta || {}) };
    expect(isFamilyDependent(detached)).toBe(false);
    expect(row.tier).toBe('socio_individual');
    expect(row.meta.familyPrincipalNumber).toBeUndefined();
    expect(row.meta.familyGroupName).toBeUndefined();

    const ui = memberFromRow({
      ...row,
      id: '00000000-0000-4000-8000-000000000002',
      member_adherents: [],
    }, []);
    expect(ui.familyPrincipalNumber == null || ui.familyPrincipalNumber === '').toBe(true);
    expect(isFamilyDependent(ui)).toBe(false);
  });
});
