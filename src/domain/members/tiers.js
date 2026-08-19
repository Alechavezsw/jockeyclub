/** Catálogo de categorías de socios (Royal / Platinum / Gold / custom). */

export const MEMBER_TIER_CATALOG = [
  {
    id: 'royal',
    name: 'Royal',
    label: 'Exclusivo',
    monthlyDues: 45000,
    color: '#a78bfa',
    sortOrder: 1,
  },
  {
    id: 'platinum',
    name: 'Platinum',
    label: 'VIP',
    monthlyDues: 38000,
    color: '#d1d5db',
    sortOrder: 2,
  },
  {
    id: 'gold',
    name: 'Gold',
    label: 'Estándar',
    monthlyDues: 32000,
    color: '#fbbf24',
    sortOrder: 3,
  },
];

export const TIER_COLORS = [
  '#a78bfa', '#d1d5db', '#fbbf24', '#cfa13a', '#10b981',
  '#3b82f6', '#ef4444', '#ec4899', '#06b6d4', '#84cc16',
];

let runtimeCatalog = null;

export function setRuntimeTierCatalog(catalog) {
  if (!Array.isArray(catalog) || !catalog.length) {
    runtimeCatalog = null;
    return;
  }
  runtimeCatalog = catalog.map((t) => normalizeTier(t));
}

export function getTierCatalog() {
  return runtimeCatalog || MEMBER_TIER_CATALOG;
}

function normalizeLabel(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function slugifyTierId(name = '') {
  const base = normalizeLabel(name).replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  return base || `tier_${Date.now()}`;
}

export function normalizeTier(input = {}) {
  const name = String(input.name || '').trim() || 'Categoría';
  const id = String(input.id || slugifyTierId(name)).toLowerCase();
  const monthly = Number(input.monthlyDues);
  return {
    id,
    name,
    label: String(input.label || '').trim(),
    monthlyDues: Number.isFinite(monthly) && monthly >= 0 ? Math.round(monthly) : 0,
    color: input.color || TIER_COLORS[0],
    sortOrder: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 99,
    isActive: input.isActive !== false,
  };
}

export function loadTierCatalog(fallback = MEMBER_TIER_CATALOG) {
  try {
    const raw = localStorage.getItem('jockey-member-tiers');
    if (!raw) return fallback.map((t) => normalizeTier(t));
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) {
      return fallback.map((t) => normalizeTier(t));
    }
    return parsed.map((t) => normalizeTier(t)).sort((a, b) => a.sortOrder - b.sortOrder);
  } catch {
    return fallback.map((t) => normalizeTier(t));
  }
}

export function getActiveTiers(catalog = getTierCatalog()) {
  return (catalog || [])
    .map((t) => normalizeTier(t))
    .filter((t) => t.isActive !== false)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es'));
}

export function findTier(tierIdOrName, catalog = getTierCatalog()) {
  const key = normalizeLabel(tierIdOrName);
  if (!key) return null;
  return getActiveTiers(catalog).find(
    (t) => t.id === key || normalizeLabel(t.name) === key
  ) || null;
}

export function getTierMonthlyDues(tier, catalog = getTierCatalog()) {
  const found = findTier(tier, catalog);
  if (found) return found.monthlyDues;
  const key = String(tier || '').toLowerCase();
  if (key === 'royal') return 45000;
  if (key === 'platinum') return 38000;
  if (key === 'gold') return 32000;
  return getTierMonthlyDues('gold', catalog);
}

export function getTierDisplayName(tier, catalog = getTierCatalog()) {
  return findTier(tier, catalog)?.name || String(tier || '—');
}

export function getTierOptionLabel(tier, catalog = getTierCatalog()) {
  const t = typeof tier === 'object' ? normalizeTier(tier) : findTier(tier, catalog);
  if (!t) return String(tier || '');
  return t.label ? `${t.name} (${t.label})` : t.name;
}

export function upsertTier(catalog, draft) {
  const next = normalizeTier(draft);
  if (!next.name) return catalog;
  const list = Array.isArray(catalog) ? [...catalog] : [];
  const idx = list.findIndex((t) => t.id === next.id);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...next };
    return list.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return [...list, next].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function removeTier(catalog, id) {
  return (catalog || []).filter((t) => t.id !== id);
}

/**
 * Reescribe la categoría en titulares y adherentes (p. ej. al fusionar/eliminar).
 */
export function remapMemberTiers(members, { fromIds = [], toId } = {}) {
  if (!toId || !fromIds.length) return members;
  const from = new Set(fromIds.map((id) => String(id).toLowerCase()));
  return (members || []).map((m) => ({
    ...m,
    tier: from.has(String(m.tier || '').toLowerCase()) ? toId : m.tier,
    adherents: (m.adherents || []).map((a) => ({
      ...a,
      tier: from.has(String(a.tier || '').toLowerCase()) ? toId : a.tier,
    })),
  }));
}

export function countMembersInTier(members, tierId) {
  const key = String(tierId || '').toLowerCase();
  return (members || []).filter((m) => m.status !== 'inactive' && String(m.tier || '').toLowerCase() === key).length;
}

/** Estilo de badge inline a partir del catálogo. */
export function tierBadgeStyle(tier, catalog = getTierCatalog()) {
  const t = findTier(tier, catalog);
  const color = t?.color || '#fbbf24';
  return {
    background: `${color}26`,
    color,
    borderColor: `${color}55`,
  };
}
