/**
 * Interés de la cuota de Colonia.
 * El capital queda en el cargo. El 15 % se suma al cobrar, si el pago
 * es después del 10 de ese mes. La inscripción, la temporada y la cuota social no entran.
 */

import { todayISODateAR } from '../../lib/arDate';
import { inscriptionAmount, planAmountFor } from './coloniaTariffs';

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

/** El 10 entra sin interés. Desde el 11, la cuota lleva 15 %. */
export function coloniaCuotaIsLate(monthKey, paidOn) {
  const iso = coloniaPaidOnIso(paidOn);
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ''));
  if (!match) return false;
  const due = `${match[1]}-${match[2]}-${String(COLONIA_CUOTA_DUE_DAY).padStart(2, '0')}`;
  return iso > due;
}

export function coloniaCuotaInterest(capital, monthKey, paidOn) {
  const cap = moneyArs(capital);
  if (!(cap > 0) || !coloniaCuotaIsLate(monthKey, paidOn)) return 0;
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
  const inscriptionEach = plan === 'hermano_4' ? 0 : inscriptionAmount(tariffs);
  const planCapital = moneyArs(planAmountFor(tariffs, memberKind, plan) || 0);
  const monthKey = plan === 'cuota' ? coloniaCuotaMonthKey(paidOn, season) : null;
  const interest = plan === 'cuota' ? coloniaCuotaInterest(planCapital, monthKey, paidOn) : 0;
  const inscription = moneyArs(inscriptionEach * kids);
  return {
    inscription,
    inscriptionEach: moneyArs(inscriptionEach),
    planCapital,
    interest,
    monthKey,
    rate: COLONIA_CUOTA_LATE_RATE,
    late: interest > 0,
    total: moneyArs(inscription + planCapital + interest),
  };
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
  const interest = monthly ? coloniaCuotaInterest(cuotaLeft, monthKey, paidOn) : 0;
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
