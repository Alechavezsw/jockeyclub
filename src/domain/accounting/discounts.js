/** Descuentos / bonificaciones (reglas + aplicadas Accessin). */

import {
  ACCESSIN_BONIFICACIONES,
  ACCESSIN_BONIFICACIONES_AS_OF,
  ACCESSIN_BONIFICACIONES_SNAPSHOT,
} from '../../data/seed/accessinBonificaciones';

export {
  ACCESSIN_BONIFICACIONES,
  ACCESSIN_BONIFICACIONES_AS_OF,
  ACCESSIN_BONIFICACIONES_SNAPSHOT,
};

export const DISCOUNT_CATEGORIES = [
  {
    id: 'members',
    label: 'Descuentos por socios',
    hint: 'Descuento asignado a uno o varios socios. El descuento aplica sobre el total de sus cuotas.',
  },
  {
    id: 'fee_category',
    label: 'Descuentos por categoría de cuota',
    hint: 'Descuento aplicado automáticamente a todos los socios que pertenezcan a una categoría de cuota determinada.',
  },
  {
    id: 'member_fee',
    label: 'Descuentos a cuota de un socio',
    hint: 'Descuento aplicado a una cuota puntual de un socio, no a la totalidad de sus cuotas.',
  },
  {
    id: 'family',
    label: 'Descuentos a grupo familiar',
    hint: 'Descuento aplicado a todos los integrantes de un mismo grupo familiar, sobre el total de sus cuotas.',
  },
  {
    id: 'general',
    label: 'Descuentos generales',
    hint: 'Descuento aplicado de forma general a todo el padrón de socios del club.',
  },
];

/** Reglas estructurales Accessin (además de bonificaciones aplicadas). */
export const ACCESSIN_DISCOUNT_RULES = [
  {
    id: 'adrule-376',
    accessinId: 376,
    category: 'fee_category',
    feeCategories: ['COMISION'],
    memberIds: [],
    memberNumber: '',
    memberName: 'COMISION',
    appliedTo: 'COMISION',
    familyGroup: '',
    documentNumber: '',
    description: 'MIEMBRO DE COMISION',
    concept: 'MIEMBRO DE COMISION',
    reason: 'MIEMBRO DE COMISION',
    valueType: 'percent',
    value: 100,
    percentage: 100,
    amount: 0,
    validFrom: '2025-05-29',
    validFromTime: '15:00',
    validTo: '2027-04-30',
    validToTime: '23:59',
    date: '2025-05-29',
    appliedBy: '',
    isActive: true,
    source: 'accessin',
    createdAt: '2025-05-29T15:00:00.000Z',
    updatedAt: '2025-05-29T15:00:00.000Z',
  },
];

export const DISCOUNT_VALUE_TYPES = [
  { id: 'percent', label: 'Porcentaje (%)' },
  { id: 'amount', label: 'Importe fijo ($)' },
];

function uid(prefix = 'disc') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function parseList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean);
  return String(value || '')
    .split(/[,;]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function categoryLabel(id) {
  return DISCOUNT_CATEGORIES.find((c) => c.id === id)?.label || id;
}

export function appliedToLabel(item) {
  if (!item) return '—';
  if (item.category === 'fee_category') {
    return item.appliedTo
      || (item.feeCategories || []).join(', ')
      || item.memberName
      || '—';
  }
  if (item.category === 'family') return item.familyGroup || item.appliedTo || '—';
  if (item.category === 'general') return item.appliedTo || 'Todo el padrón';
  return item.memberName || item.memberNumber || item.appliedTo || '—';
}

export function formatDiscountValue(item) {
  if (!item) return '—';
  if (item.valueType === 'percent' || (item.percentage != null && item.valueType !== 'amount')) {
    const p = Number(item.percentage ?? item.value) || 0;
    return `${p.toFixed(2)} %`;
  }
  const amount = Number(item.amount ?? item.value) || 0;
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatValidity(item) {
  const from = item.validFrom || item.date || '';
  const to = item.validTo || '';
  if (!from && !to) return 'Sin límite';
  const fmt = (iso, time) => {
    if (!iso) return '';
    try {
      const datePart = new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString('es-AR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      return time ? `${datePart} a las ${time}` : datePart;
    } catch {
      return String(iso);
    }
  };
  const fromLabel = fmt(from, item.validFromTime);
  const toLabel = fmt(to, item.validToTime);
  if (from && to) return `Desde el ${fromLabel} hasta el ${toLabel}`;
  if (from) return `Desde el ${fromLabel}`;
  return `Hasta el ${toLabel}`;
}

export function createDiscount(input = {}) {
  const description = String(input.description || input.reason || input.concept || '').trim();
  if (!description) throw new Error('La descripción es obligatoria.');

  const category = DISCOUNT_CATEGORIES.some((c) => c.id === input.category)
    ? input.category
    : 'members';

  const valueType = input.valueType === 'amount' ? 'amount' : 'percent';
  const value = Number(input.value ?? (valueType === 'percent' ? input.percentage : input.amount));
  if (!Number.isFinite(value) || value < 0) throw new Error('El valor debe ser un número válido.');
  if (valueType === 'percent' && value > 100) throw new Error('El porcentaje no puede superar 100.');

  const memberIds = parseList(input.memberIds || input.includeMembers || input.memberNumber);
  const feeCategories = parseList(input.feeCategories || input.cuotas || input.appliedTo);
  const memberName = String(input.memberName || '').trim();
  const familyGroup = String(input.familyGroup || '').trim();

  if (category === 'members' && memberIds.length === 0 && !memberName) {
    throw new Error('Seleccioná uno o varios socios.');
  }
  if (category === 'member_fee' && memberIds.length === 0 && !memberName) {
    throw new Error('Indicá el socio de la cuota.');
  }
  if (category === 'fee_category' && feeCategories.length === 0) {
    throw new Error('Seleccioná una o varias categorías de cuota.');
  }
  if (category === 'family' && !familyGroup) {
    throw new Error('Indicá el grupo familiar.');
  }

  const appliedTo = category === 'fee_category'
    ? feeCategories.join(', ')
    : category === 'family'
      ? familyGroup
      : category === 'general'
        ? 'Todo el padrón'
        : (memberName || memberIds.join(', '));

  return {
    id: input.id || uid('disc'),
    accessinId: input.accessinId || null,
    category,
    memberIds,
    memberNumber: memberIds[0] || String(input.memberNumber || ''),
    memberName: memberName || (memberIds.length ? memberIds.join(', ') : appliedTo),
    feeCategories,
    appliedTo,
    familyGroup,
    documentNumber: String(input.documentNumber || '').trim(),
    description,
    concept: String(input.concept || description).trim(),
    reason: String(input.reason || description).trim(),
    valueType,
    value,
    percentage: valueType === 'percent' ? value : null,
    amount: valueType === 'amount' ? value : (Number(input.amount) || 0),
    validFrom: input.validFrom || input.date || new Date().toISOString().slice(0, 10),
    validFromTime: input.validFromTime || '',
    validTo: input.validTo || '',
    validToTime: input.validToTime || '',
    date: input.date || input.validFrom || new Date().toISOString().slice(0, 10),
    appliedBy: String(input.appliedBy || '').trim(),
    isActive: input.isActive !== false,
    source: input.source || 'manual',
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function upsertDiscount(list = [], input = {}) {
  const existing = (list || []).find((d) => d.id === input.id) || null;
  const next = createDiscount({
    ...existing,
    ...input,
    id: existing?.id || input.id,
    createdAt: existing?.createdAt,
    source: existing?.source || input.source || 'manual',
  });
  if (existing) return (list || []).map((d) => (d.id === existing.id ? next : d));
  return [next, ...(list || [])];
}

export function softDeleteDiscount(list = [], id) {
  return (list || []).map((d) => (
    d.id === id ? { ...d, isActive: false, updatedAt: new Date().toISOString() } : d
  ));
}

export function activeDiscounts(list = [], category = null) {
  let rows = (list || []).filter((d) => d && d.isActive !== false);
  if (category) rows = rows.filter((d) => d.category === category);
  return rows.toSorted((a, b) => String(b.date || b.validFrom || '').localeCompare(String(a.date || a.validFrom || '')));
}

export function discountCategoryCounts(list = []) {
  const active = (list || []).filter((d) => d && d.isActive !== false);
  return DISCOUNT_CATEGORIES.map((cat) => ({
    ...cat,
    count: active.filter((d) => d.category === cat.id).length,
  }));
}

export function filterDiscounts(list = [], { category = null, query = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  let rows = activeDiscounts(list, category);
  if (q) {
    rows = rows.filter((d) => {
      const hay = [
        d.memberName,
        d.memberNumber,
        d.description,
        d.concept,
        d.reason,
        d.familyGroup,
        d.appliedBy,
        d.appliedTo,
        ...(d.feeCategories || []),
      ].map((x) => String(x || '').toLowerCase()).join(' ');
      return hay.includes(q);
    });
  }
  return rows;
}

export function seedDiscounts() {
  return [...(ACCESSIN_BONIFICACIONES || []), ...(ACCESSIN_DISCOUNT_RULES || [])];
}

/** Merge seed Accessin + reglas locales guardadas. */
export function resolveDiscounts(loaded) {
  const seed = seedDiscounts();
  if (!Array.isArray(loaded) || loaded.length === 0) return seed;
  const seedIds = new Set(seed.map((s) => s.id));
  const extras = loaded.filter((d) => d && !seedIds.has(d.id));
  const byId = new Map(seed.map((s) => [s.id, s]));
  loaded.forEach((d) => {
    if (d?.id && byId.has(d.id)) byId.set(d.id, { ...byId.get(d.id), ...d });
  });
  return [...byId.values(), ...extras];
}
