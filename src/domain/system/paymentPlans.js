/** Acuerdos con tarjetas: catálogo editable por superadmin; al cobrar solo se registra. */

export const DEFAULT_PAYMENT_PLANS = [
  {
    id: 'visa-contado',
    label: 'Visa contado',
    cardBrand: 'Visa',
    installments: 1,
    active: true,
    notes: '',
  },
  {
    id: 'visa-3',
    label: 'Visa 3 cuotas',
    cardBrand: 'Visa',
    installments: 3,
    active: true,
    notes: '',
  },
  {
    id: 'mastercard-contado',
    label: 'Mastercard contado',
    cardBrand: 'Mastercard',
    installments: 1,
    active: true,
    notes: '',
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

export function normalizePaymentPlan(row = {}, index = 0) {
  const installments = Math.max(1, Math.round(Number(row.installments) || 1));
  const id = planId(row.id, `plan-${index + 1}`);
  const label = text(row.label, `${text(row.cardBrand, 'Tarjeta')} ${installments} cuota${installments > 1 ? 's' : ''}`);
  return {
    id,
    label,
    cardBrand: text(row.cardBrand, 'Tarjeta'),
    installments,
    active: row.active !== false,
    notes: text(row.notes),
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

export function activePaymentPlans(plans = DEFAULT_PAYMENT_PLANS) {
  return mergePaymentPlans(plans).filter((row) => row.active);
}

export function findPaymentPlan(plans, planId) {
  const key = String(planId || '').trim();
  if (!key) return null;
  return mergePaymentPlans(plans).find((row) => row.id === key) || null;
}
