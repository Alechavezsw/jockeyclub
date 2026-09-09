import { isExampleMemberTier } from './tiers';

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
    const id = String(m.tier || 'sin_categoria').toLowerCase();
    if (isExampleMemberTier(id)) continue;
    const prev = byTierMap.get(id) || {
      id,
      name: catalogById.get(id)?.name || String(m.tier || 'Sin categoría'),
      color: catalogById.get(id)?.color || '',
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
