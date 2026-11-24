/**
 * Obligaciones exigibles para Cobrar cuota / Imputar.
 * Prioriza outstanding_balance + fee_ledger pending + regularizaciones admin.
 * Nunca deja que meta.unpaidCapital histórico reinsufle cuotas ya regularizadas.
 */

import { money } from '../money.js';
import { duesMonthLabel } from './duesImputations.js';
import { isFamilyDependent } from './households.js';

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
  const blob = [
    line?.type_label,
    line?.typeLabel,
    line?.description,
    line?.source,
    line?.id,
  ].map((v) => String(v || '').toLowerCase()).join(' ');
  if (/abono_tenis|abono.?tenis/.test(blob)) return true;
  return /\btenis\b/.test(blob) && !/socio familiar|socio individual|cuota \(socio/.test(blob);
}

export function feeLedgerLineIsSocial(line) {
  if (!line) return false;
  if (feeLedgerLineIsTennis(line)) return false;
  const blob = [
    line?.type_label,
    line?.typeLabel,
    line?.description,
    line?.source,
  ].map((v) => String(v || '').toLowerCase()).join(' ');
  if (/reclasific|contraajuste|sin ingreso/.test(blob)) return false;
  const pending = money(Number(line?.pending) || 0);
  if (/cuota|socio|familiar|individual|amet|liquidat/.test(blob)) return true;
  return pending > EPS;
}

function linePeriodYm(line) {
  return asYm(
    line?.line_date
    || line?.lineDate
    || line?.date
    || line?.periodYm
    || line?.period,
  );
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
      source: 'fee_ledger',
    };
    prev.capitalOpen = money(prev.capitalOpen + pending);
    prev.capital = money(Math.max(prev.capital, amount > EPS ? amount : pending, prev.capitalOpen));
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

/**
 * Choices desde pending del auxiliar.
 * Sin unpaidSurcharges en ficha: no inventa 10 % sobre capital ya regularizado.
 */
export function collectionChoicesFromFeeLedger(member, paidOn = new Date(), {
  chargeScope = 'social',
} = {}) {
  if (!member || isDuesExemptRaw(member) || isFamilyDependent(member)) return null;
  const periods = duesOpenPeriodsFromFeeLedger(member, { chargeScope });
  if (!periods.length) return null;
  const unpaidSurcharges = money(Math.max(0, Number(member?.unpaidSurcharges) || 0));
  const allowLate = unpaidSurcharges > EPS;
  const rows = periods.map((row) => {
    const dueOn = String(row.dueOn).slice(0, 10);
    const due = new Date(`${dueOn}T12:00:00`);
    const overdue = Number.isFinite(due.getTime()) && due < paidOn;
    const capital = money(row.capitalOpen);
    const surcharge = allowLate && overdue ? money(capital * 0.1) : 0;
    return {
      id: dueOn,
      dueOn,
      monthKey: dueOn.slice(0, 7),
      label: duesMonthLabel(dueOn),
      capital,
      lateBase: allowLate && overdue ? capital : 0,
      surcharge,
      payable: money(capital + surcharge),
      kind: overdue ? 'overdue' : 'upcoming',
      chargeScope: 'social',
      fromFeeLedger: true,
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
