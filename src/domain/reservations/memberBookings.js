/** Turnos del socio en el portal: solo reservas propias, vigentes y a futuro. */

const ACTIVE_STATUSES = new Set(['confirmed', 'pending', 'approved']);

export function reservationDay(res) {
  return String(res?.date || res?.reservation_date || '').slice(0, 10);
}

export function isActiveReservation(res) {
  const status = String(res?.status || 'confirmed').toLowerCase();
  return ACTIVE_STATUSES.has(status);
}

export function memberReservationsOf(reservations, memberId) {
  const number = String(memberId || '');
  if (!number || number === 'session') return [];
  return (reservations || []).filter((res) => (
    !res?.occupancyOnly
    && String(res?.memberId || '') === number
  ));
}

export function upcomingMemberReservations(reservations, memberId, todayIso) {
  const today = String(todayIso || '').slice(0, 10);
  return memberReservationsOf(reservations, memberId)
    .filter((res) => isActiveReservation(res) && reservationDay(res) >= today)
    .toSorted((a, b) => {
      const day = reservationDay(a).localeCompare(reservationDay(b));
      if (day !== 0) return day;
      return String(a.time || '').localeCompare(String(b.time || ''));
    });
}
