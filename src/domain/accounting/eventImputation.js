/** Imputación de reservas de salón / espacio a la cuenta viva del socio. */

import { FACILITIES, getFacilityById } from '../reservations/facilities';
import { createAccountEntry } from './accountEntries';
import { buildMemberMatchIndex, matchMemberByUnidad } from './memberCollectionImport';

export const EVENT_DEBIT_ACCOUNT = 'Cuentas a Cobrar';
export const EVENT_CREDIT_ACCOUNT = 'Reservas e Instalaciones';

const EVENT_FACILITY_IDS = new Set([
  'salon_anhelo',
  'salon_bustos',
  'salon_maurin',
  'salon_refugio',
  'espacio_verde',
]);

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function spaceLabel(reservation) {
  return reservation?.facilityName || reservation?.facilityId || reservation?.space || 'Evento';
}

function reservationDate(reservation, today = new Date()) {
  return String(reservation?.date || reservation?.start || '').slice(0, 10)
    || today.toISOString().slice(0, 10);
}

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

export function reservationChargeAmount(reservation, catalog = FACILITIES, { includeCharged = false } = {}) {
  const candidates = [
    reservation?.amount,
    reservation?.price,
    reservation?.total,
    reservation?.fee,
    reservation?.estimatedPrice,
  ];
  if (includeCharged) candidates.push(reservation?.chargedPrice);
  for (const value of candidates) {
    const amount = Number(value);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  const facility = findFacilityForReservation(reservation, catalog);
  const fallback = Number(facility?.defaultPrice);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
}

export function isCancelledReservation(reservation) {
  return /cancel|reject|rechaz/i.test(String(reservation?.status || ''));
}

export function isEventSpaceReservation(reservation) {
  if (EVENT_FACILITY_IDS.has(String(reservation?.facilityId || ''))) return true;
  if (reservation?.type === 'event' || reservation?.sourceModule === 'events') return true;
  if (reservation?.needsImputation) return true;
  const facility = String(reservation?.facilityName || reservation?.facilityId || reservation?.space || '').toLowerCase();
  return /salon|espacio|evento|verde|anhelo|bustos|maurin|refugio/i.test(facility);
}

export function isReservationImputed(reservation) {
  if (reservation?.imputed === true || reservation?.feeImputed === true) return true;
  if (reservation?.imputed === false || reservation?.feeImputed === false) return false;
  return Number(reservation?.chargedPrice) > 0;
}

export function pendingEventReservations(reservations = []) {
  return (reservations || []).filter((row) => (
    isEventSpaceReservation(row) && !isCancelledReservation(row) && !isReservationImputed(row)
  ));
}

export function imputedEventReservations(reservations = []) {
  return (reservations || []).filter((row) => (
    isEventSpaceReservation(row) && isReservationImputed(row)
  ));
}

export function reservationStatusBucket(status) {
  const value = String(status || '').toLowerCase();
  if (/cancel/.test(value)) return 'cancelled';
  if (value === 'pending' || value === 'pendiente') return 'pending';
  return 'confirmed';
}

export function eventImputationEntryId(reservation) {
  const key = reservation?.id || reservation?.accessinId;
  return key ? `mae-evt-${key}` : undefined;
}

export function matchReservationMember(members = [], reservation, index) {
  const map = index || buildMemberMatchIndex(members);
  return matchMemberByUnidad(members, reservation?.memberId, map)
    || matchMemberByUnidad(members, reservation?.memberNumber, map)
    || matchMemberByUnidad(members, reservation?.documentNumber, map)
    || null;
}

export function buildEventImputationEntry(reservation, { member, today = new Date() } = {}) {
  const imputed = isReservationImputed(reservation);
  const amount = reservationChargeAmount(reservation, FACILITIES, { includeCharged: imputed });
  if (!(amount > 0)) throw new Error('La reserva no tiene importe para imputar.');
  const memberNumber = member?.memberId || reservation?.memberId || reservation?.memberNumber;
  if (!memberNumber) throw new Error('La reserva no tiene socio.');
  const when = reservationDate(reservation, today);
  const space = spaceLabel(reservation);
  return createAccountEntry({
    id: eventImputationEntryId(reservation),
    type: 'otro',
    memberNumber,
    memberName: member?.name || reservation?.memberName || '',
    value: amount,
    date: when,
    description: `Alquiler ${space} · ${when}`,
    source: 'event_imputation',
    voucher: String(reservation?.id || reservation?.accessinId || ''),
  });
}

export function buildEventImputationJournal(reservation, amount, member) {
  const space = spaceLabel(reservation);
  const who = member?.name || reservation?.memberName || 'Socio';
  const cred = member?.memberId || reservation?.memberId || '';
  return {
    date: reservationDate(reservation),
    description: `Alquiler ${space} - Socio: ${who}${cred ? ` (Cred. ${cred})` : ''}`,
    sourceModule: 'cuotas',
    lines: [
      { account: EVENT_DEBIT_ACCOUNT, type: 'debit', amount },
      { account: EVENT_CREDIT_ACCOUNT, type: 'credit', amount },
    ],
  };
}

export function applyEventImputation(reservation, members = []) {
  if (!reservation) throw new Error('Falta la reserva.');
  if (isCancelledReservation(reservation)) throw new Error('La reserva está cancelada o rechazada.');
  if (isReservationImputed(reservation)) throw new Error('Esta reserva ya está imputada.');
  const member = matchReservationMember(members, reservation);
  if (!member) throw new Error('Socio no encontrado en padrón.');
  const amount = reservationChargeAmount(reservation);
  if (!(amount > 0)) throw new Error('La reserva no tiene importe para imputar.');
  const entry = buildEventImputationEntry(reservation, { member });
  const nextMember = {
    ...member,
    outstandingBalance: roundMoney((Number(member.outstandingBalance) || 0) + amount),
    updatedAt: new Date().toISOString(),
  };
  const nextReservation = {
    ...reservation,
    imputed: true,
    feeImputed: true,
    imputedAt: new Date().toISOString(),
    chargedPrice: amount,
    imputationEntryId: entry.id,
    accountEntry: entry,
    balanceBefore: Number(member.outstandingBalance) || 0,
  };
  return {
    member: nextMember,
    entry,
    reservation: nextReservation,
    amount,
    journal: buildEventImputationJournal(reservation, amount, member),
  };
}

export function revertEventImputation(reservation, members = []) {
  if (!reservation) throw new Error('Falta la reserva.');
  if (!isReservationImputed(reservation)) throw new Error('Esta reserva no está imputada.');
  const member = matchReservationMember(members, reservation);
  const amount = reservationChargeAmount(reservation, FACILITIES, { includeCharged: true });
  const nextMember = member
    ? {
      ...member,
      outstandingBalance: roundMoney((Number(member.outstandingBalance) || 0) - amount),
      updatedAt: new Date().toISOString(),
    }
    : null;
  const nextReservation = {
    ...reservation,
    imputed: false,
    feeImputed: false,
    imputedAt: null,
    chargedPrice: 0,
    imputationEntryId: null,
    accountEntry: null,
    balanceBefore: null,
  };
  return {
    member: nextMember,
    reservation: nextReservation,
    amount,
    entryId: reservation.imputationEntryId || eventImputationEntryId(reservation),
  };
}

export function accountEntriesFromImputedReservations(reservations = []) {
  return (reservations || []).flatMap((row) => {
    if (!isReservationImputed(row)) return [];
    if (row.accountEntry?.id) return [row.accountEntry];
    try {
      return [buildEventImputationEntry(row, {
        member: { memberId: row.memberId, name: row.memberName },
      })];
    } catch {
      return [];
    }
  });
}
