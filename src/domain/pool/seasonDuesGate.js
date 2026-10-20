/** En temporada, desde el 10, sin la cuota del mes no se entra al club. */

import { duesAmountForMember, duesDueDayForMember, isDuesExemptMember, pinDuesDueDate } from '../members/dues';
import { familyPrincipalOf, isFamilyDependent, memberNumberOf } from '../members/households';
import { isPoolSeasonLive } from './poolSeason';

export const SEASON_DUES_GATE_COPY = {
  lead: 'Durante la temporada de pileta, solo están habilitados para ingresar al club los socios al día con la cuota social del mes en curso.',
  mora: 'A partir del día 10, quien no abonó está en mora y no ingresa al establecimiento hasta regularizar.',
};

export const SEASON_DUES_BLOCK_REASON = 'En mora · no abonó la cuota del mes. No ingresa hasta regularizar.';
export const SEASON_DUES_BLOCK_REASON_GROUP = 'El titular está en mora · no abonó la cuota del mes. No ingresa hasta regularizar.';

/**
 * El adherente no tiene cuenta propia: la mora es la del titular del grupo.
 * Si el titular no está en la lista, se evalúa la ficha tal cual (no se inventa una mora).
 */
export function accountHolderOf(member, members = []) {
  if (!member || !isFamilyDependent(member)) return member;
  const key = familyPrincipalOf(member);
  const holder = (members || []).find((row) => memberNumberOf(row) === key);
  return holder || member;
}

function dependsOnHolder(member, holder) {
  return Boolean(member && holder && holder !== member);
}

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

/** True si, llegado el día de vencimiento (el 10; AMET, el 18), el socio no cubrió la cuota de este mes. */
export function isCurrentMonthDuesUnpaid(member, today = new Date()) {
  if (isDuesExemptMember(member)) return false;
  const when = asDay(today);
  if (when.getDate() < duesDueDayForMember(member)) return false;
  if (duesAmountForMember(member, when) <= 0) return false;
  if ((Number(member?.outstandingBalance) || 0) > 0) return true;
  if (paidThisMonth(member, when)) return false;
  const nextDue = pinDuesDueDate(member?.nextDueDate, member);
  if (!nextDue) return false;
  const thisDue = pinDuesDueDate(when, member);
  return Boolean(thisDue && nextDue <= thisDue);
}

export function seasonDuesGate(member, {
  today = new Date(),
  settings = {},
  members = [],
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
  const holder = accountHolderOf(member, members);
  const unpaid = isCurrentMonthDuesUnpaid(holder, today);
  if (!unpaid) {
    return { blocked: false, inSeason: true, mora: false, reason: '' };
  }
  return {
    blocked: true,
    inSeason: true,
    mora: true,
    reason: dependsOnHolder(member, holder) ? SEASON_DUES_BLOCK_REASON_GROUP : SEASON_DUES_BLOCK_REASON,
  };
}

/**
 * Mora de pileta: desde el 10 de cada mes, o con saldo, no paga hasta regularizar.
 * No espera a la temporada dic–mar.
 */
export function isPiletaMora(member, { today = new Date(), settings = {}, members = [] } = {}) {
  if (!member) return false;
  if (settings?.seasonBlocksUnpaidDues === false) return false;
  const holder = accountHolderOf(member, members);
  if (isDuesExemptMember(holder)) return false;
  if ((Number(holder?.outstandingBalance) || 0) > 0) return true;
  return isCurrentMonthDuesUnpaid(holder, today);
}

/**
 * Si el socio puede pagar pileta: mora del 10 en adelante, hasta regularizar.
 */
export function piletaPayAccess(member, { today = new Date(), settings = {}, members = [] } = {}) {
  const gate = seasonDuesGate(member, { today, settings, members });
  const status = member?.status;
  if (status && status !== 'active') {
    const detail = status === 'suspended'
      ? 'Suspendido'
      : status === 'inactive'
        ? 'Dado de baja'
        : 'Cuenta no habilitada';
    return { canPay: false, label: 'No puede pagar pileta', detail, gate, mora: false };
  }
  if (isPiletaMora(member, { today, settings, members })) {
    const group = dependsOnHolder(member, accountHolderOf(member, members));
    return {
      canPay: false,
      label: 'No puede pagar pileta',
      detail: group ? 'El titular está en mora · regularizá la cuota' : 'En mora · regularizá la cuota',
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
