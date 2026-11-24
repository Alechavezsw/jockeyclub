/**
 * Obligaciones exigibles para Cobrar cuota / Imputar.
 * Prioriza outstanding_balance + fee_ledger pending + regularizaciones admin.
 * Nunca deja que meta.unpaidCapital histórico reinsufle cuotas ya regularizadas.
 */

import { money } from '../money.js';
import { duesMonthLabel } from './duesImputations.js';
import { isFamilyDependent } from './households.js';
import { DUES_LATE_RATE, DUES_LATE_TIER_IDS } from './tiers.js';

const EPS = 0.009;
const DEFAULT_DUE_DAY = 10;

function asYm(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 7);
  return '';
}

function dueOnFromPeriodYm(periodYm, dueDay = DEFAULT_DUE_DAY) {
  const ym = asYm(periodYm);
  if (!ym) return '';
  const day = String(dueDay).padStart(2, '0');
  return `${ym}-${day}`;
}

function ledgerLinesOf(member) {
  if (Array.isArray(member?.feeLedgerLines)) return member.feeLedgerLines;
  if (Array.isArray(member?.meta?.feeLedgerLines)) return member.meta.feeLedgerLines;
  return [];
}

function duesOpenPeriodsRaw(member) {
  if (Array.isArray(member?.duesOpenPeriods)) return member.duesOpenPeriods;
  if (Array.isArray(member?.meta?.duesOpenPeriods)) return member.meta.duesOpenPeriods;
  return null;
}

function lilaUnpaidCapitalRaw(member) {
  const raw = member?.unpaidCapital ?? member?.meta?.unpaidCapital;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function isDuesExemptRaw(member) {
  const tier = String(member?.tier || '').toLowerCase();
  return /vitalicio|fundador|comision|comisión/.test(tier);
}

/** ¿La línea es abono tenis (no cuota social)? */
export function feeLedgerLineIsTennis(line) {
  const blob = lineBlob(line);
  if (/abono_tenis|abono.?tenis/.test(blob)) return true;
  return /\btenis\b/.test(blob) && !/socio familiar|socio individual|cuota \(socio/.test(blob);
}

export function feeLedgerLineIsSocial(line) {
  if (!line) return false;
  if (feeLedgerLineIsTennis(line) || feeLedgerLineIsSurcharge(line) || feeLedgerLineIsUnassignedAdjustment(line)) {
    return false;
  }
  const blob = lineBlob(line);
  if (/reclasific|contraajuste|sin ingreso/.test(blob)) return false;
  const pending = money(Number(line?.pending) || 0);
  if (/cuota|socio|familiar|individual|amet|liquidat/.test(blob)) return true;
  if (!linePeriodYm(line)) return false;
  return pending > EPS;
}

const MONTH_NUMBER = {
  enero: '01',
  febrero: '02',
  marzo: '03',
  abril: '04',
  mayo: '05',
  junio: '06',
  julio: '07',
  agosto: '08',
  septiembre: '09',
  setiembre: '09',
  octubre: '10',
  noviembre: '11',
  diciembre: '12',
};

function periodYmFromText(value) {
  const text = String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const match = text.match(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b(?:\s+(?:de|del))?\s+(20\d{2})/);
  if (!match) return '';
  return `${match[2]}-${MONTH_NUMBER[match[1]]}`;
}

function linePeriodYm(line) {
  return asYm(
    line?.line_date
    || line?.lineDate
    || line?.date
    || line?.periodYm
    || line?.period,
  ) || periodYmFromText(line?.description);
}

function lineBlob(line) {
  return [
    line?.type,
    line?.type_label,
    line?.typeLabel,
    line?.description,
    line?.source,
    line?.id,
  ].map((value) => String(value || '').toLowerCase()).join(' ');
}

export function feeLedgerLineIsSurcharge(line) {
  return /recargo/.test(lineBlob(line));
}

/** Ajuste sin mes: no es una cuota y no se reparte solo. */
export function feeLedgerLineIsUnassignedAdjustment(line) {
  if (feeLedgerLineIsSurcharge(line) || feeLedgerLineIsTennis(line)) return false;
  const blob = lineBlob(line);
  const dated = asYm(line?.line_date || line?.lineDate || line?.date);
  if (/reclasific|contraajuste|sin ingreso/.test(blob)) return false;
  const unassigned = /connect_admin_reconciliation/.test(blob) && !/imputed/.test(blob);
  const named = /ajuste administrativo/.test(blob);
  if (!unassigned && !named) return false;
  return !dated;
}

/**
 * Regularizaciones admin de meta (batch 2026-11-24) → clears operativos.
 */
export function listFeeLedgerAdminReconcileClears(member) {
  const meta = member?.meta && typeof member.meta === 'object' ? member.meta : {};
  const out = [];
  const pushRows = (rows, partial) => {
    for (const row of rows || []) {
      const period = asYm(row?.period);
      if (!period) continue;
      const amount = money(Math.abs(Number(row?.amount) || 0));
      if (!(amount > EPS)) continue;
      const dueOn = dueOnFromPeriodYm(period, DEFAULT_DUE_DAY);
      out.push({
        id: `fee-ledger-admin-${partial ? 'partial' : 'full'}:${period}:${amount}`,
        dueOn,
        periodDueOns: [dueOn],
        amount,
        amountsByDueOn: { [dueOn]: amount },
        reason: String(row?.reason || (partial ? 'regularizado_parcialmente' : 'regularizado')),
        authorizedAt: String(row?.at || '').slice(0, 10) || null,
        adminRegularization: true,
        feeLedgerAdminReconcile: true,
        partial: Boolean(partial),
        newCash: Number(row?.newCash) || 0,
      });
    }
  };
  pushRows(meta.feeLedgerAdminReconcile, false);
  pushRows(member?.feeLedgerAdminReconcile, false);
  pushRows(meta.feeLedgerAdminPartialReconcile, true);
  pushRows(member?.feeLedgerAdminPartialReconcile, true);
  return out;
}

export function feeLedgerPendingCapital(member, { chargeScope = 'all' } = {}) {
  const scope = String(chargeScope || 'all').toLowerCase();
  let total = 0;
  for (const line of ledgerLinesOf(member)) {
    const pending = money(Number(line?.pending) || 0);
    if (!(pending > EPS)) continue;
    const tennis = feeLedgerLineIsTennis(line);
    const social = feeLedgerLineIsSocial(line);
    if (scope === 'social' || scope === 'cuota' || scope === 'quota') {
      if (!social) continue;
    } else if (scope === 'addon' || scope === 'abono_tenis' || scope === 'tenis') {
      if (!tennis) continue;
    } else if (!social && !tennis) {
      continue;
    }
    total = money(total + pending);
  }
  return money(total);
}

/**
 * Períodos abiertos sintéticos desde fee_ledger (cuando meta.duesOpenPeriods falta).
 * capital = importe original; capitalOpen = pending (remanente real).
 */
export function duesOpenPeriodsFromFeeLedger(member, { chargeScope = 'social' } = {}) {
  const scope = String(chargeScope || 'social').toLowerCase();
  const byYm = new Map();
  for (const line of ledgerLinesOf(member)) {
    const pending = money(Number(line?.pending) || 0);
    if (!(pending > EPS)) continue;
    const tennis = feeLedgerLineIsTennis(line);
    const social = feeLedgerLineIsSocial(line);
    if (scope === 'social' || scope === 'cuota' || scope === 'quota') {
      if (!social) continue;
    } else if (scope === 'addon' || scope === 'abono_tenis' || scope === 'tenis') {
      if (!tennis) continue;
    } else if (!social && !tennis) {
      continue;
    }
    const ym = linePeriodYm(line);
    if (!ym) continue;
    const amount = money(Number(line?.amount) || 0);
    const prev = byYm.get(ym) || {
      dueOn: dueOnFromPeriodYm(ym, DEFAULT_DUE_DAY),
      capital: 0,
      capitalOpen: 0,
      collected: 0,
      amount: 0,
      source: 'fee_ledger',
    };
    prev.capitalOpen = money(prev.capitalOpen + pending);
    prev.collected = money(prev.collected + (Number(line?.collected) || 0));
    prev.amount = money(prev.amount + (amount > EPS ? amount : pending));
    prev.capital = money(Math.max(prev.capital, prev.amount, prev.capitalOpen));
    byYm.set(ym, prev);
  }
  return [...byYm.values()]
    .filter((row) => row.capitalOpen > EPS)
    .toSorted((a, b) => String(a.dueOn).localeCompare(String(b.dueOn)));
}

export function effectiveDuesOpenPeriods(member, { chargeScope = 'social' } = {}) {
  const stored = duesOpenPeriodsRaw(member);
  if (Array.isArray(stored) && stored.length) return stored;
  const fromLedger = duesOpenPeriodsFromFeeLedger(member, { chargeScope });
  if (fromLedger.length) return fromLedger;
  return stored;
}

/**
 * Capital social exigible para armar el cobro.
 * Orden: ledger pending social → outstanding − tenis → nunca unpaidCapital si contradice.
 */
export function socialExigibleCapitalForCollect(member) {
  const outstanding = money(Math.max(0, Number(member?.outstandingBalance) || 0));
  const tennisPending = feeLedgerPendingCapital(member, { chargeScope: 'abono_tenis' });
  const socialLedger = feeLedgerPendingCapital(member, { chargeScope: 'social' });
  if (socialLedger > EPS) return socialLedger;
  if (outstanding > EPS) return money(Math.max(0, outstanding - tennisPending));
  const lila = lilaUnpaidCapitalRaw(member);
  if (lila != null && lila > EPS) return money(Math.max(0, lila - tennisPending));
  return 0;
}

function memberAllowsMonthlyLate(member) {
  const tier = String(member?.tier || '').trim().toLowerCase();
  if (!tier) return true;
  return DUES_LATE_TIER_IDS.has(tier);
}

function recordedSurchargeByYm(member) {
  const map = new Map();
  for (const line of ledgerLinesOf(member)) {
    if (!feeLedgerLineIsSurcharge(line)) continue;
    const pending = money(Number(line?.pending) || 0);
    if (!(pending > EPS)) continue;
    const ym = linePeriodYm(line);
    if (!ym) continue;
    map.set(ym, money((map.get(ym) || 0) + pending));
  }
  return map;
}

function rawUnassignedAdjustment(member) {
  const lines = [];
  let amount = 0;
  for (const line of ledgerLinesOf(member)) {
    if (!feeLedgerLineIsUnassignedAdjustment(line)) continue;
    const pending = money(Number(line?.pending) || 0);
    if (!(pending > EPS)) continue;
    amount = money(amount + pending);
    lines.push({
      id: String(line?.id || ''),
      description: String(line?.description || line?.type || line?.type_label || 'Ajuste sin período'),
      pending,
      source: String(line?.source || ''),
    });
  }
  return { amount, lines };
}

const HISTORY_MONTHS = [
  ['septiembre', '09'],
  ['setiembre', '09'],
  ['noviembre', '11'],
  ['diciembre', '12'],
  ['febrero', '02'],
  ['octubre', '10'],
  ['agosto', '08'],
  ['enero', '01'],
  ['marzo', '03'],
  ['abril', '04'],
  ['junio', '06'],
  ['julio', '07'],
  ['mayo', '05'],
  ['sep', '09'],
  ['set', '09'],
  ['nov', '11'],
  ['dic', '12'],
  ['feb', '02'],
  ['oct', '10'],
  ['ago', '08'],
  ['ene', '01'],
  ['mar', '03'],
  ['abr', '04'],
  ['jun', '06'],
  ['jul', '07'],
  ['may', '05'],
];

const HISTORY_MONTH_RE = new RegExp(
  `\\b(${HISTORY_MONTHS.map(([name]) => name).join('|')})\\b`,
  'g',
);

function historyMonthNumber(name) {
  return HISTORY_MONTHS.find(([label]) => label === name)?.[1] || '';
}

function plainHistoryText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function historyPeriodsInText(concept, date) {
  const text = plainHistoryText(concept);
  const years = [...text.matchAll(/\b(20\d{2})\b/g)].map((match) => match[1]);
  const year = years.length === 1
    ? years[0]
    : (String(date || '').slice(0, 4) || '');
  if (!year) return [];
  const found = [];
  for (const match of text.matchAll(HISTORY_MONTH_RE)) {
    const month = historyMonthNumber(match[1]);
    if (month) found.push(`${year}-${month}`);
  }
  return [...new Set(found)];
}

function normalizeHistoryRow(raw) {
  if (Array.isArray(raw)) {
    return {
      date: String(raw[1] || '').slice(0, 10),
      type: String(raw[2] || ''),
      concept: String(raw[3] || ''),
      value: Number(raw[4]) || 0,
    };
  }
  if (!raw || typeof raw !== 'object') return null;
  return {
    date: String(raw.date || raw.line_date || raw.lineDate || '').slice(0, 10),
    type: String(raw.type || raw.line_type || raw.type_label || ''),
    concept: String(raw.concept || raw.description || ''),
    value: Number(raw.value ?? raw.amount) || 0,
  };
}

function historyRowsOf(member) {
  const raw = member?.accessinHistory || member?.meta?.accessinHistory;
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeHistoryRow).filter(Boolean);
}

function historyBlob(row) {
  return plainHistoryText(`${row.type} ${row.concept}`);
}

function historyIsSocialRow(row) {
  const blob = historyBlob(row);
  if (/tenis|pulsera|reserva|salon|espacio verde|cancha/.test(blob)) return false;
  if (/^saldo anterior\b/.test(plainHistoryText(row.type))) return false;
  return /cuota|recargo|pago|bonific|actualizacion/.test(blob);
}

function emptyHistoryMonth() {
  return { capital: 0, surcharge: 0, extra: 0, paid: 0 };
}

function historyRemaining(bucket, field) {
  const before = field === 'capital'
    ? 0
    : field === 'surcharge'
      ? bucket.capital
      : bucket.capital + bucket.surcharge;
  return money(Math.max(0, bucket[field] - Math.max(0, bucket.paid - before)));
}

function applyHistoryPayment(bucket, amount) {
  const room = money(bucket.capital + bucket.surcharge + bucket.extra - bucket.paid);
  const used = money(Math.min(Math.max(0, room), Math.max(0, amount)));
  bucket.paid = money(bucket.paid + used);
  return money(Math.max(0, amount - used));
}

/**
 * Meses de cuota social según el historial LILA.
 * Un pago con mes va a esos meses. Uno del mismo día cancela esa cuota.
 * Lo que no tiene mes no abre un período.
 */
export function accessinSocialMonths(rows) {
  const months = new Map();
  const ensure = (ym) => {
    if (!months.has(ym)) months.set(ym, emptyHistoryMonth());
    return months.get(ym);
  };
  const ordered = (Array.isArray(rows) ? rows : [])
    .map(normalizeHistoryRow)
    .filter((row) => row && historyIsSocialRow(row))
    .toSorted((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      if (byDate) return byDate;
      const rank = (row) => (/pago|bonific/.test(plainHistoryText(row.type)) ? 1 : 0);
      return rank(a) - rank(b);
    });

  const payments = [];
  for (const row of ordered) {
    const type = plainHistoryText(row.type);
    const periods = historyPeriodsInText(row.concept, row.date);
    const amount = money(Math.abs(row.value));
    if (!(amount > EPS)) continue;
    if (/^cuota\b/.test(type) && row.value > 0) {
      const ym = periods[0] || asYm(row.date);
      if (ym) ensure(ym).capital = money(ensure(ym).capital + amount);
      continue;
    }
    if (/recargo/.test(type) && row.value > 0) {
      const ym = periods[0] || asYm(row.date);
      if (ym) ensure(ym).surcharge = money(ensure(ym).surcharge + amount);
      continue;
    }
    if (/actualizacion/.test(historyBlob(row)) && row.value > 0 && periods.length) {
      let left = amount;
      const named = [...periods].toSorted();
      named.forEach((ym, index) => {
        const share = index === named.length - 1 ? left : money(amount / named.length);
        ensure(ym).extra = money(ensure(ym).extra + share);
        left = money(Math.max(0, left - share));
      });
      continue;
    }
    if (row.value < 0 && (/pago|bonific/.test(type) || /bonific/.test(historyBlob(row)))) {
      payments.push({ ...row, periods, amount });
    }
  }

  for (const payment of payments) {
    let left = payment.amount;
    const named = payment.periods.filter((ym) => months.has(ym));
    const targets = named.length
      ? named
      : (!plainHistoryText(payment.concept) || plainHistoryText(payment.concept) === payment.date
        ? [...months.keys()].filter((ym) => asYm(payment.date) === ym)
        : []);
    for (const ym of targets.toSorted()) {
      if (!(left > EPS)) break;
      left = applyHistoryPayment(months.get(ym), left);
    }
  }

  return [...months.entries()]
    .map(([ym, bucket]) => ({
      ym,
      dueOn: dueOnFromPeriodYm(ym, DEFAULT_DUE_DAY),
      originalCapital: money(bucket.capital),
      capitalOpen: historyRemaining(bucket, 'capital'),
      historicalSurcharge: historyRemaining(bucket, 'surcharge'),
      applied: money(Math.min(bucket.capital, bucket.paid)),
    }))
    .filter((row) => row.originalCapital > EPS)
    .toSorted((a, b) => a.ym.localeCompare(b.ym));
}

function ledgerSocialCoverage(member) {
  const covered = new Set();
  const open = new Set();
  for (const line of ledgerLinesOf(member)) {
    if (!feeLedgerLineIsSocial(line)) continue;
    const ym = linePeriodYm(line);
    if (!ym) continue;
    const pending = money(Number(line?.pending) || 0);
    const collected = money(Number(line?.collected) || 0);
    const amount = money(Number(line?.amount) || 0);
    if (pending > EPS) open.add(ym);
    else if (collected > EPS || amount > EPS) covered.add(ym);
  }
  for (const row of listFeeLedgerAdminReconcileClears(member)) {
    const ym = asYm(row?.dueOn);
    if (ym) covered.add(ym);
  }
  return { covered, open };
}

function collectionYm(paidOn) {
  const date = paidOn instanceof Date ? paidOn : new Date(paidOn);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function unexplainedSocialGap(member) {
  const outstanding = money(Math.max(0, Number(member?.outstandingBalance) || 0));
  const social = feeLedgerPendingCapital(member, { chargeScope: 'social' });
  const tennis = feeLedgerPendingCapital(member, { chargeScope: 'abono_tenis' });
  let surcharge = 0;
  for (const line of ledgerLinesOf(member)) {
    if (!feeLedgerLineIsSurcharge(line)) continue;
    surcharge = money(surcharge + (Number(line?.pending) || 0));
  }
  return money(Math.max(0, outstanding - social - tennis - surcharge));
}

/**
 * Meses del historial que explican el saldo sin período.
 * No reabre un mes cobrado o regularizado y no pasa del saldo sin explicar.
 */
export function planHistoryBackedMonths(member, paidOn = new Date()) {
  const history = accessinSocialMonths(historyRowsOf(member));
  const gap = unexplainedSocialGap(member);
  const { covered, open } = ledgerSocialCoverage(member);
  const currentYm = collectionYm(paidOn);
  let budget = gap;
  let consumed = 0;
  const consume = (amount) => {
    const used = money(Math.min(budget, amount));
    if (!(used > EPS)) return false;
    budget = money(budget - used);
    consumed = money(consumed + used);
    return true;
  };

  for (const row of history) {
    if (!open.has(row.ym) || covered.has(row.ym)) continue;
    if (!(row.historicalSurcharge > EPS)) continue;
    consume(row.historicalSurcharge);
  }

  const add = [];
  for (const row of history) {
    if (!(row.capitalOpen > EPS)) continue;
    if (covered.has(row.ym) || open.has(row.ym)) continue;
    if (currentYm && row.ym > currentYm) continue;
    const cost = money(row.capitalOpen + row.historicalSurcharge);
    if (cost > budget + EPS) continue;
    if (!consume(cost)) continue;
    add.push({
      dueOn: row.dueOn,
      capital: row.originalCapital,
      capitalOpen: row.capitalOpen,
      collected: row.applied,
      amount: row.originalCapital,
      historicalSurcharge: row.historicalSurcharge,
      source: 'accessin-history',
    });
  }

  return { add, consumed, gap };
}

/**
 * Saldo del libro que no tiene mes. Si el historial ya lo asigna, no se vuelve a mostrar.
 * No se cobra como cuota ni se reparte solo.
 */
export function unreconciledHistoricalBalance(member, paidOn = new Date()) {
  const raw = rawUnassignedAdjustment(member);
  const plan = historyRowsOf(member).length
    ? planHistoryBackedMonths(member, paidOn)
    : { consumed: 0, add: [] };
  const explained = money(Math.min(raw.amount, plan.consumed));
  const amount = money(Math.max(0, raw.amount - explained));
  return {
    amount,
    explained,
    lines: amount > EPS ? raw.lines : [],
    selectable: false,
    assignedMonths: plan.add.map((row) => row.dueOn),
  };
}

/**
 * Cada mes abierto sale a la tarifa vigente si está impago entero.
 * Un pago parcial conserva el remanente. Un recargo ya anotado no se vuelve a sumar.
 * El saldo de ficha no se reescribe.
 */
export function collectionChoicesFromFeeLedger(member, paidOn = new Date(), {
  chargeScope = 'social',
  tariffOf = null,
} = {}) {
  if (!member || isDuesExemptRaw(member) || isFamilyDependent(member)) return null;
  const scope = String(chargeScope || 'social').toLowerCase();
  const tennisScope = scope === 'addon' || scope === 'abono_tenis' || scope === 'tenis';
  const ledgerPeriods = duesOpenPeriodsFromFeeLedger(member, { chargeScope });
  const historyPeriods = tennisScope ? [] : planHistoryBackedMonths(member, paidOn).add;
  const seen = new Set(ledgerPeriods.map((row) => String(row.dueOn).slice(0, 7)));
  const periods = [
    ...ledgerPeriods,
    ...historyPeriods.filter((row) => !seen.has(String(row.dueOn).slice(0, 7))),
  ].toSorted((a, b) => String(a.dueOn).localeCompare(String(b.dueOn)));
  if (!periods.length) return null;
  const recorded = recordedSurchargeByYm(member);
  const allowsLate = !tennisScope && memberAllowsMonthlyLate(member);
  const rows = periods.map((row) => {
    const dueOn = String(row.dueOn).slice(0, 10);
    const due = new Date(`${dueOn}T12:00:00`);
    const overdue = Number.isFinite(due.getTime()) && due < paidOn;
    const pending = money(row.capitalOpen);
    const applied = money(row.collected || 0);
    const originalCapital = money(row.amount || row.capital || pending);
    const partial = applied > EPS && pending + EPS < originalCapital;
    let capital = pending;
    let tariffUpdate = 0;
    let needsReview = false;
    if (!partial && !tennisScope && typeof tariffOf === 'function') {
      const raw = tariffOf(dueOn);
      const tariff = raw == null ? NaN : Number(raw);
      if (!Number.isFinite(tariff) || tariff <= EPS) {
        needsReview = true;
      } else {
        capital = money(tariff);
        tariffUpdate = money(Math.max(0, capital - pending));
      }
    }
    const alreadyCharged = money(recorded.get(dueOn.slice(0, 7)) || 0);
    let surcharge = 0;
    if (needsReview || tennisScope) surcharge = 0;
    else if (alreadyCharged > EPS) surcharge = alreadyCharged;
    else if (!partial && overdue && allowsLate) surcharge = money(capital * DUES_LATE_RATE);
    return {
      id: dueOn,
      dueOn,
      monthKey: dueOn.slice(0, 7),
      label: duesMonthLabel(dueOn),
      capital,
      originalCapital,
      applied,
      tariffUpdate,
      lateBase: surcharge > EPS ? capital : 0,
      surcharge,
      payable: money(capital + surcharge),
      kind: overdue ? 'overdue' : 'upcoming',
      chargeScope: tennisScope ? 'abono_tenis' : 'social',
      fromFeeLedger: true,
      fromAccessinHistory: row.source === 'accessin-history',
      historicalSurcharge: money(row.historicalSurcharge || 0),
      needsReview,
      partial,
    };
  }).filter((row) => row.capital > EPS);
  return rows.length ? rows : null;
}

export function appRequestMatchesExigibleCapital(member, requestAmount, { tolerance = 1 } = {}) {
  const asked = money(Number(requestAmount) || 0);
  if (!(asked > EPS)) return false;
  const social = socialExigibleCapitalForCollect(member);
  const tennis = feeLedgerPendingCapital(member, { chargeScope: 'abono_tenis' });
  const total = money(social + tennis);
  const ficha = money(Math.max(0, Number(member?.outstandingBalance) || 0));
  const target = total > EPS ? total : ficha;
  return Math.abs(asked - target) <= tolerance + EPS;
}

export function totalExigibleCapitalForCollect(member) {
  const social = socialExigibleCapitalForCollect(member);
  const tennis = feeLedgerPendingCapital(member, { chargeScope: 'abono_tenis' });
  const fromParts = money(social + tennis);
  if (fromParts > EPS) return fromParts;
  return money(Math.max(0, Number(member?.outstandingBalance) || 0));
}
