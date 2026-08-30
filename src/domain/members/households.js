/**
 * Relación titular ↔ grupo familiar del padrón datita.
 * Integrante: tiene familyPrincipalNumber distinto de su propio nro.
 * Titular: el resto (incluye individuales y jefes de grupo).
 */

export function familyPrincipalOf(member) {
  const raw = member?.familyPrincipalNumber ?? member?.meta?.familyPrincipalNumber;
  if (raw == null || raw === '') return null;
  const n = Number.parseInt(String(raw).replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? String(n) : null;
}

export function memberNumberOf(member) {
  const raw = member?.memberId ?? member?.member_number;
  if (raw == null || raw === '') return null;
  return String(raw).replace(/\D/g, '') || String(raw);
}

/** Integrante cargado bajo otro socio titular. */
export function isFamilyDependent(member) {
  const principal = familyPrincipalOf(member);
  const self = memberNumberOf(member);
  if (!principal || !self) return false;
  return principal !== self;
}

export function isTitularMember(member) {
  return !isFamilyDependent(member);
}

/** Forma de adherente para UI / ficha a partir de un socio del padrón. */
export function householdMemberAsAdherent(member, relationship = 'Grupo familiar') {
  return {
    id: member.id || `gf-${memberNumberOf(member)}`,
    name: member.name || member.full_name || '—',
    relationship,
    tier: member.tier,
    status: member.status || 'active',
    outstandingBalance: Number(member.outstandingBalance) || 0,
    disciplines: member.disciplines || [],
    photo: member.photo || member.photo_url || null,
    memberId: memberNumberOf(member),
    fromPadron: true,
  };
}

/** Integrantes del padrón cuyo titular es `principalId`. */
export function listHouseholdIntegrantes(members = [], principalId) {
  const key = String(principalId || '').replace(/\D/g, '');
  if (!key) return [];
  return (members || []).filter(
    (m) => isFamilyDependent(m) && familyPrincipalOf(m) === key
  );
}

/**
 * Adjunta integrantes del padrón como adherentes del titular
 * (sin pisar adherentes ya cargados en member_adherents).
 */
export function attachHouseholdToMembers(members = []) {
  const list = Array.isArray(members) ? members : [];
  const byPrincipal = new Map();
  for (const m of list) {
    if (!isFamilyDependent(m)) continue;
    const p = familyPrincipalOf(m);
    if (!p) continue;
    if (!byPrincipal.has(p)) byPrincipal.set(p, []);
    byPrincipal.get(p).push(m);
  }
  if (!byPrincipal.size) return list;

  return list.map((m) => {
    const self = memberNumberOf(m);
    const household = self ? (byPrincipal.get(self) || []) : [];
    if (!household.length) return m;

    const existing = m.adherents || [];
    const seen = new Set(
      existing.flatMap((a) => [String(a.memberId || ''), String(a.id || '')].filter(Boolean))
    );
    const extras = household
      .filter((h) => {
        const id = memberNumberOf(h);
        return id && !seen.has(id) && !seen.has(String(h.id || ''));
      })
      .map((h) => householdMemberAsAdherent(h));

    if (!extras.length) return m;
    return { ...m, adherents: [...existing, ...extras] };
  });
}

/**
 * Familia a mostrar en ficha: adherentes del titular, o titular + hermanos si es integrante.
 */
export function resolveFamilyForDisplay(member, allMembers = []) {
  if (!member) return { titular: null, members: [] };

  if (isFamilyDependent(member)) {
    const principalId = familyPrincipalOf(member);
    const titular = (allMembers || []).find((m) => memberNumberOf(m) === principalId) || null;
    const siblings = listHouseholdIntegrantes(allMembers, principalId)
      .filter((m) => memberNumberOf(m) !== memberNumberOf(member));
    const fromPadron = [
      ...(titular ? [householdMemberAsAdherent(titular, 'Titular')] : []),
      ...siblings.map((m) => householdMemberAsAdherent(m)),
    ];
    const manual = (member.adherents || []).filter((a) => !a.fromPadron);
    return { titular, members: [...fromPadron, ...manual] };
  }

  const attached = member.adherents || [];
  if (attached.some((a) => a.fromPadron) || !allMembers.length) {
    return { titular: member, members: attached };
  }
  const live = listHouseholdIntegrantes(allMembers, memberNumberOf(member))
    .map((m) => householdMemberAsAdherent(m));
  const seen = new Set(attached.map((a) => String(a.memberId || a.id || '')));
  const extras = live.filter((a) => !seen.has(String(a.memberId || '')));
  return { titular: member, members: [...attached, ...extras] };
}

/**
 * Stats de padrón respetando hogares: titulares + integrantes.
 */
export function buildPadronHouseholdStats(members = [], { tierCatalog = [] } = {}) {
  const list = Array.isArray(members) ? members : [];
  const titulares = [];
  const integrantes = [];

  for (const m of list) {
    if (isFamilyDependent(m)) integrantes.push(m);
    else titulares.push(m);
  }

  const groupsWithMembers = new Set();
  for (const m of integrantes) {
    const p = familyPrincipalOf(m);
    if (p) groupsWithMembers.add(p);
  }

  const catalogById = new Map(
    (tierCatalog || []).map((t) => [String(t.id || '').toLowerCase(), t])
  );

  const byTierMap = new Map();
  for (const m of titulares) {
    const id = String(m.tier || 'sin_categoria').toLowerCase();
    const prev = byTierMap.get(id) || {
      id,
      name: catalogById.get(id)?.name || String(m.tier || 'Sin categoría'),
      color: catalogById.get(id)?.color || '#94a3b8',
      count: 0,
    };
    prev.count += 1;
    byTierMap.set(id, prev);
  }

  const byTier = [...byTierMap.values()].sort((a, b) => b.count - a.count);

  return {
    total: list.length,
    titulares: titulares.length,
    integrantes: integrantes.length,
    gruposFamiliares: groupsWithMembers.size,
    byTier,
  };
}
