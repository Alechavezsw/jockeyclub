/** Reglas de dominio para reservas de instalaciones. */

/**
 * Devuelve true si ya existe una reserva no cancelada para la misma
 * instalación, fecha y horario.
 */
export function hasReservationConflict(reservations, { facilityId, date, time }, ignoreId = null) {
  return (reservations || []).some(
    (res) =>
      res.facilityId === facilityId &&
      res.date === date &&
      res.time === time &&
      res.status !== 'cancelled' &&
      (ignoreId === null || res.id !== ignoreId)
  );
}
