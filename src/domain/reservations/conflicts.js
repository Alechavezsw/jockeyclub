/** Reglas de dominio para reservas de instalaciones. */

function parseMinutes(time = '') {
  const [h, m] = String(time).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/**
 * True si el horario `time` cae dentro de la reserva (inicio exacto o rango start–endTime).
 * Las reservas reales de salón/parrilla suelen ser jornada completa (11:00–23:00).
 */
export function reservationCoversTime(reservation, time) {
  if (!reservation || reservation.status === 'cancelled') return false;
  if (reservation.time === time) return true;

  const slotMin = parseMinutes(time);
  const startMin = parseMinutes(reservation.time);
  if (slotMin == null || startMin == null) return false;

  const endMin = parseMinutes(reservation.endTime);
  if (endMin != null && endMin > startMin) {
    return slotMin >= startMin && slotMin < endMin;
  }
  return false;
}

/**
 * Devuelve true si ya existe una reserva no cancelada para la misma
 * instalación y fecha que cubre el horario pedido.
 */
export function hasReservationConflict(reservations, { facilityId, date, time }, ignoreId = null) {
  return (reservations || []).some(
    (res) =>
      res.facilityId === facilityId
      && res.date === date
      && res.status !== 'cancelled'
      && (ignoreId === null || res.id !== ignoreId)
      && reservationCoversTime(res, time)
  );
}
