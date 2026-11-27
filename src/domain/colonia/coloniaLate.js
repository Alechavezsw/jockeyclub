/**
 * Interés de la cuota de Colonia.
 * El capital queda en el cargo. El 15 % corre desde diciembre: el 10 de ese mes
 * entra sin interés y desde el 11 se suma al cobrar. Noviembre no lleva 15 %.
 * La inscripción, la temporada y la cuota social no entran.
 */

import { todayISODateAR } from '../../lib/arDate';
import { coloniaPlanChargedPerPupil, inscriptionAmount, planAmountFor } from './coloniaTariffs';

export const COLONIA_CUOTA_LATE_RATE = 0.15;
export const COLONIA_CUOTA_DUE_DAY = 10;

function moneyArs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function coloniaPaidOnIso(paidOn = new Date()) {
  if (paidOn instanceof Date) return todayISODateAR(paidOn);
  const raw = String(paidOn || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayISODateAR();
}

/** Mes de la cuota que se está pagando. Antes del inicio de temporada, el primer mes. */
export function coloniaCuotaMonthKey(paidOn, season) {
  const key = coloniaPaidOnIso(paidOn).slice(0, 7);
  const start = String(season?.activitiesStartOn || season?.activities_start_on || '').slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(start) && key < start) return start;
  return key;
}

/** Diciembre del año en que abre la temporada. Antes de eso no hay 15 %. */
export function coloniaInterestStartsOn(season) {
  const year = String(season?.activitiesStartOn || season?.activities_start_on || '2026-11-30').slice(0, 4);
  return `${/^\d{4}$/.test(year) ? year : '2026'}-12`;
}

/** El 10 entra sin interés. Desde el 11, y solo desde diciembre, la cuota lleva 15 %. */
export function coloniaCuotaIsLate(monthKey, paidOn, season) {
  const key = String(monthKey || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(key) || key < coloniaInterestStartsOn(season)) return false;
  const iso = coloniaPaidOnIso(paidOn);
  const due = `${key}-${String(COLONIA_CUOTA_DUE_DAY).padStart(2, '0')}`;
  return iso > due;
}

export function coloniaCuotaInterest(capital, monthKey, paidOn, season) {
  const cap = moneyArs(capital);
  if (!(cap > 0) || !coloniaCuotaIsLate(monthKey, paidOn, season)) return 0;
  return moneyArs(cap * COLONIA_CUOTA_LATE_RATE);
}

/** Lo que se cobra en la inscripción: inscripción + capital del plan + interés de la cuota. */
export function quoteColoniaEnrollmentDue({
  planKey,
  memberKind,
  pupilCount = 1,
  tariffs,
  paidOn,
  season,
} = {}) {
  const kids = Math.max(0, Number(pupilCount) || 0);
  const plan = String(planKey || '');
  const inscriptionEach = inscriptionAmount(tariffs);
  const listed = plan === 'hermano_4' ? 0 : moneyArs(planAmountFor(tariffs, memberKind, plan) || 0);
  const perPupil = coloniaPlanChargedPerPupil(memberKind, plan);
  const planEach = listed;
  const planCapital = perPupil ? moneyArs(planEach * kids) : planEach;
  const monthKey = plan === 'cuota' ? coloniaCuotaMonthKey(paidOn, season) : null;
  const interest = plan === 'cuota' ? coloniaCuotaInterest(planCapital, monthKey, paidOn, season) : 0;
  const inscription = moneyArs(inscriptionEach * kids);
  return {
    inscription,
    inscriptionEach: moneyArs(inscriptionEach),
    planEach,
    perPupil,
    planCapital,
    interest,
    monthKey,
    rate: COLONIA_CUOTA_LATE_RATE,
    late: interest > 0,
    total: moneyArs(inscription + planCapital + interest),
  };
}

/** Botones de cobro alineados con el plan: la inscripción no se disfraza de otro canon. */
export function coloniaEnrollPayChoices(args = {}) {
  const quote = quoteColoniaEnrollmentDue(args);
  const planKey = String(args.planKey || '');
  const planScopeLabel = planKey === 'temporada'
    ? 'Solo temporada'
    : planKey === 'cuota'
      ? 'Solo mes'
      : 'Solo el plan';
  const planDue = moneyArs(quote.planCapital + quote.interest);
  const choices = [];
  if (planDue > 0) {
    choices.push({
      key: 'todo',
      label: quote.inscription > 0 ? 'Plan + inscripción' : 'Todo',
      amount: quote.total,
    });
  }
  if (quote.inscription > 0) {
    choices.push({
      key: 'inscripcion',
      label: 'Solo inscripción',
      amount: quote.inscription,
    });
  }
  if (planDue > 0 && quote.inscription > 0) {
    choices.push({
      key: 'plan',
      label: planScopeLabel,
      amount: planDue,
    });
  }
  return { ...quote, planScopeLabel, choices };
}

/** Parte del cobro que baja el saldo de capital. El interés no adelanta el mes siguiente. */
export function coloniaPaymentCapital(payment) {
  const amount = moneyArs(payment?.amount);
  const raw = payment?.meta?.interestAmount
    ?? payment?.interestAmount
    ?? payment?.interest_amount
    ?? 0;
  const interest = moneyArs(raw);
  if (!(interest > 0)) return amount;
  return moneyArs(Math.max(0, amount - Math.min(amount, interest)));
}

function chargeAmount(charges, concept) {
  return moneyArs((charges || [])
    .filter((row) => String(row.status || 'posted') !== 'void' && String(row.concept || '') === concept)
    .reduce((sum, row) => sum + moneyArs(row.amount), 0));
}

function applyPaid(buckets, paid) {
  let left = moneyArs(paid);
  return buckets.map((bucket) => {
    const used = Math.min(bucket, left);
    left = moneyArs(left - used);
    return moneyArs(bucket - used);
  });
}

/**
 * Capital todavía sin cobrar. El interés no está en el saldo:
 * se calcula aparte, solo sobre la cuota, si el mes ya pasó el 10.
 */
export function quoteColoniaOpenDue({
  charges = [],
  payments = [],
  paidOn,
  season,
  planKey,
} = {}) {
  const live = (charges || []).filter((row) => String(row.status || 'posted') !== 'void');
  const inscription = chargeAmount(live, 'colonia_inscripcion');
  const cuota = chargeAmount(live, 'colonia_cuota');
  const other = moneyArs(live
    .filter((row) => !['colonia_inscripcion', 'colonia_cuota', 'colonia_interes'].includes(String(row.concept || '')))
    .reduce((sum, row) => sum + moneyArs(row.amount), 0));
  const confirmed = (payments || [])
    .filter((row) => {
      const status = String(row.status || '');
      return status === 'confirmed' || status === 'confirmado';
    })
    .reduce((sum, row) => sum + coloniaPaymentCapital(row), 0);
  const pending = (payments || [])
    .filter((row) => String(row.status || '') === 'pending')
    .reduce((sum, row) => sum + coloniaPaymentCapital(row), 0);
  const [inscriptionLeft, cuotaLeft, otherLeft] = applyPaid(
    applyPaid([inscription, cuota, other], confirmed),
    pending,
  );
  const cuotaCharge = live.find((row) => String(row.concept || '') === 'colonia_cuota');
  const fromCharge = String(cuotaCharge?.created_at || cuotaCharge?.createdAt || '').slice(0, 7);
  const monthKey = /^\d{4}-\d{2}$/.test(fromCharge)
    ? fromCharge
    : coloniaCuotaMonthKey(paidOn, season);
  const monthly = !planKey || String(planKey) === 'cuota';
  const interest = monthly ? coloniaCuotaInterest(cuotaLeft, monthKey, paidOn, season) : 0;
  const capital = moneyArs(inscriptionLeft + cuotaLeft + otherLeft);
  return {
    inscription: inscriptionLeft,
    cuota: cuotaLeft,
    other: otherLeft,
    capital,
    interest,
    payable: moneyArs(capital + interest),
    monthKey,
    late: interest > 0,
    rate: COLONIA_CUOTA_LATE_RATE,
  };
}
