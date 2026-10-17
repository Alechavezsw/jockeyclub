/** En temporada, desde el 10, sin la cuota del mes no se entra al club. */

import { duesAmountForMember, duesDueMoment, isDuesExemptMember, pinDuesDueDate } from '../members/dues';
import { isPoolSeasonLive } from './poolSeason';

export const SEASON_DUES_GATE_COPY = {
  lead: 'Durante la temporada de pileta, solo están habilitados para ingresar al club los socios al día con la cuota social del mes en curso.',
  mora: 'A partir del día 10, quien no abonó está en mora y no ingresa al establecimiento hasta regularizar.',
};

export const SEASON_DUES_BLOCK_REASON = 'En mora · no abonó la cuota del mes. No ingresa hasta regularizar.';

function asDay(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const raw = String(value || '').slice(0, 10);
  const d = new Date(`${raw}T12:00:00`);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function paidThisMonth(member, today) {
  const raw = member?.lastPaymentDate;
  if (!raw) return false;
  const paid = raw instanceof Date ? raw : new Date(String(raw).includes('T') ? raw : `${String(raw).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(paid.getTime())) return false;
  return paid.getFullYear() === today.getFullYear() && paid.getMonth() === today.getMonth();
}

/** True si, llegado el 10, el socio no cubrió la cuota de este mes. */
export function isCurrentMonthDuesUnpaid(member, today = new Date()) {
  const when = asDay(today);
  if (duesDueMoment(when).phase === 'before') return false;
  if (duesAmountForMember(member, when) <= 0) return false;
  if ((Number(member?.outstandingBalance) || 0) > 0) return true;
  if (paidThisMonth(member, when)) return false;
  const nextDue = pinDuesDueDate(member?.nextDueDate);
  if (!nextDue) return false;
  const thisDue = pinDuesDueDate(when);
  return Boolean(thisDue && nextDue <= thisDue);
}

export function seasonDuesGate(member, {
  today = new Date(),
  settings = {},
} = {}) {
  if (!member) {
    return { blocked: false, inSeason: false, mora: false, reason: '' };
  }
  if (settings?.seasonBlocksUnpaidDues === false) {
    return { blocked: false, inSeason: isPoolSeasonLive(today), mora: false, reason: '' };
  }
  const inSeason = isPoolSeasonLive(today);
  if (!inSeason) {
    return { blocked: false, inSeason: false, mora: false, reason: '' };
  }
  const unpaid = isCurrentMonthDuesUnpaid(member, today);
  if (!unpaid) {
    return { blocked: false, inSeason: true, mora: false, reason: '' };
  }
  return {
    blocked: true,
    inSeason: true,
    mora: true,
    reason: SEASON_DUES_BLOCK_REASON,
  };
}

/**
 * Mora de pileta: desde el 10 de cada mes, o con saldo, no paga hasta regularizar.
 * No espera a la temporada dic–mar.
 */
export function isPiletaMora(member, { today = new Date(), settings = {} } = {}) {
  if (!member) return false;
  if (settings?.seasonBlocksUnpaidDues === false) return false;
  if (isDuesExemptMember(member)) return false;
  if ((Number(member?.outstandingBalance) || 0) > 0) return true;
  return isCurrentMonthDuesUnpaid(member, today);
}

/**
 * Si el socio puede pagar pileta: mora del 10 en adelante, hasta regularizar.
 */
export function piletaPayAccess(member, { today = new Date(), settings = {} } = {}) {
  const gate = seasonDuesGate(member, { today, settings });
  const status = member?.status;
  if (status && status !== 'active') {
    const detail = status === 'suspended'
      ? 'Suspendido'
      : status === 'inactive'
        ? 'Dado de baja'
        : 'Cuenta no habilitada';
    return { canPay: false, label: 'No puede pagar pileta', detail, gate, mora: false };
  }
  if (isPiletaMora(member, { today, settings })) {
    return {
      canPay: false,
      label: 'No puede pagar pileta',
      detail: 'En mora · regularizá la cuota',
      gate: { ...gate, mora: true },
      mora: true,
    };
  }
  return {
    canPay: true,
    label: 'Puede pagar pileta',
    detail: gate.inSeason ? 'Temporada en curso' : 'Temporada dic–mar',
    gate,
    mora: false,
  };
}
