/** Revisión IA acotada a cuotas: altas, bajas, fichas y liquidación del período. */

import { buildClubReview, reviewItemsForAccess, REVIEW_TIERS } from './buildClubReview';
import { periodLabel } from '../accounting/feeBilling';

export { REVIEW_TIERS };

const CUOTAS_TABS = ['dues', 'members'];

/** Números de socio cobrados en el pack del período (cargas de liquidación). */
export function feeChargedNumbersFromPeriod(period) {
  const charges = period?.pack?.charges || [];
  const ids = new Set();
  for (const charge of charges) {
    const raw = charge?.memberId ?? charge?.memberNumber ?? '';
    const number = String(raw).replace(/\D/g, '');
    if (number) ids.add(number);
  }
  return [...ids];
}

/** Fecha de referencia dentro del mes del período (día 15) para alinear chequeos de cuota. */
export function reviewTodayForPeriod(period, fallback = new Date()) {
  const year = Number(period?.year);
  const month = Number(period?.month);
  if (Number.isFinite(year) && Number.isFinite(month) && month >= 1 && month <= 12) {
    return new Date(year, month - 1, 15, 12, 0, 0, 0);
  }
  return fallback instanceof Date ? fallback : new Date(fallback);
}

/**
 * Arma la cola JEV filtrada a dues/members para el período de cuotas abierto.
 */
export function buildCuotasReview({
  members = [],
  feePeriods = [],
  altas = [],
  bajas = [],
  membershipMovesAsOf = '',
  period = null,
  loading = false,
  today = null,
  ...rest
} = {}) {
  const reviewToday = today || reviewTodayForPeriod(period);
  const feeChargedNumbers = rest.feeChargedNumbers ?? feeChargedNumbersFromPeriod(period);
  const full = buildClubReview({
    ...rest,
    members,
    feePeriods,
    altas,
    bajas,
    membershipMovesAsOf,
    feeChargedNumbers,
    today: reviewToday,
    loading,
  });
  const items = reviewItemsForAccess(full.items || [], { tabs: CUOTAS_TABS });
  return {
    ...full,
    periodLabel: period ? periodLabel(period) : '',
    periodId: period?.id || null,
    items,
  };
}
