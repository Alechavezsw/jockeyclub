/**
 * Cuentas contables de cuotas: un balde por categoría con tarifa.
 *
 * El saldo es el pendiente vivo (cuota del 10, recargo del 11). No usar el stock LILA.
 * buildFeeAccountLedgerLines vive en ./feeAccountLedger: no importarlo desde acá
 * (el snapshot de Accessin no puede entrar al chunk del store).
 */

import {
  duesAmountForTier,
  duesPayableAmount,
  firstUnpaidDuesDate,
  isDuesExemptMember,
  isMemberBillingActive,
  monthsBehindOnDues,
  pinDuesDueDate,
} from '../members/dues';
import { memberNumberOf } from '../members/households';
import {
  DATITA_CUOTA_CATEGORY_NAMES,
  parseCuotaCategories,
  slugifyTierId,
} from '../members/tiers';

const MAX_MONTHS = 36;
const EPS = 0.009;

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** Ids viejos de LILA para Familiar e Individual, así el libro ya cargado sigue apuntando. */
const LEGACY_FEE_ACCOUNTS = {
  socio_familiar: {
    id: 'fca-31',
    accessinId: 31,
    name: 'SOCIO FAMILIAR',
  },
  socio_individual: {
    id: 'fca-33',
    accessinId: 33,
    name: 'SOCIOS INDIVIDUALES',
  },
};

function foldAccountText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function categoryKey(value) {
  return slugifyTierId(value);
}

function asIsoDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value || '').slice(0, 10);
}

function shiftDue(iso, monthDelta) {
  const stamp = asIsoDate(iso);
  const d = new Date(`${stamp}T12:00:00`);
  if (Number.isNaN(d.getTime())) return stamp;
  d.setMonth(d.getMonth() + monthDelta);
  return pinDuesDueDate(d) || stamp;
}

function memberBillingCategories(member) {
  const names = parseCuotaCategories(member?.cuotaCategories);
  if (names.length) return names;
  const tier = String(member?.tier || '').trim();
  return tier ? [tier] : [];
}

function uid(prefix = 'fca') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Categorías del padrón que esta app cobra (tarifa > 0). */
export function billableFeeCategoryNames(on = new Date()) {
  return DATITA_CUOTA_CATEGORY_NAMES.filter((name) => (
    duesAmountForTier(slugifyTierId(name), undefined, on) > 0
  ));
}

export function defaultFeeChartAccount(name, on = new Date()) {
  const slug = slugifyTierId(name);
  const legacy = LEGACY_FEE_ACCOUNTS[slug];
  return {
    id: legacy?.id || `fca-${slug}`,
    accessinId: legacy?.accessinId || null,
    name: legacy?.name || name,
    description: name,
    feeCategories: [name],
    balance: 0,
    detailAccountLabel: legacy?.name || name,
    isActive: true,
    source: 'app',
    tariff: duesAmountForTier(slug, undefined, on),
  };
}

export function defaultFeeChartAccounts(on = new Date()) {
  return billableFeeCategoryNames(on).map((name) => defaultFeeChartAccount(name, on));
}

/** Semilla del plan. El balance se calcula vivo; acá va 0. */
export const ACCESSIN_FEE_CHART_ACCOUNTS = defaultFeeChartAccounts('2026-10-01');

export function feeChartAccountCounts(list = ACCESSIN_FEE_CHART_ACCOUNTS) {
  return (list || []).filter((account) => account && account.isActive !== false).length;
}

function sortFeeAccounts(list) {
  return [...(list || [])].toSorted((a, b) => (
    (Number(a.accessinId) || 9999) - (Number(b.accessinId) || 9999)
    || String(a.name || '').localeCompare(String(b.name || ''), 'es')
  ));
}

/**
 * Completa el plan con las categorías que cobran. Conserva altas manuales.
 * Tira el stock LILA: el saldo se pinta después con el pendiente vivo.
 */
export function resolveFeeChartAccounts(loaded, on = new Date()) {
  const seed = defaultFeeChartAccounts(on);
  const byId = new Map(seed.map((account) => [account.id, { ...account }]));
  const seedSlugs = new Set(seed.flatMap((account) => (
    (account.feeCategories || []).map(categoryKey)
  )));

  for (const account of loaded || []) {
    if (!account?.id) continue;
    const existing = byId.get(account.id);
    if (existing) {
      byId.set(account.id, {
        ...existing,
        name: account.name || existing.name,
        description: account.description || existing.description,
        feeCategories: (account.feeCategories || []).length
          ? account.feeCategories
          : existing.feeCategories,
        detailAccountLabel: account.detailAccountLabel || existing.detailAccountLabel,
        isActive: account.isActive !== false,
        source: account.source === 'manual' ? 'manual' : existing.source,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
        balance: 0,
      });
      continue;
    }
    if (account.source === 'lila' || account.source === 'accessin') continue;
    const slugs = (account.feeCategories || []).map(categoryKey);
    if (slugs.length && slugs.every((slug) => seedSlugs.has(slug))) continue;
    byId.set(account.id, { ...account, balance: Number(account.balance) || 0 });
  }

  return sortFeeAccounts([...byId.values()]);
}

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

function accountMatchesCategory(account, categoryName) {
  if (!account || account.isActive === false) return false;
  const want = categoryKey(categoryName);
  return (account.feeCategories || []).some((name) => categoryKey(name) === want);
}

/** Cuenta del plan que corresponde a una categoría de cuota. */
export function matchFeeLedgerAccountForCategory(accounts = [], categoryName) {
  if (!categoryKey(categoryName)) return null;
  return (accounts || []).find((account) => accountMatchesCategory(account, categoryName)) || null;
}

/** Primera cuenta que matchee alguna categoría del socio. */
export function matchFeeLedgerAccount(accounts = [], member) {
  for (const name of memberBillingCategories(member)) {
    const hit = matchFeeLedgerAccountForCategory(accounts, name);
    if (hit) return hit;
  }
  return null;
}

function monthRow(dueOn, capital, interest) {
  const stamp = asIsoDate(dueOn);
  const month = Number(stamp.slice(5, 7));
  const year = stamp.slice(0, 4);
  return {
    periodKey: stamp.slice(0, 7),
    periodLabel: `${MONTHS_ES[month - 1] || stamp} del ${year}`,
    dueOn: stamp,
    date: `${stamp.slice(0, 7)}-01`,
    dateLabel: `01 de ${MONTHS_ES[month - 1] || ''} del ${year}`,
    capital,
    interest,
    amount: capital + interest,
  };
}

function takeCategoryMonth(member, slug, dueOn, leftover, { today, applyLate }) {
  const capitalBase = Math.round(duesAmountForTier(slug, undefined, dueOn));
  const payable = applyLate
    ? Math.round(duesPayableAmount(capitalBase, { paidOn: today, dueOn, tier: slug }))
    : capitalBase;
  const interestBase = Math.max(0, payable - capitalBase);
  if (capitalBase <= 0 && interestBase <= 0) return { leftover, row: null, status: 'zero' };

  const capital = Math.min(capitalBase, leftover);
  let next = Math.round((leftover - capital) * 100) / 100;
  const interest = next > EPS ? Math.min(interestBase, next) : 0;
  next = Math.round((next - interest) * 100) / 100;
  if (capital <= EPS && interest <= EPS) return { leftover: next, row: null, status: 'ok' };
  return { leftover: next, row: monthRow(dueOn, capital, interest), status: 'ok' };
}

function categoryShareOfBalance(member, categoryName, on) {
  const persisted = Number(member?.outstandingBalance) || 0;
  const cats = memberBillingCategories(member);
  let total = 0;
  let mine = 0;
  for (const name of cats) {
    const weight = duesAmountForTier(slugifyTierId(name), undefined, on);
    total += weight;
    if (categoryKey(name) === categoryKey(categoryName)) mine += weight;
  }
  if (persisted > EPS && total > EPS && mine > EPS) {
    return Math.round(persisted * (mine / total) * 100) / 100;
  }
  return 0;
}

function syntheticCategoryUnpaid(member, slug, firstUnpaid, monthsBehind, today) {
  let dueOn = firstUnpaid;
  let total = 0;
  const n = Math.min(Math.max(monthsBehind, 0), MAX_MONTHS);
  for (let i = 0; i < n; i += 1) {
    const capital = duesAmountForTier(slug, undefined, dueOn);
    total += duesPayableAmount(capital, { paidOn: today, dueOn, tier: slug });
    dueOn = shiftDue(dueOn, 1);
  }
  return Math.round(total);
}

function allocateCategoryMonths(member, categoryName, { today = new Date() } = {}) {
  const slug = categoryKey(categoryName);
  const todayIso = asIsoDate(today);
  const firstUnpaid = firstUnpaidDuesDate({
    lastPaymentDate: member.lastPaymentDate,
    nextDueDate: member.nextDueDate,
    today,
  });
  const monthsBehind = monthsBehindOnDues({
    lastPaymentDate: member.lastPaymentDate,
    nextDueDate: member.nextDueDate,
    today,
  });

  let remaining = categoryShareOfBalance(member, categoryName, today);
  if (remaining <= EPS) {
    remaining = syntheticCategoryUnpaid(member, slug, firstUnpaid, monthsBehind, today);
  }
  if (remaining <= EPS) return [];

  const current = [];
  const older = [];
  let leftover = remaining;
  let dueOn = firstUnpaid;

  for (let i = 0; i < MAX_MONTHS && leftover > EPS; i += 1) {
    if (!dueOn || dueOn > todayIso) break;
    const taken = takeCategoryMonth(member, slug, dueOn, leftover, { today, applyLate: true });
    leftover = taken.leftover;
    if (taken.status === 'zero') break;
    if (taken.row) current.push(taken.row);
    dueOn = shiftDue(dueOn, 1);
  }

  const lastPaidDue = pinDuesDueDate(member.lastPaymentDate);
  let olderDue = lastPaidDue
    ? shiftDue(lastPaidDue, -1)
    : shiftDue(current[0]?.dueOn || firstUnpaid, -1);

  for (let i = 0; i < MAX_MONTHS && leftover > EPS; i += 1) {
    if (!olderDue || current.length + older.length >= MAX_MONTHS) break;
    const taken = takeCategoryMonth(member, slug, olderDue, leftover, { today, applyLate: false });
    leftover = taken.leftover;
    if (taken.status === 'zero') break;
    if (taken.row) older.push(taken.row);
    olderDue = shiftDue(olderDue, -1);
  }

  return [...older.reverse(), ...current];
}

function memberMayAppear(member) {
  if (isDuesExemptMember(member)) return false;
  const balance = Number(member?.outstandingBalance) || 0;
  if (balance > EPS) return true;
  return isMemberBillingActive(member);
}

function ledgerLineFromMonth(account, member, categoryName, month) {
  const nro = memberNumberOf(member) || String(member?.memberId || '');
  return {
    id: `fll-${account.id}-${month.periodKey}-${nro}-${categoryKey(categoryName)}`,
    accountId: account.id,
    memberNumber: nro,
    memberName: member?.name || '',
    dni: String(member?.documentNumber || member?.dni || ''),
    date: month.date,
    dateLabel: month.dateLabel,
    type: `Cuota (${categoryName})`,
    description: month.periodLabel,
    amount: month.amount,
    collected: 0,
    pending: month.amount,
    source: 'dues',
  };
}

/** Movimientos vivos de una cuenta: cuota partida por mes, con recargo si corresponde. */
export function liveFeeAccountLedgerLines(account, members = [], { today = new Date() } = {}) {
  if (!account || account.isActive === false) return [];
  const categories = account.feeCategories || [];
  if (!categories.length) return [];
  const catKeys = new Set(categories.map(categoryKey));
  const lines = [];

  for (const member of members || []) {
    if (!memberMayAppear(member)) continue;
    const names = memberBillingCategories(member).filter((name) => catKeys.has(categoryKey(name)));
    for (const name of names) {
      const months = allocateCategoryMonths(member, name, { today });
      for (const month of months) {
        lines.push(ledgerLineFromMonth(account, member, name, month));
      }
    }
  }

  return lines.toSorted((a, b) => (
    String(b.date || '').localeCompare(String(a.date || ''))
    || String(a.memberNumber).localeCompare(String(b.memberNumber))
  ));
}

export function liveFeeAccountStats(account, members = [], { today = new Date() } = {}) {
  const lines = liveFeeAccountLedgerLines(account, members, { today });
  const membersSeen = new Set();
  let pending = 0;
  for (const line of lines) {
    pending += Number(line.pending) || 0;
    if (line.memberNumber) membersSeen.add(line.memberNumber);
  }
  return {
    billed: Math.round(pending * 100) / 100,
    collected: 0,
    pending: Math.round(pending * 100) / 100,
    memberCount: membersSeen.size,
    monthRowCount: lines.length,
  };
}

export function withLiveFeeAccountBalances(accounts = [], members = [], { today = new Date() } = {}) {
  return (accounts || []).map((account) => {
    const stats = liveFeeAccountStats(account, members, { today });
    return {
      ...account,
      ...stats,
      balance: stats.pending,
    };
  });
}

/** Cuotas de un mes liquidado para una cuenta, con la tarifa de ese mes. */
export function periodLedgerLines(account, members = [], period) {
  const stamp = periodStamp(period);
  if (!account || account.isActive === false || !stamp.key) return [];
  const categories = new Set((account.feeCategories || []).map(categoryKey));
  if (!categories.size) return [];
  const when = new Date(Number(period.year), Number(period.month) - 1, 1, 12);
  const dueOn = `${stamp.key}-10`;
  const lines = [];
  for (const member of members || []) {
    if (!isMemberBillingActive(member) || isDuesExemptMember(member)) continue;
    const names = memberBillingCategories(member);
    for (const name of names) {
      if (!categories.has(categoryKey(name))) continue;
      const slug = categoryKey(name);
      const amount = duesPayableAmount(
        duesAmountForTier(slug, undefined, when),
        { paidOn: dueOn, dueOn, tier: slug },
      );
      if (!amount) continue;
      const memberNumber = String(memberNumberOf(member) || member.memberId || '');
      lines.push({
        id: `fll-${account.id}-${stamp.key}-${memberNumber}-${slug}`,
        accountId: account.id,
        memberNumber,
        memberName: member.name || '',
        dni: String(member.documentNumber || member.dni || ''),
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

export function categoryChargesForMember(member, { paidOn = new Date(), dueOn, on } = {}) {
  const when = on || dueOn || paidOn;
  return memberBillingCategories(member).flatMap((name) => {
    const slug = categoryKey(name);
    const amount = duesPayableAmount(
      duesAmountForTier(slug, undefined, when),
      { paidOn, dueOn, tier: slug },
    );
    return amount > 0 ? [{ name, slug, amount }] : [];
  });
}

/**
 * Movimientos de una liquidación. Cada categoría del socio va a su cuenta.
 * El importe queda pendiente: el balance vivo lo vuelve a calcular el listado.
 */
export function ledgerLinesFromCharges(accounts = [], members = [], charges = [], period = {}) {
  const byMember = new Map((members || []).map((member) => [String(member.memberId), member]));
  const description = String(period.label || period.description || '').trim();
  const date = String(period.generatedAt || '').slice(0, 10);
  const dueOn = period.year && period.month
    ? `${period.year}-${String(period.month).padStart(2, '0')}-10`
    : date;
  const on = period.year && period.month
    ? new Date(Number(period.year), Number(period.month) - 1, 10, 12, 0, 0, 0)
    : date;
  const lines = [];
  const deltas = new Map();

  for (const charge of charges || []) {
    const member = byMember.get(String(charge.memberId));
    if (!member) continue;
    const explicit = charge.tierId || charge.category;
    const slices = explicit
      ? [{
        name: charge.category || charge.tierId,
        slug: charge.tierId || categoryKey(charge.category),
        amount: Math.round(Number(charge.addAmount ?? charge.amount) || 0),
      }].filter((slice) => slice.amount > 0)
      : categoryChargesForMember(member, { paidOn: date || dueOn, dueOn, on });
    for (const slice of slices) {
      const account = matchFeeLedgerAccountForCategory(accounts, slice.name);
      if (!account) continue;
      const id = `fll-${account.id}-${period.id || date}-${charge.memberId}-${slice.slug}`;
      lines.push({
        id,
        accountId: account.id,
        memberNumber: String(charge.memberId || ''),
        memberName: member?.name || '',
        dni: String(member?.documentNumber || member?.dni || ''),
        date,
        dateLabel: description,
        type: `Cuota (${slice.name})`,
        description,
        amount: slice.amount,
        collected: 0,
        pending: slice.amount,
        source: 'liquidation',
      });
      deltas.set(account.id, (deltas.get(account.id) || 0) + slice.amount);
    }
  }
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

export function ledgerLineKey(line) {
  return [
    line?.accountId || '',
    String(line?.memberNumber || ''),
    String(line?.date || '').slice(0, 7),
    categoryKey(line?.type || ''),
  ].join('|');
}

/** Une el libro vivo con liquidaciones ya guardadas, sin duplicar socio+mes. */
export function mergeFeeLedgerLines(live = [], stored = []) {
  const keys = new Set((live || []).map(ledgerLineKey));
  const extra = [];
  for (const line of stored || []) {
    const key = ledgerLineKey(line);
    if (keys.has(key)) continue;
    keys.add(key);
    extra.push(line);
  }
  return [...(live || []), ...extra].toSorted((a, b) => (
    String(b.date || '').localeCompare(String(a.date || ''))
    || String(a.memberNumber || '').localeCompare(String(b.memberNumber || ''))
  ));
}

export function feeLedgerTotals(lines = []) {
  let billed = 0;
  let collected = 0;
  let pending = 0;
  for (const line of lines || []) {
    billed += Number(line.amount) || 0;
    collected += Number(line.collected) || 0;
    pending += Number(line.pending) || 0;
  }
  return {
    billed: Math.round(billed * 100) / 100,
    collected: Math.round(collected * 100) / 100,
    pending: Math.round(pending * 100) / 100,
  };
}
