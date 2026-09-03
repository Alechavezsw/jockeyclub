/** Gastos imputables a cuotas (Accessin / LILA) — espejo de descuentos. */

export const FEE_EXPENSE_CATEGORIES = [
  {
    id: 'members',
    label: 'Gastos por socios',
    hint: 'Gasto asignado a uno o varios socios. El gasto aplica sobre el total de sus cuotas.',
  },
  {
    id: 'fee_category',
    label: 'Gastos por categoría de cuota',
    hint: 'Gasto aplicado automáticamente a todos los socios que pertenezcan a una categoría de cuota determinada.',
  },
  {
    id: 'member_fee',
    label: 'Gastos a cuota de un socio',
    hint: 'Gasto aplicado a una cuota puntual de un socio, no a la totalidad de sus cuotas.',
  },
  {
    id: 'family',
    label: 'Gastos a grupo familiar',
    hint: 'Gasto aplicado a todos los integrantes de un mismo grupo familiar, sobre el total de sus cuotas.',
  },
  {
    id: 'general',
    label: 'Gastos generales',
    hint: 'Gasto aplicado de forma general a todo el padrón de socios del club.',
  },
];

export const FEE_EXPENSE_VALUE_TYPES = [
  { id: 'percent', label: 'Porcentaje (%)' },
  { id: 'amount', label: 'Importe fijo ($)' },
];

function uid(prefix = 'fexp') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function parseList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean);
  return String(value || '')
    .split(/[,;]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function feeExpenseCategoryLabel(id) {
  return FEE_EXPENSE_CATEGORIES.find((c) => c.id === id)?.label || id;
}

export function appliedToLabel(item) {
  if (!item) return '—';
  if (item.category === 'fee_category') {
    return item.appliedTo
      || (item.feeCategories || []).join(', ')
      || '—';
  }
  if (item.category === 'family') return item.familyGroup || item.appliedTo || '—';
  if (item.category === 'general') return item.appliedTo || 'Todo el padrón';
  return item.memberName || item.appliedTo || item.memberNumber || '—';
}

export function formatFeeExpenseValue(item) {
  if (!item) return '—';
  if (item.valueType === 'percent' || (item.percentage != null && item.valueType !== 'amount')) {
    const pct = Number(item.percentage ?? item.value);
    return `${pct.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
  }
  const amount = Number(item.amount ?? item.value) || 0;
  return amount.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
}

export function formatValidity(item) {
  if (!item) return '—';
  const from = item.validFrom || item.date || '';
  const to = item.validTo || '';
  const fmt = (d, t) => {
    if (!d) return '';
    try {
      const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
      const months = [
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
      ];
      const base = `${day} de ${months[m - 1]} del ${y}`;
      return t ? `${base} a las ${t}` : base;
    } catch {
      return d;
    }
  };
  const fromLabel = fmt(from, item.validFromTime);
  const toLabel = fmt(to, item.validToTime);
  if (from && to) return `Desde el ${fromLabel} hasta el ${toLabel}`;
  if (from) return `Desde el ${fromLabel}`;
  if (to) return `Hasta el ${toLabel}`;
  return '—';
}

export function createFeeExpense(input = {}) {
  const description = String(input.description || input.reason || input.concept || '').trim();
  if (!description) throw new Error('La descripción es obligatoria.');

  const category = FEE_EXPENSE_CATEGORIES.some((c) => c.id === input.category)
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
    id: input.id || uid('fexp'),
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

export function upsertFeeExpense(list = [], input = {}) {
  const existing = (list || []).find((d) => d.id === input.id) || null;
  const next = createFeeExpense({
    ...existing,
    ...input,
    id: existing?.id || input.id,
    createdAt: existing?.createdAt,
    source: existing?.source || input.source || 'manual',
  });
  if (existing) return (list || []).map((d) => (d.id === existing.id ? next : d));
  return [next, ...(list || [])];
}

export function softDeleteFeeExpense(list = [], id) {
  return (list || []).map((d) => (
    d.id === id ? { ...d, isActive: false, updatedAt: new Date().toISOString() } : d
  ));
}

export function activeFeeExpenses(list = [], category = null) {
  let rows = (list || []).filter((d) => d && d.isActive !== false);
  if (category) rows = rows.filter((d) => d.category === category);
  return rows.toSorted((a, b) => String(b.date || b.validFrom || '').localeCompare(String(a.date || a.validFrom || '')));
}

export function feeExpenseCategoryCounts(list = []) {
  const active = (list || []).filter((d) => d && d.isActive !== false);
  return FEE_EXPENSE_CATEGORIES.map((cat) => ({
    ...cat,
    count: active.filter((d) => d.category === cat.id).length,
  }));
}

export function filterFeeExpenses(list = [], { category = null, query = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  let rows = activeFeeExpenses(list, category);
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

export function seedFeeExpenses() {
  return [];
}

export function resolveFeeExpenses(loaded) {
  const seed = seedFeeExpenses();
  if (!Array.isArray(loaded) || loaded.length === 0) return seed;
  const seedIds = new Set(seed.map((s) => s.id));
  const extras = loaded.filter((d) => d && !seedIds.has(d.id));
  const byId = new Map(seed.map((s) => [s.id, s]));
  loaded.forEach((d) => {
    if (d?.id && byId.has(d.id)) byId.set(d.id, { ...byId.get(d.id), ...d });
  });
  return [...byId.values(), ...extras];
}
