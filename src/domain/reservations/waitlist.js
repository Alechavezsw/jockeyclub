import { hasReservationConflict } from './conflicts';

/** Lista de espera por instalación + fecha + horario. */

export function joinWaitlist(entries, {
  facilityId,
  facilityName,
  date,
  time,
  memberId,
  memberName,
}) {
  if (!facilityId || !date || !time) throw new Error('Completá instalación, fecha y horario.');
  if (!memberId) throw new Error('Socio requerido.');

  const exists = (entries || []).some(
    (e) =>
      e.status === 'waiting'
      && e.facilityId === facilityId
      && e.date === date
      && e.time === time
      && e.memberId === memberId
  );
  if (exists) throw new Error('Ya estás en lista de espera para ese turno.');

  const entry = {
    id: `wl-${Date.now()}`,
    facilityId,
    facilityName: facilityName || facilityId,
    date,
    time,
    memberId,
    memberName: memberName || '',
    status: 'waiting',
    createdAt: new Date().toISOString(),
  };
  return { entries: [entry, ...(entries || [])], entry };
}

export function leaveWaitlist(entries, entryId) {
  return (entries || []).map((e) =>
    e.id === entryId ? { ...e, status: 'cancelled', cancelledAt: new Date().toISOString() } : e
  );
}

export function waitingForSlot(entries, { facilityId, date, time }) {
  return (entries || [])
    .filter(
      (e) =>
        e.status === 'waiting'
        && e.facilityId === facilityId
        && e.date === date
        && e.time === time
    )
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

/** Si se libera un turno, ofrece el primero de la lista (marca notified). */
export function notifyNextOnWaitlist(entries, { facilityId, date, time }) {
  const queue = waitingForSlot(entries, { facilityId, date, time });
  const next = queue[0];
  if (!next) return { entries, notified: null };
  return {
    entries: (entries || []).map((e) =>
      e.id === next.id
        ? { ...e, status: 'notified', notifiedAt: new Date().toISOString() }
        : e
    ),
    notified: next,
  };
}

export function canJoinWaitlist(reservations, { facilityId, date, time }) {
  return hasReservationConflict(reservations, { facilityId, date, time });
}
