import { describe, expect, it } from 'vitest';
import {
  isFamilyDependent,
  isTitularMember,
  buildPadronHouseholdStats,
  attachHouseholdToMembers,
  resolveFamilyForDisplay,
} from './households';

const catalog = [
  { id: 'socio_familiar', name: 'SOCIO FAMILIAR', color: '#cfa13a' },
  { id: 'grupo_familiar_familiar', name: 'GRUPO FAMILIAR (Familiar)', color: '#f59e0b' },
  { id: 'socio_individual', name: 'SOCIO INDIVIDUAL', color: '#10b981' },
];

describe('households', () => {
  const titular = {
    memberId: '10009',
    name: 'Titular Rojo',
    tier: 'socio_familiar',
    familyPrincipalNumber: 10009,
    familyGroupName: 'GF - Rojo',
    adherents: [],
  };
  const hijo = {
    memberId: '3501',
    name: 'Milagros Rojo',
    tier: 'grupo_familiar_familiar',
    familyPrincipalNumber: 10009,
    familyGroupName: 'GF - Rojo',
  };
  const hija = {
    memberId: '4928',
    name: 'Juan Rojo',
    tier: 'grupo_familiar_familiar',
    familyPrincipalNumber: 10009,
    familyGroupName: 'GF - Rojo',
  };
  const individual = {
    memberId: '2270',
    name: 'Solo',
    tier: 'socio_individual',
  };

  it('distingue titular de integrante', () => {
    expect(isTitularMember(titular)).toBe(true);
    expect(isFamilyDependent(hijo)).toBe(true);
    expect(isTitularMember(individual)).toBe(true);
  });

  it('resume padrón por hogares', () => {
    const stats = buildPadronHouseholdStats([titular, hijo, individual], { tierCatalog: catalog });
    expect(stats.total).toBe(3);
    expect(stats.titulares).toBe(2);
    expect(stats.integrantes).toBe(1);
    expect(stats.gruposFamiliares).toBe(1);
    expect(stats.byTier.map((t) => t.id)).toEqual(['socio_familiar', 'socio_individual']);
  });

  it('asocia integrantes como adherentes del titular', () => {
    const linked = attachHouseholdToMembers([titular, hijo, hija, individual]);
    const t = linked.find((m) => m.memberId === '10009');
    expect(t.adherents).toHaveLength(2);
    expect(t.adherents.map((a) => a.memberId).sort()).toEqual(['3501', '4928']);
    expect(t.adherents[0].fromPadron).toBe(true);
  });

  it('en ficha de integrante muestra titular y hermanos', () => {
    const all = attachHouseholdToMembers([titular, hijo, hija]);
    const family = resolveFamilyForDisplay(hijo, all);
    expect(family.titular.memberId).toBe('10009');
    expect(family.members.some((m) => m.relationship === 'Titular')).toBe(true);
    expect(family.members.some((m) => m.memberId === '4928')).toBe(true);
  });
});
