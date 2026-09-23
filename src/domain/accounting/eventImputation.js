/** Imputación de reservas de salón / espacio a la cuenta del socio. */

import { FACILITIES, getFacilityById } from '../reservations/facilities';
import { createAccountEntry } from './memberBalances';

export function findFacilityForReservation(reservation, catalog = FACILITIES) {
  const id = String(reservation?.facilityId || '').trim();
  if (id) {
    const byId = getFacilityById(id, catalog);
    if (byId) return byId;
  }
  const raw = String(reservation?.facilityName || reservation?.space || '').trim().toLowerCase();
  if (!raw) return null;
  return catalog.find((f) => {
    const name = String(f.name || '').toLowerCase();
    const fid = String(f.id || '').replace(/_/g, ' ');
    return name === raw || raw.includes(name) || name.includes(raw) || raw.includes(fid);
  }) || null;
}

export function reservationChargeAmount(reservation, catalog = FACILITIES) {
  const direct = Number(
    reservation?.amount ?? reservation?.price ?? reservation?.total ?? reservation?.fee
  );
  if (Number.isFinite(direct) && direct > 0) return direct;
  const facility = findFacilityForReservation(reservation, catalog);
  const fallback = Number(facility?.defaultPrice);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
}

export function buildEventImputationEntry(reservation, { today = new Date() } = {}) {
  const amount = reservationChargeAmount(reservation);
  if (!(amount > 0)) throw new Error('La reserva no tiene importe para imputar.');
  const memberNumber = reservation?.memberId || reservation?.memberNumber;
  if (!memberNumber) throw new Error('La reserva no tiene socio.');
  const space = reservation?.facilityName || reservation?.facilityId || reservation?.space || 'Evento';
  const when = String(reservation?.date || reservation?.start || '').slice(0, 10)
    || today.toISOString().slice(0, 10);
  return createAccountEntry({
    type: 'otro',
    memberNumber,
    memberName: reservation?.memberName || '',
    value: amount,
    date: when,
    description: `${space} · ${when}`,
    source: 'event_imputation',
    voucher: String(reservation?.id || reservation?.accessinId || ''),
  });
}
