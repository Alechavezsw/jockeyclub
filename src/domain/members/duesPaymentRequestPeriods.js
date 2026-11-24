/**
 * Período de una solicitud de pago de cuota.
 * NUNCA usa members.next_due_date como vencimiento del período que se está pagando.
 */

import { duesMonthLabel, duesMonthsPhrase } from './duesImputations.js';
import {
  duesOpenPeriodsFromFeeLedger,
  feeLedgerPendingCapital,
  socialExigibleCapitalForCollect,
} from './duesCollectObligations.js';

const EPS = 0.009;

function asDueOn(value) {
  const iso = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : '';
}

function uniqueDueOns(values) {
  const list = Array.isArray(values) ? values : [];
  const out = [];
  for (const value of list) {
    const due = asDueOn(value);
    if (due && !out.includes(due)) out.push(due);
  }
  return out.toSorted((a, b) => a.localeCompare(b));
}

/** «10 de noviembre de 2026» a partir de un dueOn. */
export function formatPeriodDueOnLabel(dueOn, { locale = 'es-AR' } = {}) {
  const iso = asDueOn(dueOn);
  if (!iso) return '';
  return new Date(`${iso}T12:00:00`).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Resuelve los períodos que cubre una solicitud / cobro.
 * Prioridad: periodDueOns explícitos → debtMonths → chargeDue.
 * Excluye nextAccountDueDate si no está entre los períodos de deuda.
 */
export function resolveDuesPaymentRequestPeriods({
  periodDueOns = null,
  debtMonths = null,
  chargeDue = null,
  nextAccountDueDate = null,
} = {}) {
  const nextAccount = asDueOn(nextAccountDueDate);
  let dueOns = uniqueDueOns(periodDueOns);
  if (!dueOns.length && Array.isArray(debtMonths)) {
    dueOns = uniqueDueOns(debtMonths.map((row) => row?.dueOn || row?.due_on));
  }
  if (!dueOns.length) {
    const charge = asDueOn(chargeDue);
    // Solo aceptar chargeDue si NO es únicamente el próximo de cuenta.
    if (charge && charge !== nextAccount) dueOns = [charge];
    else if (charge && !nextAccount) dueOns = [charge];
  }

  // Si quedó solo el next_due_date de ficha, no es el período a pagar.
  if (dueOns.length === 1 && nextAccount && dueOns[0] === nextAccount) {
    dueOns = [];
  }

  const periodLabel = duesMonthsPhrase(dueOns);
  const periodDueLabels = dueOns.map((due) => formatPeriodDueOnLabel(due)).filter(Boolean);
  return {
    periodDueOns: dueOns,
    periodLabel,
    periodDueLabel: periodDueLabels.join(', '),
    periodDueLabels,
    nextAccountDueDate: nextAccount || null,
    nextAccountDueLabel: nextAccount ? formatPeriodDueOnLabel(nextAccount) : '',
  };
}

/**
 * Arma el bloque de texto y meta estable para la solicitud.
 */
export function buildDuesPaymentRequestPeriodPayload({
  periodDueOns = null,
  debtMonths = null,
  chargeDue = null,
  nextAccountDueDate = null,
  concepts = [],
  amount = null,
} = {}) {
  const resolved = resolveDuesPaymentRequestPeriods({
    periodDueOns,
    debtMonths,
    chargeDue,
    nextAccountDueDate,
  });
  const lines = [];
  if (resolved.periodLabel) lines.push(`Período: ${resolved.periodLabel}`);
  if (resolved.periodDueLabel) lines.push(`Vencimiento del período: ${resolved.periodDueLabel}`);
  if (
    resolved.nextAccountDueDate
    && !resolved.periodDueOns.includes(resolved.nextAccountDueDate)
  ) {
    lines.push(`Próximo vencimiento de cuenta: ${resolved.nextAccountDueLabel}`);
  }
  return {
    ...resolved,
    concepts: Array.isArray(concepts) ? concepts.filter(Boolean) : [],
    amount: amount == null || amount === '' ? null : Number(amount),
    lines,
    /** Etiqueta corta para UI legacy (solo período, nunca next_due_date). */
    dueLabel: resolved.periodDueLabel || resolved.periodLabel || '',
  };
}

/**
 * Lee el período persistido en una solicitud (meta). Fallback seguro para históricas.
 */
export function appPaymentRequestPeriodsFromMeta(message) {
  const meta = message?.meta && typeof message.meta === 'object' ? message.meta : {};
  const fromMeta = uniqueDueOns(meta.periodDueOns || meta.period_due_ons);
  if (fromMeta.length) {
    return resolveDuesPaymentRequestPeriods({
      periodDueOns: fromMeta,
      nextAccountDueDate: meta.nextAccountDueDate || meta.next_account_due_date,
    });
  }
  if (meta.periodLabel || meta.period_label) {
    return {
      periodDueOns: [],
      periodLabel: String(meta.periodLabel || meta.period_label),
      periodDueLabel: String(meta.periodDueLabel || meta.period_due_label || ''),
      periodDueLabels: [],
      nextAccountDueDate: asDueOn(meta.nextAccountDueDate || meta.next_account_due_date) || null,
      nextAccountDueLabel: '',
    };
  }
  return null;
}

/**
 * Históricas sin meta: reconstruye desde ledger/exigible del socio.
 * No usa next_due_date. No altera pagos.
 */
export function resolveHistoricalAppPaymentRequestPeriods(message, member) {
  const persisted = appPaymentRequestPeriodsFromMeta(message);
  if (persisted?.periodDueOns?.length || persisted?.periodLabel) return persisted;

  const nextAccount = asDueOn(member?.nextDueDate || member?.next_due_date);
  const social = duesOpenPeriodsFromFeeLedger(member, { chargeScope: 'social' })
    .map((row) => row.dueOn);
  const tennis = duesOpenPeriodsFromFeeLedger(member, { chargeScope: 'abono_tenis' })
    .map((row) => row.dueOn);
  const dueOns = uniqueDueOns([...social, ...tennis]);
  if (dueOns.length) {
    return resolveDuesPaymentRequestPeriods({
      periodDueOns: dueOns,
      nextAccountDueDate: nextAccount,
    });
  }

  // Último recurso: meses de deuda en ficha abierta, nunca next_due solo.
  const open = Array.isArray(member?.duesOpenPeriods) ? member.duesOpenPeriods : [];
  const openDueOns = uniqueDueOns(open.map((row) => row?.dueOn || row?.due_on));
  return resolveDuesPaymentRequestPeriods({
    periodDueOns: openDueOns,
    nextAccountDueDate: nextAccount,
  });
}

export function appPaymentRequestPeriodDisplay(message, member = null) {
  const resolved = member
    ? resolveHistoricalAppPaymentRequestPeriods(message, member)
    : appPaymentRequestPeriodsFromMeta(message);
  if (!resolved) return { periodLabel: '', periodDueLabel: '', nextAccountDueLabel: '' };
  return {
    periodLabel: resolved.periodLabel || '',
    periodDueLabel: resolved.periodDueLabel || '',
    nextAccountDueLabel: resolved.nextAccountDueLabel || '',
    periodDueOns: resolved.periodDueOns || [],
  };
}

/** ¿El importe de la solicitud cuadra con el capital exigible actual? */
export function appPaymentRequestAmountMatchesMember(message, member, amount) {
  const asked = Number(amount);
  if (!(asked > EPS) || !member) return false;
  const social = socialExigibleCapitalForCollect(member);
  const tennis = feeLedgerPendingCapital(member, { chargeScope: 'abono_tenis' });
  const total = Math.round((social + tennis) * 100) / 100;
  const ficha = Math.max(0, Number(member.outstandingBalance) || 0);
  const target = total > EPS ? total : ficha;
  return Math.abs(asked - target) <= 1.01;
}
