import { isExampleMemberTier, isGeneratedTierId, SIN_CATEGORIA_TIER } from './tiers';

/**
 * Relación titular ↔ grupo familiar del padrón datita.
 * Integrante: tiene familyPrincipalNumber distinto de su propio nro.
 * Titular: el resto (incluye individuales y jefes de grupo).
 */

const STAT_COLOR_PALETTE = [
  '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4',
  '#ec4899', '#f59e0b', '#14b8a6', '#f97316', '#6366f1',
  '#84cc16', '#e11d48', '#0ea5e9', '#a855f7', '#22c55e',
  '#2563eb', '#db2777', '#7c3aed', '#d97706', '#65a30d',
];

function hexToRgb(hex = '') {
  const raw = String(hex).trim().replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = Number.parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function colorDistance(a, b) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  if (!A || !B) return 0;
  return Math.hypot(A.r - B.r, A.g - B.g, A.b - B.b);
}

function isTooClose(color, used) {
  const key = String(color || '').toLowerCase();
  if (!key || key === '#94a3b8') return true;
  return used.some((u) => u === key || colorDistance(color, u) < 72);
}

function pickDistinctColor(preferred, used, index) {
  const candidate = String(preferred || '').trim();
  if (candidate && !isTooClose(candidate, used)) return candidate;
  const fromPalette = STAT_COLOR_PALETTE.find((c) => !isTooClose(c, used));
  return fromPalette || STAT_COLOR_PALETTE[index % STAT_COLOR_PALETTE.length];
}

export function assignDistinctStatColors(rows = [], reservedColors = []) {
  const used = reservedColors
    .map((c) => String(c || '').trim().toLowerCase())
    .filter(Boolean);
  return rows.map((row, index) => {
    const color = pickDistinctColor(row.color, used, index);
    used.push(color.toLowerCase());
    return { ...row, color };
  });
}

/** Une listas de socios por credencial, sin pisar la ficha más completa. */
export function mergeMembersById(primary = [], extra = [], limit = Infinity) {
  const seen = new Set();
  const out = [];
  for (const member of [...(primary || []), ...(extra || [])]) {
    const id = String(member?.memberId || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(member);
    if (out.length >= limit) break;
  }
  return out;
}

export function familyPrincipalOf(member) {
  const raw = member?.familyPrincipalNumber ?? member?.meta?.familyPrincipalNumber;
  if (raw == null || raw === '') return null;
  const n = Number.parseInt(String(raw).replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? String(n) : null;
}

export function normalizePersonName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function personDedupeKey(row) {
  const dni = String(row?.documentNumber || row?.document_number || '').replace(/\D/g, '');
  if (dni) return `dni:${dni}`;
  const id = memberNumberOf(row);
  if (id) return `id:${id}`;
  const name = normalizePersonName(row?.name || row?.full_name);
  return name ? `n:${name}` : '';
}

/** Quita personas repetidas en un grupo (mismo DNI, credencial o nombre). */
export function uniqueFamilyMembers(members = []) {
  const seen = new Set();
  const out = [];
  for (const row of members || []) {
    const key = personDedupeKey(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function memberNumberOf(member) {
  const raw = member?.memberId ?? member?.member_number;
  if (raw == null || raw === '') return null;
  return String(raw).replace(/\D/g, '') || String(raw);
}

/**
 * Próxima credencial institucional (1–6 dígitos).
 * Ignora altas random de 16 dígitos para no disparar el correlativo.
 */
export function allocateNextMemberNumber(members = []) {
  const used = new Set();
  let maxClub = 0;
  for (const m of members || []) {
    const id = memberNumberOf(m);
    if (!id) continue;
    used.add(id);
    const n = Number.parseInt(id, 10);
    if (Number.isFinite(n) && n > 0 && n < 1_000_000 && n > maxClub) maxClub = n;
  }
  let next = (maxClub || 10000) + 1;
  while (used.has(String(next))) next += 1;
  return String(next);
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

    const householdKeys = new Set(
      household.flatMap((h) => [personDedupeKey(h), `n:${normalizePersonName(h.name || h.full_name)}`])
        .filter((k) => k && k !== 'n:')
    );
    const existing = (m.adherents || []).filter((a) => {
      const key = personDedupeKey(a);
      const nameKey = `n:${normalizePersonName(a.name)}`;
      return !householdKeys.has(key) && !householdKeys.has(nameKey);
    });
    const extras = household.map((h) => householdMemberAsAdherent(h));
    const adherents = uniqueFamilyMembers([...extras, ...existing]);
    if (!adherents.length) return m;
    return { ...m, adherents };
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
    return { titular, members: uniqueFamilyMembers([...fromPadron, ...manual]) };
  }

  const attached = member.adherents || [];
  if (attached.some((a) => a.fromPadron) || !allMembers.length) {
    return { titular: member, members: uniqueFamilyMembers(attached) };
  }
  const live = listHouseholdIntegrantes(allMembers, memberNumberOf(member))
    .map((row) => householdMemberAsAdherent(row));
  return { titular: member, members: uniqueFamilyMembers([...live, ...attached]) };
}

/**
 * Stats de padrón respetando hogares: titulares + integrantes.
 */
function isUsefulGroupName(value) {
  const s = String(value || '').trim();
  if (s.length < 2) return false;
  return !/^\d+$/.test(s);
}

function familyFallbackName(titular, people, id) {
  const source = titular?.name || people[0]?.name || '';
  const parts = String(source).trim().split(/\s+/).filter((p) => p && p !== '—');
  const last = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  return last ? `Familia ${last}` : `Grupo ${id}`;
}

function asGroupPerson(row) {
  if (!row) return null;
  return {
    id: row.id,
    memberId: memberNumberOf(row) || row.memberId || null,
    name: row.name || row.full_name || '—',
    tier: row.tier,
    status: row.status || 'active',
    documentNumber: row.documentNumber || row.document_number || '',
    phone: row.phone || '',
    outstandingBalance: Number(row.outstandingBalance) || 0,
    photo: row.photo || row.photo_url || null,
    familyGroupName: row.familyGroupName,
    familyPrincipalNumber: familyPrincipalOf(row),
    relationship: row.relationship || null,
    fromPadron: row.fromPadron !== false,
  };
}

/**
 * Hogares reales del padrón: titular + integrantes.
 * Se toca la familia y se ven los socios.
 */
export function listFamilyGroups(members = []) {
  const list = Array.isArray(members) ? members : [];
  const byNumber = new Map();
  for (const m of list) {
    const id = memberNumberOf(m);
    if (id) byNumber.set(id, m);
  }

  const groups = new Map();
  const touch = (key, patch) => {
    if (!key) return;
    const cur = groups.get(key) || { id: key, titular: null, people: [], nameHint: '' };
    if (patch.titular && !cur.titular) cur.titular = patch.titular;
    if (patch.person) cur.people.push(patch.person);
    if (isUsefulGroupName(patch.name) && !cur.nameHint) cur.nameHint = String(patch.name).trim();
    groups.set(key, cur);
  };

  for (const m of list) {
    if (!isFamilyDependent(m)) continue;
    const principal = familyPrincipalOf(m);
    touch(principal, {
      titular: byNumber.get(principal) || null,
      person: m,
      name: m.familyGroupName,
    });
  }

  for (const m of list) {
    if (isFamilyDependent(m)) continue;
    const self = memberNumberOf(m);
    if (!self) continue;
    if (groups.has(self)) {
      const g = groups.get(self);
      g.titular = g.titular || m;
      if (!g.nameHint && isUsefulGroupName(m.familyGroupName)) {
        g.nameHint = String(m.familyGroupName).trim();
      }
      continue;
    }
    const extras = (m.adherents || []).filter(Boolean);
    if (!extras.length) continue;
    touch(self, { titular: m, name: m.familyGroupName });
    for (const extra of extras) {
      const linked = extra.memberId ? byNumber.get(String(extra.memberId).replace(/\D/g, '')) : null;
      touch(self, { person: linked || extra });
    }
  }

  const out = [];
  for (const g of groups.values()) {
    const rawPeople = uniqueFamilyMembers([
      ...(g.titular ? [g.titular] : []),
      ...g.people,
    ]);
    const people = rawPeople.map(asGroupPerson).filter(Boolean);
    if (people.length < 2) continue;
    const titularId = memberNumberOf(g.titular) || g.id;
    const named = [g.nameHint, g.titular?.familyGroupName, people.find((p) => isUsefulGroupName(p.familyGroupName))?.familyGroupName]
      .find(isUsefulGroupName);
    const name = named || familyFallbackName(g.titular, people, g.id);
    out.push({
      id: g.id,
      name,
      titular: g.titular ? asGroupPerson(g.titular) : null,
      members: people.map((p) => ({
        ...p,
        role: String(p.memberId || '') === String(titularId) ? 'titular' : 'integrante',
      })),
      size: people.length,
      phone: g.titular?.phone || people.find((p) => p.phone)?.phone || '',
      tier: g.titular?.tier || people[0]?.tier,
      status: g.titular?.status || people[0]?.status || 'active',
      outstandingBalance: Number(g.titular?.outstandingBalance) || 0,
    });
  }

  return out.toSorted((a, b) => (
    String(a.name || '').localeCompare(String(b.name || ''), 'es')
    || String(a.id).localeCompare(String(b.id), 'es', { numeric: true })
  ));
}

/** Menor = más relevante. Prioriza coincidencia de nombre de socio. */
export function rankMemberSearchHit(member, query) {
  const raw = String(query || '').trim();
  if (!raw) return 50;
  const q = raw.toLowerCase();
  const digits = raw.replace(/\D/g, '');
  const name = String(member?.name || '').toLowerCase();
  const words = name.split(/\s+/).filter(Boolean);
  const id = String(member?.memberId || '');
  const dni = String(member?.documentNumber || '').replace(/\D/g, '');
  const titularBoost = isTitularMember(member) ? 0 : 8;

  if (digits && (id === digits || dni === digits)) return 0 + titularBoost;
  if (name === q) return 1 + titularBoost;
  if (name.startsWith(q)) return 2 + titularBoost;
  if (words.some((word) => word.startsWith(q))) return 3 + titularBoost;
  if (name.includes(q)) return 4 + titularBoost;
  if (digits && (id.includes(digits) || dni.includes(digits))) return 12;
  return 20;
}

export function familyGroupMatchesQuery(group, query) {
  const raw = String(query || '').trim();
  if (!raw) return true;
  const q = raw.toLowerCase();
  const digits = raw.replace(/\D/g, '');
  if (String(group?.name || '').toLowerCase().includes(q)) return true;
  if (digits && String(group?.id || '').includes(digits)) return true;
  return (group?.members || []).some((m) => {
    const name = String(m.name || '').toLowerCase();
    const id = String(m.memberId || '');
    const dni = String(m.documentNumber || '').replace(/\D/g, '');
    const phone = String(m.phone || '');
    return name.includes(q)
      || (digits && (id.includes(digits) || dni.includes(digits)))
      || phone.includes(raw);
  });
}

export function buildPadronHouseholdStats(members = [], { tierCatalog = [], reservedColors = [] } = {}) {
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
    let id = String(m.tier || SIN_CATEGORIA_TIER).toLowerCase();
    if (isExampleMemberTier(id)) continue;
    if (isGeneratedTierId(id) || !catalogById.has(id)) id = SIN_CATEGORIA_TIER;
    const catalogTier = catalogById.get(id);
    const prev = byTierMap.get(id) || {
      id,
      name: catalogTier?.name || (id === SIN_CATEGORIA_TIER ? 'Sin categoría' : String(m.tier || 'Sin categoría')),
      color: catalogTier?.color || '',
      count: 0,
    };
    prev.count += 1;
    byTierMap.set(id, prev);
  }

  const byTier = assignDistinctStatColors(
    [...byTierMap.values()].sort((a, b) => b.count - a.count),
    reservedColors,
  );
  const titularesActivos = titulares.filter((m) => (m.status || 'active') === 'active').length;

  return {
    total: list.length,
    titulares: titulares.length,
    titularesActivos,
    integrantes: integrantes.length,
    gruposFamiliares: groupsWithMembers.size,
    byTier,
  };
}
