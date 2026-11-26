/**
 * Acuerdo de deuda histórica congelada.
 * Por socio y por período: el capital autorizado no se actualiza y no lleva recargo.
 * Los meses que no están en el acuerdo siguen la regla general.
 * Los importes salen de la base; el cliente no los fija.
 */

import { money } from '../money.js';
import { duesMonthLabel } from './duesImputations.js';

const EPS = 0.009;

export const FROZEN_DUES_NOTICE = 'Deuda histórica con importe congelado por autorización administrativa. No se aplican actualizaciones ni recargos a los períodos incluidos en el acuerdo.';

function dueStamp(value) {
  const due = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : '';
}

function periodFromRaw(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const dueOn = dueStamp(raw.dueOn || raw.due_on);
  if (!dueOn) return null;
  const capitalAuthorized = money(raw.capitalAuthorized ?? raw.capital_authorized ?? raw.capital ?? 0);
  const capitalOpen = money(
    raw.capitalOpen ?? raw.capital_open ?? capitalAuthorized,
  );
  if (!(capitalAuthorized > EPS) && !(capitalOpen > EPS)) return null;
  return { dueOn, capitalAuthorized, capitalOpen };
}

/** Fila de la vista o del estado. Null si no hay acuerdo activo. */
export function frozenAgreementFromDb(row) {
  if (!row || typeof row !== 'object') return null;
  const status = String(row.status || 'active').toLowerCase();
  if (status !== 'active') return null;
  const periods = (Array.isArray(row.periods) ? row.periods : [])
    .map(periodFromRaw)
    .filter(Boolean)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const originalAmount = money(row.originalAmount ?? row.original_amount ?? 0);
  const remainingAmount = money(
    row.remainingAmount ?? row.remaining_amount ?? periods.reduce((sum, item) => sum + item.capitalOpen, 0),
  );
  const paidAmount = money(
    row.paidAmount ?? row.paid_amount ?? Math.max(0, originalAmount - remainingAmount),
  );
  return {
    id: row.id || null,
    memberId: row.memberId ?? row.member_id ?? null,
    status: 'active',
    originalAmount,
    paidAmount,
    remainingAmount,
    noRepricing: row.noRepricing !== false && row.no_repricing !== false,
    noSurcharge: row.noSurcharge !== false && row.no_surcharge !== false,
    authorizedBy: row.authorizedBy ?? row.authorized_by ?? null,
    authorizedByLabel: String(row.authorizedByLabel || row.authorized_by_label || 'Administración'),
    authorizedAt: row.authorizedAt || row.authorized_at || null,
    note: String(row.note || ''),
    periods,
  };
}

export function activeFrozenAgreement(member) {
  const raw = member?.frozenDuesAgreement
    ?? member?.meta?.frozenDuesAgreement
    ?? null;
  return frozenAgreementFromDb(raw);
}

export function frozenPeriodByDueOn(member) {
  const agreement = activeFrozenAgreement(member);
  const map = new Map();
  if (!agreement?.noRepricing && !agreement?.noSurcharge) return map;
  if (!agreement) return map;
  for (const period of agreement.periods) {
    if (period.capitalOpen > EPS) map.set(period.dueOn, period);
  }
  return map;
}

function frozenChoice(period, existing, paidOn) {
  const dueOn = period.dueOn;
  const due = new Date(`${dueOn}T12:00:00`);
  const paid = paidOn instanceof Date ? paidOn : new Date(paidOn);
  const overdue = Number.isFinite(due.getTime()) && Number.isFinite(paid.getTime()) && due < paid;
  const capital = money(period.capitalOpen);
  return {
    ...(existing || {}),
    id: dueOn,
    dueOn,
    monthKey: dueOn.slice(0, 7),
    label: existing?.label || duesMonthLabel(dueOn),
    capital,
    originalCapital: money(period.capitalAuthorized || capital),
    tariffUpdate: 0,
    lateBase: 0,
    surcharge: 0,
    payable: capital,
    kind: overdue ? 'overdue' : (existing?.kind || 'upcoming'),
    chargeScope: existing?.chargeScope || 'social',
    fromFeeLedger: existing?.fromFeeLedger === true,
    frozenHistorical: true,
    needsReview: false,
    partial: money(period.capitalAuthorized) > capital + EPS,
  };
}

/**
 * Los períodos del acuerdo quedan a su capital abierto.
 * Un mes que no está en el acuerdo no se toca.
 * No agrega meses que el acuerdo no lista.
 */
export function applyFrozenDuesPeriods(member, rows, paidOn = new Date()) {
  const agreement = activeFrozenAgreement(member);
  if (!agreement) return rows || [];
  const source = Array.isArray(rows) ? rows : [];
  const byDue = new Map();
  for (const row of source) {
    const dueOn = dueStamp(row?.dueOn);
    if (dueOn) byDue.set(dueOn, row);
  }
  const next = [];
  const consumed = new Set();
  for (const period of agreement.periods) {
    if (!(period.capitalOpen > EPS)) continue;
    const existing = byDue.get(period.dueOn) || null;
    next.push(frozenChoice(period, existing, paidOn));
    consumed.add(period.dueOn);
  }
  for (const [dueOn, row] of byDue) {
    if (consumed.has(dueOn)) continue;
    next.push(row);
  }
  return next.sort((a, b) => String(a.dueOn).localeCompare(String(b.dueOn)));
}

/**
 * El servidor vuelve a hacer este control. Acá se rechaza un schedule
 * que pide más capital que el abierto, un recargo o un total inflado.
 * Un importe menor es un pago parcial y se acepta.
 */
export function assertFrozenCollectionAuthorized(member, {
  schedule = [],
  importe = 0,
  surcharge = 0,
} = {}) {
  const map = frozenPeriodByDueOn(member);
  if (!map.size) return { ok: true, frozen: false, authorized: 0 };
  let frozenCap = 0;
  let normalCap = 0;
  let sawFrozen = false;
  for (const row of Array.isArray(schedule) ? schedule : []) {
    const dueOn = dueStamp(row?.dueOn || row?.due_on);
    if (!dueOn) continue;
    const hit = map.get(dueOn);
    const capital = money(Number(row?.capital) || 0);
    const rowSurcharge = money(Number(row?.surcharge) || 0);
    if (!hit) {
      normalCap = money(normalCap + capital);
      continue;
    }
    sawFrozen = true;
    const open = money(hit.capitalOpen ?? hit.capitalAuthorized);
    if (rowSurcharge > EPS) {
      throw new Error('El período del acuerdo histórico no admite recargo.');
    }
    if (capital > open + EPS) {
      throw new Error('El capital pedido supera el importe autorizado del acuerdo histórico.');
    }
    frozenCap = money(frozenCap + (capital > EPS ? capital : open));
  }
  if (!sawFrozen) return { ok: true, frozen: false, authorized: 0 };
  if (normalCap <= EPS && money(surcharge) > EPS) {
    throw new Error('El acuerdo histórico no admite recargo.');
  }
  const ceiling = money(frozenCap + normalCap * 1.1);
  if (money(importe) > ceiling + EPS) {
    throw new Error('El importe supera el capital autorizado. Los períodos del acuerdo histórico no llevan recargo ni actualización.');
  }
  return { ok: true, frozen: true, authorized: money(frozenCap + normalCap) };
}
