/**
 * Ajuste administrativo por período (Cobrar cuota).
 *
 * Un administrador corrige qué mes debe el socio y el capital de ese mes.
 * El ajuste vive en `dues_period_adjustments` (auditado: quién, cuándo, antes, motivo).
 *
 * Regla maestra:
 * - El saldo de la ficha no se toca.
 * - Todo ajuste tiene mes. No se crea un mes que no empezó.
 * - Un mes ya cubierto no se vuelve a abrir.
 * - El 10 % sigue siendo el de cada mes, sobre el capital exigible de ese mes.
 */

import { money } from '../money.js';
import { duesMonthLabel } from './duesImputations.js';
import { DUES_LATE_RATE, DUES_LATE_TIER_IDS } from './tiers.js';

const EPS = 0.009;

export const DUES_ADJUSTMENT_MIN_REASON = 8;

function asYm(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 7);
  return '';
}

export function adjustmentDueOn(value) {
  const ym = asYm(value);
  return ym ? `${ym}-10` : '';
}

function ymOf(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Normaliza una fila de la base (snake_case) o del estado local. */
export function duesPeriodAdjustmentFromRow(row) {
  if (!row || typeof row !== 'object') return null;
  const dueOn = adjustmentDueOn(row.due_on ?? row.dueOn);
  if (!dueOn) return null;
  const action = String(row.action || '').toLowerCase() === 'remove' ? 'remove' : 'set';
  const capitalRaw = row.capital;
  const capital = capitalRaw == null || capitalRaw === '' ? null : money(Number(capitalRaw) || 0);
  const prevRaw = row.previous_capital_open ?? row.previousCapitalOpen;
  return {
    id: String(row.id || ''),
    memberId: row.member_id ?? row.memberId ?? null,
    memberNumber: row.member_number ?? row.memberNumber ?? null,
    dueOn,
    action,
    capital,
    previousCapitalOpen: prevRaw == null || prevRaw === '' ? null : money(Number(prevRaw) || 0),
    reason: String(row.reason || ''),
    createdBy: row.created_by ?? row.createdBy ?? null,
    createdByName: String(row.created_by_name ?? row.createdByName ?? row.by ?? ''),
    createdAt: row.created_at ?? row.createdAt ?? row.at ?? null,
    voidedAt: row.voided_at ?? row.voidedAt ?? null,
    voidedByName: row.voided_by_name ?? row.voidedByName ?? null,
    voidReason: row.void_reason ?? row.voidReason ?? null,
    appliedPaymentIds: Array.isArray(row.applied_payment_ids ?? row.appliedPaymentIds)
      ? (row.applied_payment_ids ?? row.appliedPaymentIds)
      : [],
  };
}

/** Ajustes vigentes del socio, uno por mes (el más nuevo gana). */
export function activeDuesPeriodAdjustments(member) {
  const raw = Array.isArray(member?.duesPeriodAdjustments)
    ? member.duesPeriodAdjustments
    : (Array.isArray(member?.meta?.duesPeriodAdjustments) ? member.meta.duesPeriodAdjustments : []);
  const byYm = new Map();
  for (const item of raw) {
    const row = duesPeriodAdjustmentFromRow(item);
    if (!row || row.voidedAt) continue;
    if (row.action === 'set' && !(Number(row.capital) > EPS)) continue;
    const ym = row.dueOn.slice(0, 7);
    const prev = byYm.get(ym);
    if (!prev || String(row.createdAt || '') >= String(prev.createdAt || '')) byYm.set(ym, row);
  }
  return [...byYm.values()].toSorted((a, b) => a.dueOn.localeCompare(b.dueOn));
}

function allowsMonthlyLate(member) {
  const tier = String(member?.tier || '').trim().toLowerCase();
  if (!tier) return true;
  return DUES_LATE_TIER_IDS.has(tier);
}

function isTennisRow(row) {
  const scope = String(row?.chargeScope || row?.rowScope || '').toLowerCase();
  return scope === 'abono_tenis' || scope === 'addon' || scope === 'tenis';
}

function adjustmentInfo(adj) {
  return {
    id: adj.id,
    dueOn: adj.dueOn,
    action: adj.action,
    capital: adj.capital,
    previousCapitalOpen: adj.previousCapitalOpen,
    reason: adj.reason,
    by: adj.createdByName,
    at: adj.createdAt,
  };
}

/** ¿El recargo de la fila salió de la regla (10 % del capital) y no del libro? */
function surchargeIsComputed(row) {
  const surcharge = money(Number(row?.surcharge) || 0);
  const lateBase = money(Number(row?.lateBase) || 0);
  if (!(surcharge > EPS) || !(lateBase > EPS)) return false;
  return Math.abs(surcharge - money(lateBase * DUES_LATE_RATE)) <= 0.011;
}

/**
 * Aplica los ajustes vigentes sobre los meses a cobrar.
 * - remove: el mes no se ofrece.
 * - set: el mes se cobra con ese capital (más el 10 % del mes si venció).
 *   Si el mes no estaba, se agrega, salvo que no haya empezado o ya esté cubierto.
 */
export function applyDuesPeriodAdjustments(member, rows, paidOn = new Date(), {
  chargeScope = 'all',
  coveredDueOns = null,
} = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const scope = String(chargeScope || 'all').toLowerCase();
  if (scope === 'addon' || scope === 'abono_tenis' || scope === 'tenis') return list;
  const adjustments = activeDuesPeriodAdjustments(member);
  if (!adjustments.length) return list;
  const when = paidOn instanceof Date ? paidOn : new Date(paidOn);
  const currentYm = ymOf(when);
  const lateOk = allowsMonthlyLate(member);
  const byYm = new Map(adjustments.map((adj) => [adj.dueOn.slice(0, 7), adj]));
  const used = new Set();

  const surchargeFor = (dueOn, capital) => {
    const due = new Date(`${dueOn}T12:00:00`);
    const overdue = Number.isFinite(due.getTime()) && due < when;
    return overdue && lateOk ? money(capital * DUES_LATE_RATE) : 0;
  };

  const out = [];
  for (const row of list) {
    const ym = asYm(row?.dueOn);
    const adj = !isTennisRow(row) && ym ? byYm.get(ym) : null;
    if (!adj) {
      out.push(row);
      continue;
    }
    used.add(ym);
    if (adj.action === 'remove') continue;
    const capital = money(adj.capital);
    let surcharge;
    if (surchargeIsComputed(row) || !(Number(row?.surcharge) > EPS)) {
      surcharge = surchargeFor(String(row.dueOn).slice(0, 10), capital);
    } else {
      // Recargo ya anotado en el libro para ese mes: no se suma otro.
      surcharge = money(row.surcharge);
    }
    out.push({
      ...row,
      capital,
      originalCapital: money(row.originalCapital ?? row.capital),
      tariffUpdate: 0,
      needsReview: false,
      lateBase: surcharge > EPS ? capital : 0,
      surcharge,
      payable: money(capital + surcharge),
      adjustment: adjustmentInfo(adj),
    });
  }

  for (const adj of adjustments) {
    const ym = adj.dueOn.slice(0, 7);
    if (used.has(ym) || adj.action !== 'set') continue;
    // No se crea una cuota de un mes que no empezó.
    if (currentYm && ym > currentYm) continue;
    if (coveredDueOns instanceof Set && coveredDueOns.has(adj.dueOn)) continue;
    const capital = money(adj.capital);
    const surcharge = surchargeFor(adj.dueOn, capital);
    const due = new Date(`${adj.dueOn}T12:00:00`);
    out.push({
      id: adj.dueOn,
      dueOn: adj.dueOn,
      monthKey: ym,
      label: duesMonthLabel(adj.dueOn) || adj.dueOn,
      capital,
      originalCapital: 0,
      applied: 0,
      tariffUpdate: 0,
      lateBase: surcharge > EPS ? capital : 0,
      surcharge,
      payable: money(capital + surcharge),
      kind: Number.isFinite(due.getTime()) && due < when ? 'overdue' : 'upcoming',
      chargeScope: scope === 'social' ? 'social' : scope,
      needsReview: false,
      partial: false,
      adjustment: adjustmentInfo(adj),
    });
  }

  return out.toSorted((a, b) => String(a.dueOn).localeCompare(String(b.dueOn)));
}

/** Ajustes que van en el recibo de este cobro (los meses cobrados que tienen ajuste). */
export function adjustmentsForPayment(member, periodDueOns) {
  const months = new Set((Array.isArray(periodDueOns) ? periodDueOns : [])
    .map((value) => asYm(value))
    .filter(Boolean));
  if (!months.size) return [];
  return activeDuesPeriodAdjustments(member)
    .filter((adj) => adj.action === 'set' && months.has(adj.dueOn.slice(0, 7)))
    .map(adjustmentInfo);
}

/** Texto corto para el asiento y el recibo. */
export function periodAdjustmentNote(adjustments, formatAmount = (n) => `$ ${money(n)}`) {
  const list = (Array.isArray(adjustments) ? adjustments : []).filter((row) => row?.dueOn);
  if (!list.length) return '';
  const parts = list.map((row) => {
    const label = duesMonthLabel(row.dueOn) || row.dueOn.slice(0, 7);
    const by = String(row.by || '').trim();
    return `${label} ${formatAmount(Number(row.capital) || 0)}${by ? ` (${by})` : ''}`;
  });
  return `Ajuste adm.: ${parts.join(', ')}`;
}

/** Validación del formulario de admin antes de llamar a la base. */
export function validateDuesPeriodAdjustmentDraft({ dueOn, action, capital, reason }, today = new Date()) {
  const due = adjustmentDueOn(dueOn);
  if (!due) return 'Elegí el mes.';
  const current = ymOf(today);
  if (current && due.slice(0, 7) > current) return 'No se crea una cuota de un mes que no empezó.';
  const kind = String(action || '').toLowerCase();
  if (kind !== 'set' && kind !== 'remove') return 'Elegí si el mes se debe o no.';
  if (kind === 'set' && !(Number(capital) > EPS)) return 'El capital del mes tiene que ser mayor que cero.';
  if (String(reason || '').trim().length < DUES_ADJUSTMENT_MIN_REASON) {
    return `Escribí el motivo del ajuste (mínimo ${DUES_ADJUSTMENT_MIN_REASON} caracteres).`;
  }
  return '';
}
