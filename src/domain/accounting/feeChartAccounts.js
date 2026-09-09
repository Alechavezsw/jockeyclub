/** Cuentas contables de cuotas (Accessin / LILA) + cuenta corriente. */

import { ACCESSIN_FEE_ACCOUNT_DETAILS } from '../../data/seed/accessinFeeAccountDetails';

/** Cuentas del módulo Cuotas (no confundir con el plan de cuentas ERP). */
export const ACCESSIN_FEE_CHART_ACCOUNTS = [
  {
    id: 'fca-31',
    accessinId: 31,
    name: 'SOCIO FAMILIAR',
    description: 'SOCIO FAMILIAR',
    feeCategories: ['SOCIO FAMILIAR'],
    balance: 436210358.44,
    detailAccountLabel: 'SOCIO FAMILIAR',
    isActive: true,
    source: 'accessin',
  },
  {
    id: 'fca-33',
    accessinId: 33,
    name: 'SOCIOS INDIVIDUALES',
    description: '',
    feeCategories: ['SOCIO INDIVIDUAL'],
    balance: 52075510.0,
    detailAccountLabel: 'SOCIOS INDIVIDUALES',
    isActive: true,
    source: 'accessin',
  },
];

function uid(prefix = 'fca') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function matchDetailAccount(account, details = ACCESSIN_FEE_ACCOUNT_DETAILS) {
  if (!account) return null;
  const label = String(account.detailAccountLabel || account.name || '')
    .trim()
    .toUpperCase();
  return (details || []).find((d) => String(d.accountLabel || '').trim().toUpperCase() === label) || null;
}

/** Líneas de C.C. derivadas del detalle Accessin (importe/cobrado/pendiente). */
export function buildFeeAccountLedgerLines(account, details = ACCESSIN_FEE_ACCOUNT_DETAILS) {
  const detail = matchDetailAccount(account, details);
  if (!detail) return [];
  const baseId = Number(account.accessinId || 0) * 100000;
  return (detail.lines || []).map((line, i) => {
    const collected = Number(line.amount) || 0;
    // En el export de cobros el monto es lo cobrado; el importe de cuota se asume igual.
    const amount = collected;
    const pending = Math.max(0, amount - collected);
    return {
      id: `fcc-${account.id}-${i}`,
      accessinId: baseId + i + 1,
      accountId: account.id,
      memberNumber: String(line.memberNumber || ''),
      memberName: String(line.memberName || ''),
      dni: String(line.dni || ''),
      date: line.feeDate || line.collectedAt || '',
      dateLabel: line.feeDateLabel || line.collectedAtLabel || '',
      collectedAt: line.collectedAt || '',
      collectedAtLabel: line.collectedAtLabel || '',
      type: line.type || '',
      description: line.description || '',
      amount,
      collected,
      pending,
      source: 'accessin',
    };
  });
}

export function feeChartAccountCounts(list = ACCESSIN_FEE_CHART_ACCOUNTS) {
  return (list || []).filter((a) => a && a.isActive !== false).length;
}

export function resolveFeeChartAccounts(loaded) {
  const seed = ACCESSIN_FEE_CHART_ACCOUNTS;
  if (!Array.isArray(loaded) || !loaded.length) return [...seed];
  const byId = new Map(seed.map((a) => [a.id, a]));
  loaded.forEach((a) => {
    if (a?.id && byId.has(a.id)) {
      const seedRow = byId.get(a.id);
      byId.set(a.id, {
        ...seedRow,
        ...a,
        balance: seedRow.source === 'accessin' ? seedRow.balance : (a.balance ?? seedRow.balance),
        feeCategories: a.feeCategories?.length ? a.feeCategories : seedRow.feeCategories,
      });
    } else if (a?.id) byId.set(a.id, a);
  });
  return [...byId.values()];
}

export function createFeeChartAccount(input = {}) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('El nombre es obligatorio.');
  const feeCategories = Array.isArray(input.feeCategories)
    ? input.feeCategories.map((c) => String(c || '').trim()).filter(Boolean)
    : String(input.feeCategories || '')
      .split(/[,;]+/)
      .map((c) => c.trim())
      .filter(Boolean);
  return {
    id: input.id || uid('fca'),
    accessinId: input.accessinId || null,
    name,
    description: String(input.description || '').trim(),
    feeCategories,
    balance: Number(input.balance) || 0,
    detailAccountLabel: String(input.detailAccountLabel || name).trim(),
    isActive: input.isActive !== false,
    source: input.source || 'manual',
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function upsertFeeChartAccount(list = [], input = {}) {
  const existing = (list || []).find((a) => a.id === input.id) || null;
  const next = createFeeChartAccount({
    ...existing,
    ...input,
    id: existing?.id || input.id,
    createdAt: existing?.createdAt,
    source: existing?.source || input.source || 'manual',
  });
  if (existing) return (list || []).map((a) => (a.id === existing.id ? next : a));
  return [next, ...(list || [])];
}

export function softDeleteFeeChartAccount(list = [], id) {
  return (list || []).map((a) => (
    a.id === id ? { ...a, isActive: false, updatedAt: new Date().toISOString() } : a
  ));
}

function parseDate(value) {
  if (!value) return null;
  const raw = String(value);
  const d = raw.includes('T') ? new Date(raw) : new Date(`${raw.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function filterFeeAccountLedger(lines = [], { from = '', to = '', query = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  const fromD = parseDate(from);
  const toD = parseDate(to);
  return (lines || []).filter((line) => {
    const d = parseDate(line.date || line.collectedAt);
    if (fromD && d && d < fromD) return false;
    if (toD && d && d > toD) return false;
    if (!q) return true;
    const hay = [
      line.memberNumber,
      line.memberName,
      line.dni,
      line.type,
      line.description,
      line.dateLabel,
    ].map((x) => String(x || '').toLowerCase()).join(' ');
    return hay.includes(q);
  });
}

export function formatFeeLedgerDate(line) {
  if (!line) return '—';
  return line.dateLabel || line.date || '—';
}
