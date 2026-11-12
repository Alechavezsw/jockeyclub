/** Reglas de dominio para reservas de instalaciones. */

function parseMinutes(time = '') {
  const [h, m] = String(time).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/**
 * True si el horario `time` cae dentro de la reserva (inicio exacto o rango start–endTime).
 * Turno noche de salón puede cruzar medianoche (p. ej. 20:00–03:30).
 */
function occupiesSlot(status) {
  const s = String(status || '').toLowerCase();
  return s !== 'cancelled' && s !== 'canceled' && s !== 'rejected';
}

export function reservationCoversTime(reservation, time) {
  if (!reservation || !occupiesSlot(reservation.status)) return false;
  if (reservation.time === time) return true;

  const slotMin = parseMinutes(time);
  const startMin = parseMinutes(reservation.time);
  if (slotMin == null || startMin == null) return false;

  const endMin = parseMinutes(reservation.endTime);
  if (endMin == null) return false;
  // Mismo día: 11:00–19:00
  if (endMin > startMin) {
    return slotMin >= startMin && slotMin < endMin;
  }
  // Cruza medianoche: 20:00–03:30 → cubre desde start hasta 24:00 y de 00:00 hasta end
  return slotMin >= startMin || slotMin < endMin;
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
      && occupiesSlot(res.status)
      && (ignoreId === null || res.id !== ignoreId)
      && reservationCoversTime(res, time)
  );
}

/** Horario libre: cualquier reserva vigente de ese día ocupa el espacio. */
export function facilityDayTaken(reservations, { facilityId, date }, ignoreId = null) {
  return (reservations || []).some(
    (res) =>
      res.facilityId === facilityId
      && res.date === date
      && occupiesSlot(res.status)
      && (ignoreId === null || res.id !== ignoreId)
  );
}
