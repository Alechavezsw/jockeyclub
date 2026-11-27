import { describe, expect, it } from 'vitest';
import {
  billingAccountMember,
  isFamilyDependent,
  isTitularMember,
  memberMayOperateAccount,
  buildPadronHouseholdStats,
  attachHouseholdToMembers,
  resolveFamilyForDisplay,
  allocateNextMemberNumber,
  applyMemberListRefresh,
  mergeMemberRecord,
  mergeMembersById,
  listFamilyGroups,
  familyGroupMatchesQuery,
  memberMatchesDirectoryQuery,
  rankMemberSearchHit,
  clearFamilyHouseholdLink,
  detachMemberFromFamilyGroup,
  isFamilyGroupVisibleMember,
  prepareFamilyMemberForBaja,
  suggestedTierAfterFamilyDetach,
  householdRoleLabel,
  householdAccountHint,
  householdMemberAsAdherent,
} from './households';

const catalog = [
  { id: 'socio_familiar', name: 'SOCIO FAMILIAR', color: '#cfa13a' },
  { id: 'grupo_familiar_familiar', name: 'GRUPO FAMILIAR (Familiar)', color: '#6d9a8c' },
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
    expect(memberMayOperateAccount(hijo)).toBe(false);
    expect(billingAccountMember(hijo, [titular, hijo])).toEqual(titular);
    expect(billingAccountMember(titular, [titular, hijo])).toEqual(titular);
    expect(billingAccountMember(hijo, [hijo])).toBeNull();
    expect(billingAccountMember(hijo, [])).toBeNull();
    expect(householdRoleLabel(titular, '10009')).toBe('Titular');
    expect(householdRoleLabel(hijo, '10009')).toBe('Integrante');
    expect(householdAccountHint(hijo)).toBe('Cuenta y reservas del titular Nº 10009.');
    expect(householdAccountHint(titular)).toBeNull();
  });

  it('saca al integrante del grupo y lo deja titular individual', () => {
    expect(suggestedTierAfterFamilyDetach(hijo)).toBe('socio_individual');
    expect(suggestedTierAfterFamilyDetach({
      ...hijo,
      tier: 'grupo_familiar_amet',
    })).toBe('socio_individual_amet');

    const next = detachMemberFromFamilyGroup({
      ...hijo,
      relationship: 'Grupo familiar',
      meta: {
        familyPrincipalNumber: 10009,
        familyGroupName: 'GF - Rojo',
        portalUsername: 'milagros',
      },
    });
    expect(isFamilyDependent(next)).toBe(false);
    expect(isTitularMember(next)).toBe(true);
    expect(next.tier).toBe('socio_individual');
    expect(next.familyPrincipalNumber).toBeNull();
    expect(next.familyGroupName).toBeNull();
    expect(next.meta.familyPrincipalNumber).toBeUndefined();
    expect(next.meta.familyGroupName).toBeUndefined();
    expect(next.meta.portalUsername).toBe('milagros');
    expect(next.relationship).toBe('');
    expect(() => detachMemberFromFamilyGroup(titular)).toThrow(/no es integrante/i);
    expect(() => detachMemberFromFamilyGroup(hijo, { tier: 'grupo_familiar_familiar' }))
      .toThrow(/categoría de titular/i);
  });

  it('baja de integrante corta el vínculo del hogar y oculta inactivos del desglose', () => {
    const linked = {
      ...hijo,
      meta: { familyPrincipalNumber: 10009, familyGroupName: 'GF - Rojo' },
    };
    const cleared = clearFamilyHouseholdLink(linked);
    expect(cleared.familyPrincipalNumber).toBeNull();
    expect(isFamilyDependent(cleared)).toBe(false);

    const forBaja = prepareFamilyMemberForBaja(linked);
    expect(isFamilyDependent(forBaja)).toBe(false);
    expect(prepareFamilyMemberForBaja(titular)).toEqual(titular);

    expect(isFamilyGroupVisibleMember({ status: 'active' })).toBe(true);
    expect(isFamilyGroupVisibleMember({ status: 'suspended' })).toBe(true);
    expect(isFamilyGroupVisibleMember({ status: 'inactive' })).toBe(false);
  });

  it('muestra el parentesco guardado en la ficha del integrante', () => {
    expect(householdMemberAsAdherent({
      ...hijo,
      relationship: 'Cónyuge',
    }).relationship).toBe('Cónyuge');
    expect(householdMemberAsAdherent(hijo).relationship).toBe('Grupo familiar');
    expect(householdMemberAsAdherent(titular, 'Titular').relationship).toBe('Titular');
  });

  it('el refresh del padrón puede limpiar familyPrincipalNumber', () => {
    const current = {
      ...hijo,
      recordScope: 'list',
      familyPrincipalNumber: 10009,
      familyGroupName: 'GF - Rojo',
    };
    const merged = mergeMemberRecord(current, {
      memberId: '3501',
      familyPrincipalNumber: null,
      familyGroupName: null,
    });
    expect(merged.familyPrincipalNumber).toBeNull();
    expect(merged.familyGroupName).toBeNull();
  });

  it('resume padrón por hogares', () => {
    const stats = buildPadronHouseholdStats([titular, hijo, individual], { tierCatalog: catalog });
    expect(stats.total).toBe(3);
    expect(stats.titulares).toBe(2);
    expect(stats.titularesActivos).toBe(2);
    expect(stats.integrantes).toBe(1);
    expect(stats.integrantesActivos).toBe(1);
    expect(stats.gruposFamiliares).toBe(1);
    expect(stats.byTier.map((t) => t.id)).toEqual(['socio_familiar', 'socio_individual']);
  });

  it('no mete bajas en los números que se muestran', () => {
    const stats = buildPadronHouseholdStats([
      titular,
      { ...titular, memberId: '10010', name: 'Titular Baja', familyPrincipalNumber: 10010, status: 'inactive' },
      hijo,
      { ...hijo, memberId: '3502', name: 'Hijo Baja', familyPrincipalNumber: 10010, status: 'inactive' },
      individual,
    ], { tierCatalog: catalog });
    expect(stats.titulares).toBe(3);
    expect(stats.titularesActivos).toBe(2);
    expect(stats.integrantes).toBe(2);
    expect(stats.integrantesActivos).toBe(1);
    expect(stats.byTier.find((t) => t.id === 'socio_familiar')?.count).toBe(1);
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

  it('no duplica un familiar que ya está en adherentes por nombre', () => {
    const linked = attachHouseholdToMembers([
      {
        ...titular,
        adherents: [{ id: 'adh-1', name: 'Milagros Rojo', relationship: 'Hijo/a' }],
      },
      hijo,
      hija,
    ]);
    const t = linked.find((m) => m.memberId === '10009');
    const names = t.adherents.map((a) => a.name);
    expect(names.filter((n) => n === 'Milagros Rojo')).toHaveLength(1);
    expect(names).toContain('Juan Rojo');
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

  it('mezcla resultados remotos sin duplicar credencial', () => {
    const merged = mergeMembersById(
      [titular, hijo],
      [{ ...hijo, name: 'Milagros remota' }, individual],
      10,
    );
    expect(merged.map((m) => m.memberId)).toEqual(['10009', '3501', '2270']);
    expect(merged.find((m) => m.memberId === '3501').name).toBe('Milagros Rojo');
  });

  it('arma el padrón de grupos familiares para tocar y ver socios', () => {
    const groups = listFamilyGroups([titular, hijo, hija, individual]);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe('10009');
    expect(groups[0].name).toBe('GF - Rojo');
    expect(groups[0].size).toBe(3);
    expect(groups[0].members.map((m) => m.memberId)).toEqual(['10009', '3501', '4928']);
    expect(groups[0].members[0].role).toBe('titular');
    expect(familyGroupMatchesQuery(groups[0], 'milagros')).toBe(true);
    expect(familyGroupMatchesQuery(groups[0], '2270')).toBe(false);
  });

  it('no usa el Nº como nombre de familia', () => {
    const groups = listFamilyGroups([
      { memberId: '90', name: 'Marta Ruiz', familyGroupName: '90' },
      { memberId: '91', name: 'Pedro Ruiz', familyPrincipalNumber: 90, familyGroupName: '90' },
    ]);
    expect(groups[0].name).toBe('Familia Ruiz');
  });

  it('nombra la familia si no hay grupo LILA', () => {
    const groups = listFamilyGroups([
      { memberId: '80', name: 'Ana Perez' },
      { memberId: '81', name: 'Luis Perez', familyPrincipalNumber: 80 },
    ]);
    expect(groups[0].name).toBe('Familia Perez');
  });

  it('encuentra por acento, orden de palabras, mail, teléfono y motivo', () => {
    const member = {
      memberId: '3501',
      name: 'Juan Pérez',
      documentNumber: '20.123.456',
      email: 'juan.perez@club.com',
      phone: '+54 264 555-1234',
      bajaMotivo: 'Renuncia / baja voluntaria',
      status: 'inactive',
    };
    expect(memberMatchesDirectoryQuery(member, 'perez')).toBe(true);
    expect(memberMatchesDirectoryQuery(member, 'pérez juan')).toBe(true);
    expect(memberMatchesDirectoryQuery(member, '20.123.456')).toBe(true);
    expect(memberMatchesDirectoryQuery(member, 'juan.perez@club.com')).toBe(true);
    expect(memberMatchesDirectoryQuery(member, '2645551234')).toBe(true);
    expect(memberMatchesDirectoryQuery(member, 'renuncia')).toBe(true);
    expect(memberMatchesDirectoryQuery(member, 'zzzz')).toBe(false);
  });

  it('un nombre no coincide con todos por documento vacío', () => {
    const rows = [
      { memberId: '1', name: 'Ana López', documentNumber: '30111222' },
      { memberId: '2', name: 'Luis Gómez', documentNumber: '' },
    ];
    expect(rows.filter((member) => memberMatchesDirectoryQuery(member, 'ana'))).toEqual([rows[0]]);
  });

  it('prioriza el apellido del socio sobre un match débil', () => {
    const q = 'bonilla';
    const socio = { memberId: '1', name: 'Juan Bonilla', status: 'active' };
    const otro = { memberId: '2', name: 'Ana López', email: 'bonilla@club.com', status: 'active' };
    expect(rankMemberSearchHit(socio, q)).toBeLessThan(rankMemberSearchHit(otro, q));
  });

  it('mantiene el padrón visible mientras llega una página y no pisa la ficha', () => {
    const loaded = [
      { memberId: '10009', name: 'Titular', status: 'active', outstandingBalance: 1000, recordScope: 'full', address: 'Calle 1', paymentHistory: [{ id: 'p1' }], adherents: [{ name: 'Hijo' }] },
      { memberId: '3501', name: 'Integrante', status: 'active', outstandingBalance: 0 },
    ];
    const page = [
      { memberId: '10009', name: 'Titular', status: 'inactive', outstandingBalance: 0, recordScope: 'list', address: '', paymentHistory: [], adherents: [], lastPaymentDate: null },
    ];
    const mid = applyMemberListRefresh(loaded, page, { done: false });
    expect(mid.map((m) => m.memberId)).toEqual(['10009', '3501']);
    expect(mid[0].status).toBe('inactive');
    expect(mid[0].outstandingBalance).toBe(0);
    expect(mid[0].address).toBe('Calle 1');
    expect(mid[0].paymentHistory).toEqual([{ id: 'p1' }]);
    expect(mid[0].adherents).toEqual([{ name: 'Hijo' }]);
    expect(mid[0].recordScope).toBe('full');

    const finished = applyMemberListRefresh(mid, page, { done: true });
    expect(finished.map((m) => m.memberId)).toEqual(['10009']);
  });

  it('si el padrón llega mal marcado como ficha, no borra el domicilio', () => {
    const current = {
      memberId: '10009',
      name: 'Titular',
      recordScope: 'full',
      address: 'Calle San Martín 120',
      city: 'Rivadavia',
      paymentHistory: [{ id: 'p1' }],
      adherents: [{ name: 'Hijo' }],
    };
    const incoming = {
      memberId: '10009',
      name: 'Titular',
      status: 'active',
      recordScope: 'full',
      address: '',
      city: '',
      birthDate: '1984-03-02',
      paymentHistory: [],
      adherents: [],
    };
    const merged = mergeMemberRecord(current, incoming);
    expect(merged.address).toBe('Calle San Martín 120');
    expect(merged.city).toBe('Rivadavia');
    expect(merged.birthDate).toBe('1984-03-02');
    expect(merged.paymentHistory).toEqual([{ id: 'p1' }]);
    expect(merged.adherents).toEqual([{ name: 'Hijo' }]);
    expect(merged.recordScope).toBe('full');
  });

  it('suma un socio nuevo al final cuando la recarga termina', () => {
    const loaded = [{ memberId: '10009', name: 'Titular', recordScope: 'list' }];
    const next = applyMemberListRefresh(loaded, [
      { memberId: '10009', name: 'Titular', recordScope: 'list' },
      { memberId: '4928', name: 'Nuevo', recordScope: 'list' },
    ], { done: true });
    expect(next.map((m) => m.memberId)).toEqual(['10009', '4928']);
  });

  it('en ficha de integrante muestra titular y hermanos', () => {
    const all = attachHouseholdToMembers([titular, hijo, hija]);
    const family = resolveFamilyForDisplay(hijo, all);
    expect(family.titular.memberId).toBe('10009');
    expect(family.members.some((m) => m.relationship === 'Titular')).toBe(true);
    expect(family.members.some((m) => m.memberId === '4928')).toBe(true);
  });

  it('en ficha de titular relee el padrón aunque haya adherentes fromPadron viejos', () => {
    const stale = {
      ...titular,
      adherents: [{
        id: 'adh-old',
        name: 'Milagros Rojo',
        memberId: '3501',
        fromPadron: true,
        relationship: 'Grupo familiar',
      }],
    };
    const family = resolveFamilyForDisplay(stale, [stale, hijo, hija]);
    const ids = family.members.map((m) => m.memberId).sort();
    expect(ids).toEqual(['3501', '4928']);
  });

  it('no duplica el mismo integrante por credencial y por nombre', () => {
    const family = resolveFamilyForDisplay(titular, [titular, hijo, hija]);
    const withEcho = {
      ...titular,
      adherents: [
        { id: 'adh-echo', name: 'Milagros Rojo', relationship: 'Grupo familiar' },
        { id: 'adh-echo-2', name: 'Juan Rojo', memberId: '4928', relationship: 'Grupo familiar' },
      ],
    };
    const merged = resolveFamilyForDisplay(withEcho, [withEcho, hijo, hija]);
    expect(merged.members).toHaveLength(2);
    expect(merged.members.map((m) => m.memberId).sort()).toEqual(['3501', '4928']);
    expect(family.members).toHaveLength(2);
  });
});
