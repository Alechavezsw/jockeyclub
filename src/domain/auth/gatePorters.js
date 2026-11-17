/**
 * Porteros que pueden figurar al rendir portería / estacionamiento.
 * Evita duplicados de perfil (mismo nombre con/sin tilde) y gente que no es portero.
 */

export const CANONICAL_GATE_PORTERS = [
  { key: 'adrian-suarez', tokens: ['adrian', 'suarez'] },
  { key: 'elias-carrizo', tokens: ['elias', 'carrizo'] },
  { key: 'guillermo-castro', tokens: ['guillermo', 'castro'] },
  { key: 'juan-molina', tokens: ['juan', 'molina'] },
  { key: 'rosana-rodriguez', tokens: ['rosana', 'rodriguez'] },
  { key: 'jorge-galdeano', tokens: ['jorge', 'galdeano'] },
];

export function normalizePorterName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function porterCanonicalKey(name) {
  const parts = new Set(normalizePorterName(name).split(/\s+/).filter(Boolean));
  if (!parts.size) return null;
  const hit = CANONICAL_GATE_PORTERS.find(({ tokens }) => tokens.every((token) => parts.has(token)));
  return hit?.key || null;
}

export function isCanonicalGatePorter(name) {
  return Boolean(porterCanonicalKey(name));
}

/**
 * Deja un solo perfil por portero canónico.
 * Prefiere el que ya tiene rol primario de portería.
 */
export function dedupeGateOperators(list = []) {
  const best = new Map();
  for (const row of list || []) {
    const fullName = String(row?.fullName || row?.full_name || '').trim();
    const key = porterCanonicalKey(fullName);
    if (!key || !row?.id) continue;
    const next = { id: row.id, fullName, role: row.role };
    const prev = best.get(key);
    if (!prev) {
      best.set(key, next);
      continue;
    }
    const prevPrimary = String(prev.role || '').toLowerCase() === 'gate_operator';
    const nextPrimary = String(next.role || '').toLowerCase() === 'gate_operator';
    if (!prevPrimary && nextPrimary) best.set(key, next);
  }
  return [...best.values()]
    .map(({ id, fullName }) => ({ id, fullName }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'));
}
