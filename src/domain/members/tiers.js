/** Categorías de socios del club (padrón / cuotas datita). Sin Gold/Platinum. */

export const DEFAULT_MEMBER_TIER = 'socio_individual';

/** Nombres literales de categoría_cuota en socio_cuotas / padrón. */
export const DATITA_CUOTA_CATEGORY_NAMES = [
  'ABONO TENIS',
  'COMISION',
  'FUNDADOR',
  'GRUPO FAMILIAR (AMET)',
  'GRUPO FAMILIAR (Familiar)',
  'GRUPO FAMILIAR (Vitalicio)',
  'GRUPO FAMILIAR FUNDADOR',
  'INTERES POR TRANSACCIÓN 2,5% GRUPO FAMILIAR (AMET)',
  'INTERES POR TRANSACCIÓN 2,5% SOCIO INDIVIDUAL (AMET)',
  'SOCIO (Vitalicio)',
  'SOCIO FAMILIAR',
  'SOCIO FAMILIAR (AMET)',
  'SOCIO INDIVIDUAL',
  'SOCIO INDIVIDUAL (AMET)',
  'TURF',
];

const TIER_SEED = [
  { name: 'FUNDADOR', label: '2266', color: '#a78bfa', sortOrder: 1 },
  { name: 'GRUPO FAMILIAR FUNDADOR', label: '2267', color: '#8b5cf6', sortOrder: 2 },
  { name: 'SOCIO (Vitalicio)', label: '2295', color: '#6366f1', sortOrder: 3 },
  { name: 'GRUPO FAMILIAR (Vitalicio)', label: '2294', color: '#818cf8', sortOrder: 4 },
  { name: 'SOCIO FAMILIAR', label: '2268', color: '#cfa13a', sortOrder: 5 },
  { name: 'SOCIO FAMILIAR (AMET)', label: '6146', color: '#d4a574', sortOrder: 6 },
  { name: 'GRUPO FAMILIAR (Familiar)', label: '2269', color: '#f59e0b', sortOrder: 7 },
  { name: 'GRUPO FAMILIAR (AMET)', label: '6147', color: '#fbbf24', sortOrder: 8 },
  { name: 'SOCIO INDIVIDUAL', label: '2270', color: '#10b981', sortOrder: 9 },
  { name: 'SOCIO INDIVIDUAL (AMET)', label: '6149', color: '#34d399', sortOrder: 10 },
  { name: 'TURF', label: '3523', color: '#3b82f6', sortOrder: 11 },
  { name: 'ABONO TENIS', label: '2394', color: '#06b6d4', sortOrder: 12 },
  { name: 'COMISION', label: '—', color: '#94a3b8', sortOrder: 90 },
  {
    name: 'INTERES POR TRANSACCIÓN 2,5% GRUPO FAMILIAR (AMET)',
    label: '6148',
    color: '#64748b',
    sortOrder: 91,
  },
  {
    name: 'INTERES POR TRANSACCIÓN 2,5% SOCIO INDIVIDUAL (AMET)',
    label: '6150',
    color: '#64748b',
    sortOrder: 92,
  },
];

export const TIER_COLORS = [
  '#a78bfa', '#d1d5db', '#fbbf24', '#cfa13a', '#10b981',
  '#3b82f6', '#ef4444', '#ec4899', '#06b6d4', '#84cc16',
];

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

/** Catálogo por defecto = categorías del padrón. */
export const MEMBER_TIER_CATALOG = TIER_SEED.map((t) => ({
  id: slugifyTierId(t.name),
  name: t.name,
  label: t.label,
  monthlyDues: 0,
  color: t.color,
  sortOrder: t.sortOrder,
  isActive: true,
}));

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
    (t) => t.id === key || normalizeLabel(t.name) === key || t.id === String(tierIdOrName || '').toLowerCase()
  ) || null;
}

export function getTierMonthlyDues(tier, catalog = getTierCatalog()) {
  const found = findTier(tier, catalog);
  if (found) return found.monthlyDues;
  const fallback = findTier(DEFAULT_MEMBER_TIER, catalog);
  return fallback?.monthlyDues || 0;
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
  const color = t?.color || '#10b981';
  return {
    background: `${color}26`,
    color,
    borderColor: `${color}55`,
  };
}

/** Estilo de tarjeta virtual según categoría del catálogo. */
export function tierCardStyle(tier, catalog = getTierCatalog()) {
  const t = findTier(tier, catalog);
  const accent = t?.color || '#cfa13a';
  const label = (t?.name || String(tier || 'SOCIO')).toUpperCase();
  return {
    bg: `linear-gradient(135deg, #12100a 0%, #0a0906 40%, #12100a 100%)`,
    accent,
    accentDim: `${accent}4d`,
    chipColor: accent,
    glow: `${accent}66`,
    label: label.length > 28 ? `${label.slice(0, 26)}…` : label,
    stripe: `linear-gradient(90deg, transparent, ${accent}22, transparent)`,
  };
}

const FEE_CATEGORY_RE = /^(COMISION|INTERES POR TRANSACC)/i;

/** Prioridad baja = categoría de membresía principal. */
function cuotaPriority(name) {
  const u = String(name || '').toUpperCase();
  if (u === 'FUNDADOR') return 1;
  if (u.includes('GRUPO FAMILIAR FUNDADOR')) return 2;
  if (u.includes('VITALICIO') && u.includes('SOCIO')) return 3;
  if (u.includes('VITALICIO')) return 4;
  if (u.includes('SOCIO FAMILIAR')) return 5;
  if (u.includes('GRUPO FAMILIAR')) return 6;
  if (u.includes('SOCIO INDIVIDUAL') || /^SOCIO\b/.test(u)) return 7;
  if (u === 'TURF') return 8;
  if (u.includes('ABONO')) return 9;
  if (FEE_CATEGORY_RE.test(u)) return 100;
  return 50;
}

/**
 * Elige la categoría de cuota principal (ignora interés/comisión si hay otra).
 */
export function pickPrimaryCuotaCategory(categories) {
  const cats = (categories || []).map((c) => String(c).trim()).filter(Boolean);
  if (!cats.length) return null;
  const membership = cats.filter((c) => !FEE_CATEGORY_RE.test(c));
  const pool = membership.length ? membership : cats;
  return pool.slice().sort((a, b) => cuotaPriority(a) - cuotaPriority(b) || a.localeCompare(b, 'es'))[0];
}
