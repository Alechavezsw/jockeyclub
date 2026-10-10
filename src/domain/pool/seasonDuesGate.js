/** En temporada, desde el 10, sin la cuota del mes no se entra al club. */

import { duesAmountForMember, duesDueMoment, pinDuesDueDate } from '../members/dues';
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
