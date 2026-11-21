/** Acuerdos con tarjetas: catálogo editable por admin; al cobrar solo se registra. */

/** Emisor/adquirente retiene el interés (provisional para planes actuales). */
export const FINANCING_MODE_ISSUER = 'issuer_keeps';
/** El club percibe el adicional como ingreso por financiación. */
export const FINANCING_MODE_CLUB = 'club_keeps';

export const FINANCING_MODES = [FINANCING_MODE_ISSUER, FINANCING_MODE_CLUB];

export const DEFAULT_PAYMENT_PLANS = [
  {
    id: 'visa-contado',
    label: 'Visa contado',
    cardBrand: 'Visa',
    installments: 1,
    active: true,
    notes: '',
    acquirer: 'Visa',
    financingMode: FINANCING_MODE_ISSUER,
    financingPercent: null,
    financingFixed: null,
    allowOperatorOverride: false,
    validFrom: null,
    validTo: null,
  },
  {
    id: 'visa-3',
    label: 'Visa 3 cuotas',
    cardBrand: 'Visa',
    installments: 3,
    active: true,
    notes: '',
    acquirer: 'Visa',
    financingMode: FINANCING_MODE_ISSUER,
    financingPercent: null,
    financingFixed: null,
    allowOperatorOverride: true,
    validFrom: null,
    validTo: null,
  },
  {
    id: 'data-3',
    label: 'DATA 3 cuotas',
    cardBrand: 'DATA',
    installments: 3,
    active: true,
    notes: 'POSNET / DATA: modalidad provisional issuer_keeps hasta verificar acuerdo.',
    acquirer: 'DATA',
    financingMode: FINANCING_MODE_ISSUER,
    financingPercent: null,
    financingFixed: null,
    allowOperatorOverride: true,
    validFrom: null,
    validTo: null,
  },
  {
    id: 'mastercard-contado',
    label: 'Mastercard contado',
    cardBrand: 'Mastercard',
    installments: 1,
    active: true,
    notes: '',
    acquirer: 'Mastercard',
    financingMode: FINANCING_MODE_ISSUER,
    financingPercent: null,
    financingFixed: null,
    allowOperatorOverride: false,
    validFrom: null,
    validTo: null,
  },
];

function text(value, fallback = '') {
  const next = String(value ?? '').trim();
  return next || fallback;
}

function planId(raw, fallback) {
  const id = text(raw).toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-|-$/g, '');
  return id || fallback;
}

function nullableNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function financingMode(raw) {
  const mode = String(raw || '').trim();
  return FINANCING_MODES.includes(mode) ? mode : FINANCING_MODE_ISSUER;
}

function isoDay(value) {
  const day = String(value || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

export function normalizePaymentPlan(row = {}, index = 0) {
  const installments = Math.max(1, Math.round(Number(row.installments) || 1));
  const id = planId(row.id, `plan-${index + 1}`);
  const label = text(row.label, `${text(row.cardBrand, 'Tarjeta')} ${installments} cuota${installments > 1 ? 's' : ''}`);
  const brand = text(row.cardBrand, 'Tarjeta');
  return {
    id,
    label,
    cardBrand: brand,
    installments,
    active: row.active !== false,
    notes: text(row.notes),
    acquirer: text(row.acquirer, brand),
    financingMode: financingMode(row.financingMode),
    financingPercent: nullableNumber(row.financingPercent),
    financingFixed: nullableNumber(row.financingFixed),
    allowOperatorOverride: row.allowOperatorOverride === true,
    validFrom: isoDay(row.validFrom),
    validTo: isoDay(row.validTo),
  };
}

/** Snapshot inmutable al momento del cobro (no se reescribe si cambia el catálogo). */
export function paymentPlanSnapshot(plan) {
  if (!plan) return null;
  const normalized = normalizePaymentPlan(plan);
  return {
    id: normalized.id,
    label: normalized.label,
    cardBrand: normalized.cardBrand,
    installments: normalized.installments,
    acquirer: normalized.acquirer,
    financingMode: normalized.financingMode,
    financingPercent: normalized.financingPercent,
    financingFixed: normalized.financingFixed,
  };
}

/** Lista limpia; si viene vacío/ inválido, vuelve al default. */
export function mergePaymentPlans(raw) {
  if (!Array.isArray(raw) || !raw.length) return DEFAULT_PAYMENT_PLANS.map((row, i) => normalizePaymentPlan(row, i));
  const seen = new Set();
  const plans = [];
  raw.forEach((row, index) => {
    const plan = normalizePaymentPlan(row, index);
    if (seen.has(plan.id)) return;
    seen.add(plan.id);
    plans.push(plan);
  });
  return plans.length ? plans : DEFAULT_PAYMENT_PLANS.map((row, i) => normalizePaymentPlan(row, i));
}

/** Agrega planes oficiales faltantes (p. ej. DATA 3 cuotas) sin pisar los ya cargados. */
export function ensureOfficialPaymentPlans(raw) {
  const list = mergePaymentPlans(raw);
  const ids = new Set(list.map((row) => row.id));
  const missing = DEFAULT_PAYMENT_PLANS
    .map((row, i) => normalizePaymentPlan(row, i))
    .filter((row) => !ids.has(row.id));
  return missing.length ? [...list, ...missing] : list;
}

export function paymentPlanIsValidOn(plan, dayISO) {
  const day = isoDay(dayISO) || isoDay(new Date().toISOString());
  if (!day || !plan) return false;
  if (plan.active === false) return false;
  if (plan.validFrom && day < plan.validFrom) return false;
  if (plan.validTo && day > plan.validTo) return false;
  return true;
}

export function activePaymentPlans(plans = DEFAULT_PAYMENT_PLANS, dayISO = null) {
  return mergePaymentPlans(plans).filter((row) => paymentPlanIsValidOn(row, dayISO || new Date().toISOString().slice(0, 10)));
}

export function findPaymentPlan(plans, planId) {
  const key = String(planId || '').trim();
  if (!key) return null;
  return mergePaymentPlans(plans).find((row) => row.id === key) || null;
}

/** Solo admin puede cambiar modalidad / tasas del plan. */
export function canEditPaymentPlanFinancing(role) {
  const r = String(role || '').trim().toLowerCase();
  return r === 'admin' || r === 'superadmin' || r === 'super_admin';
}
