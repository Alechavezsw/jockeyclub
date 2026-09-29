/** Reglas de reserva tal como están configuradas en Lila para cada espacio. */

import { findTier } from '../members/tiers.js';
import { todayISODateAR } from '../../lib/arDate.js';
import { hasReservationConflict } from './conflicts.js';

export function addDaysIso(iso, days) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + Number(days || 0));
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function facilityTurns(facility) {
  if (Array.isArray(facility?.turns) && facility.turns.length) {
    return facility.turns.map((turn) => ({
      time: turn.time,
      endTime: turn.endTime || null,
      label: turn.label || turn.time,
    }));
  }
  return (facility?.slots || []).map((time) => ({ time, endTime: null, label: time }));
}

export function turnByTime(facility, time) {
  return facilityTurns(facility).find((turn) => turn.time === time) || null;
}

export function reservationCreateStatus(facility) {
  return facility?.rules?.createStatus === 'pending' ? 'pending' : 'confirmed';
}

export function facilityChargesCurrentAccount(facility) {
  return facility?.accounting?.autoCharge !== false;
}

export function facilityOffersPaymentButton(facility) {
  return Boolean(facility?.accounting?.paymentButton);
}

export function guestCap(facility) {
  const maxGuests = Number(facility?.guests?.maxGuests);
  if (maxGuests > 0) return maxGuests;
  const fromCapacity = Number(String(facility?.capacity || '').replace(/\D/g, ''));
  if (fromCapacity > 0) return fromCapacity;
  return Number(facility?.guestLimit) || 0;
}

export function latestBookableIso(todayIso, facilities = []) {
  const days = (facilities || [])
    .map((facility) => Number(facility?.rules?.advanceDays) || 0)
    .filter((n) => n > 0);
  const max = days.length ? Math.max(...days) : 90;
  return addDaysIso(todayIso, max);
}

function turnStart(day, time) {
  const [y, m, d] = String(day).split('-').map(Number);
  const [hh, mm] = String(time).split(':').map(Number);
  if (!y || !m || !d || !Number.isFinite(hh)) return null;
  return new Date(y, m - 1, d, hh, Number.isFinite(mm) ? mm : 0, 0, 0);
}

function memberTierLabel(member) {
  const tier = findTier(member?.tier);
  return String(tier?.label || '').trim();
}

/**
 * Valida una reserva nueva contra las reglas del espacio.
 * @returns {{ ok: true, turn: object, status: string } | { ok: false, error: string }}
 */
export function validateMemberBooking({
  facility,
  member,
  reservations = [],
  date,
  time,
  guests = 0,
  now = new Date(),
} = {}) {
  if (!facility) return { ok: false, error: 'Elegí un espacio.' };
  const adminStatus = String(facility.status || 'disponible');
  if (adminStatus === 'suspendido' || adminStatus === 'no_disponible' || adminStatus === 'mantenimiento') {
    return { ok: false, error: 'Ese espacio no está disponible.' };
  }

  const day = String(date || '').slice(0, 10);
  const today = todayISODateAR(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: 'Seleccioná una fecha.' };
  if (day < today) return { ok: false, error: 'Esa fecha ya pasó.' };

  const advance = Number(facility.rules?.advanceDays) || 0;
  if (advance > 0 && day > addDaysIso(today, advance)) {
    return { ok: false, error: `Se puede reservar hasta ${advance} días antes.` };
  }

  const turn = turnByTime(facility, time);
  if (!turn) return { ok: false, error: 'Elegí un turno del espacio.' };

  const priorHours = Number(facility.rules?.hoursPrior) || 0;
  const startAt = turnStart(day, turn.time);
  if (startAt && priorHours > 0 && startAt.getTime() < now.getTime() + priorHours * 60 * 60 * 1000) {
    return { ok: false, error: `Hay que reservar con al menos ${priorHours} horas de anticipación.` };
  }
  if (startAt && startAt.getTime() <= now.getTime()) {
    return { ok: false, error: 'Ese turno ya empezó.' };
  }

  if (hasReservationConflict(reservations, { facilityId: facility.id, date: day, time: turn.time })) {
    return { ok: false, error: 'Ese turno ya está reservado.' };
  }

  const cap = guestCap(facility);
  if (cap > 0 && Number(guests) > cap) {
    return { ok: false, error: `El máximo de invitados es ${cap}.` };
  }

  const allowed = facility.rules?.allowedTierLabels;
  if (Array.isArray(allowed) && allowed.length) {
    const label = memberTierLabel(member);
    if (!allowed.includes(label)) {
      return { ok: false, error: 'Tu categoría de cuota no puede reservar este espacio.' };
    }
  }

  if (facility.rules?.limitOneApproved && member?.memberId) {
    const already = (reservations || []).some((res) => (
      String(res.memberId || '') === String(member.memberId)
      && res.facilityId === facility.id
      && res.status !== 'cancelled'
      && res.status !== 'rejected'
      && String(res.date || '').slice(0, 10) >= today
    ));
    if (already) return { ok: false, error: 'Ya tenés una reserva vigente en este espacio.' };
  }

  return { ok: true, turn, status: reservationCreateStatus(facility) };
}
