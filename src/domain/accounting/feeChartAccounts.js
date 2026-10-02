/** Cuentas contables de cuotas (Accessin / LILA) + cuenta corriente. */

import { duesAmountForTier, isMemberBillingActive } from '../members/dues';
import { parseCuotaCategories, slugifyTierId } from '../members/tiers';

// buildFeeAccountLedgerLines vive en ./feeAccountLedger. No reexportarlo desde acá:
// sería un import estático del snapshot de Accessin, y este módulo lo carga el store
// del ERP al arrancar la app, así que el snapshot volvería al chunk de entrada.

/** Cuentas del módulo Cuotas (no confundir con el plan de cuentas ERP). */
export const ACCESSIN_FEE_CHART_ACCOUNTS = [
  {
    id: 'fca-31',
    accessinId: 31,
    name: 'SOCIO FAMILIAR',
    description: 'SOCIO FAMILIAR',
    feeCategories: ['SOCIO FAMILIAR'],
    balance: 463388625.47,
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
    balance: 54715510,
    detailAccountLabel: 'SOCIOS INDIVIDUALES',
    isActive: true,
    source: 'accessin',
  },
];

function uid(prefix = 'fca') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function feeChartAccountCounts(list = ACCESSIN_FEE_CHART_ACCOUNTS) {
  return (list || []).filter((a) => a && a.isActive !== false).length;
}

function foldAccountText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function memberCategoryNames(member) {
  const raw = member?.cuotaCategories;
  const names = Array.isArray(raw)
    ? raw
    : String(raw || '').split(/[,;]+/);
  return names.map((name) => foldAccountText(name)).filter(Boolean);
}

/** La fila guardada manda. El corte de Lila solo completa una cuenta que todavía no está. */
export function resolveFeeChartAccounts(loaded) {
  const seed = ACCESSIN_FEE_CHART_ACCOUNTS;
  if (!Array.isArray(loaded) || !loaded.length) return seed.map((account) => ({ ...account }));
  const byId = new Map();
  loaded.forEach((account) => {
    if (account?.id) byId.set(account.id, account);
  });
  seed.forEach((account) => {
    if (!byId.has(account.id)) byId.set(account.id, { ...account });
  });
  return [...byId.values()].toSorted(
    (a, b) => (Number(a.accessinId) || 9999) - (Number(b.accessinId) || 9999),
  );
}

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export function periodMonthKey(period) {
  const year = Number(period?.year);
  const month = Number(period?.month);
  if (!year || !month) return '';
  return `${year}-${String(month).padStart(2, '0')}`;
}

function periodStamp(period) {
  const key = periodMonthKey(period);
  const month = Number(period?.month);
  const name = MONTHS_ES[month - 1] || String(month || '');
  return {
    key,
    date: key ? `${key}-01` : '',
    dateLabel: `01 de ${name} del ${period?.year}`,
    description: `${name} del ${period?.year}`,
  };
}

/** Meses que ya tienen movimientos, por fecha o por el texto de la cuota. */
export function ledgerMonthKeys(lines = []) {
  const keys = new Set();
  for (const line of lines || []) {
    const fromDate = String(line?.date || '').slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(fromDate)) keys.add(fromDate);
    const text = `${line?.description || ''} ${line?.dateLabel || ''}`.toLowerCase();
    MONTHS_ES.forEach((name, index) => {
      const token = `${name.toLowerCase()} del `;
      const at = text.indexOf(token);
      if (at < 0) return;
      const year = text.slice(at + token.length, at + token.length + 4);
      if (/^\d{4}$/.test(year)) keys.add(`${year}-${String(index + 1).padStart(2, '0')}`);
    });
  }
  return keys;
}

/** Cuotas de un mes liquidado para una cuenta, con la tarifa de ese mes. */
export function periodLedgerLines(account, members = [], period) {
  const stamp = periodStamp(period);
  if (!account || account.isActive === false || !stamp.key) return [];
  const categories = new Set((account.feeCategories || []).map(foldAccountText));
  if (!categories.size) return [];
  const when = new Date(Number(period.year), Number(period.month) - 1, 1, 12);
  const lines = [];
  for (const member of members || []) {
    if (!isMemberBillingActive(member)) continue;
    const names = parseCuotaCategories(member?.cuotaCategories);
    for (const name of names) {
      if (!categories.has(foldAccountText(name))) continue;
      const amount = duesAmountForTier(slugifyTierId(name), undefined, when);
      if (!amount) continue;
      const memberNumber = String(member.memberId || '');
      lines.push({
        id: `fll-${account.id}-${stamp.key}-${memberNumber}-${slugifyTierId(name)}`,
        accountId: account.id,
        memberNumber,
        memberName: member.name || '',
        dni: String(member.dni || ''),
        date: stamp.date,
        dateLabel: stamp.dateLabel,
        type: `Cuota (${name})`,
        description: stamp.description,
        amount,
        collected: 0,
        pending: amount,
        source: 'liquidation',
      });
    }
  }
  return lines;
}

/**
 * Completa los meses ya liquidados que todavía no están en la cuenta.
 * Un mes que ya tiene movimientos no se vuelve a generar.
 */
export function withProcessedPeriodLines(account, lines = [], members = [], periods = []) {
  const current = lines || [];
  const present = ledgerMonthKeys(current);
  const missing = (periods || [])
    .filter((period) => period?.status === 'processed' && !present.has(periodMonthKey(period)))
    .toSorted((a, b) => (Number(b.year) - Number(a.year)) || (Number(b.month) - Number(a.month)));
  const extra = missing.flatMap((period) => periodLedgerLines(account, members, period));
  if (!extra.length) return current;
  return [...extra, ...current];
}

/** Cuenta contable que corresponde a las categorías de cuota del socio. */
export function matchFeeLedgerAccount(accounts = [], member) {
  const names = memberCategoryNames(member);
  if (!names.length) return null;
  return (accounts || []).find((account) => {
    if (!account || account.isActive === false) return false;
    return (account.feeCategories || []).some((category) => names.includes(foldAccountText(category)));
  }) || null;
}

/**
 * Movimientos de una liquidación nueva. Cada socio entra en la cuenta de su categoría.
 * El importe queda pendiente: el balance de la cuenta sube por ese importe.
 */
export function ledgerLinesFromCharges(accounts = [], members = [], charges = [], period = {}) {
  const byMember = new Map((members || []).map((member) => [String(member.memberId), member]));
  const description = String(period.label || period.description || '').trim();
  const date = String(period.generatedAt || '').slice(0, 10);
  const lines = [];
  const deltas = new Map();
  (charges || []).forEach((charge) => {
    const amount = Number(charge.addAmount) || 0;
    if (!amount) return;
    const member = byMember.get(String(charge.memberId));
    const account = matchFeeLedgerAccount(accounts, member);
    if (!account) return;
    const category = (account.feeCategories || [])[0] || account.name;
    const id = `fll-${account.id}-${period.id || date}-${charge.memberId}`;
    lines.push({
      id,
      accountId: account.id,
      memberNumber: String(charge.memberId || ''),
      memberName: member?.name || '',
      dni: String(member?.dni || ''),
      date,
      dateLabel: description,
      type: `Cuota (${category})`,
      description,
      amount,
      collected: 0,
      pending: amount,
      source: 'liquidation',
    });
    deltas.set(account.id, (deltas.get(account.id) || 0) + amount);
  });
  return { lines, deltas };
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
    balance: input.balance == null || input.balance === ''
      ? existing?.balance
      : input.balance,
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
