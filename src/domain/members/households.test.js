import { describe, expect, it } from 'vitest';
import {
  isFamilyDependent,
  isTitularMember,
  buildPadronHouseholdStats,
  attachHouseholdToMembers,
  resolveFamilyForDisplay,
  allocateNextMemberNumber,
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
    expect(stats.titularesActivos).toBe(2);
    expect(stats.integrantes).toBe(1);
    expect(stats.gruposFamiliares).toBe(1);
    expect(stats.byTier.map((t) => t.id)).toEqual(['socio_familiar', 'socio_individual']);
  });

  it('omite categorías de ejemplo y pinta cada card de un color', () => {
    const stats = buildPadronHouseholdStats([
      titular,
      individual,
      { memberId: '9', name: 'Demo Gold', tier: 'gold', status: 'active' },
      { memberId: '8', name: 'Demo Royal', tier: 'royal', status: 'active' },
    ], { tierCatalog: catalog });
    const ids = stats.byTier.map((t) => t.id);
    expect(ids).not.toContain('gold');
    expect(ids).not.toContain('royal');
    const junk = buildPadronHouseholdStats([
      titular,
      { memberId: '11', name: 'Sin cuota', tier: 'tier_1788997270799', status: 'active' },
      { memberId: '12', name: 'Combo', tier: 'socio_individual_abono_tenis', status: 'active' },
    ], { tierCatalog: catalog });
    expect(junk.byTier.map((t) => t.id)).toEqual(['sin_categoria', 'socio_familiar']);
    const colors = stats.byTier.map((t) => t.color.toLowerCase());
    expect(new Set(colors).size).toBe(colors.length);
    const withReserved = buildPadronHouseholdStats([titular, individual], {
      tierCatalog: catalog,
      reservedColors: ['#cfa13a', '#b8956a'],
    });
    expect(withReserved.byTier.find((t) => t.id === 'socio_familiar')?.color.toLowerCase()).not.toBe('#cfa13a');
  });

  it('asocia integrantes como adherentes del titular', () => {
    const linked = attachHouseholdToMembers([titular, hijo, hija, individual]);
    const t = linked.find((m) => m.memberId === '10009');
    expect(t.adherents).toHaveLength(2);
    expect(t.adherents.map((a) => a.memberId).sort()).toEqual(['3501', '4928']);
    expect(t.adherents[0].fromPadron).toBe(true);
  });

  it('asigna credencial siguiente sin usar números random largos', () => {
    expect(allocateNextMemberNumber([titular, hijo, { memberId: '2026887744320988' }])).toBe('10010');
    expect(allocateNextMemberNumber([])).toBe('10001');
  });

  it('en ficha de integrante muestra titular y hermanos', () => {
    const all = attachHouseholdToMembers([titular, hijo, hija]);
    const family = resolveFamilyForDisplay(hijo, all);
    expect(family.titular.memberId).toBe('10009');
    expect(family.members.some((m) => m.relationship === 'Titular')).toBe(true);
    expect(family.members.some((m) => m.memberId === '4928')).toBe(true);
  });
});
