export class DbError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'DbError';
    this.cause = cause;
  }
}

export const RESERVATION_SLOT_TAKEN = 'Ese turno ya está reservado.';

/** El unique de (espacio, día, hora) responde 23505. El mensaje de Postgres no se muestra. */
export function reservationSlotTakenMessage(error) {
  const text = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(' ');
  if (/reservations_active_slot_uidx/i.test(text)) return RESERVATION_SLOT_TAKEN;
  const code = error?.code;
  if (code === '23505' && /reservations/i.test(text) && /time_slot|facility_id/i.test(text)) {
    return RESERVATION_SLOT_TAKEN;
  }
  return '';
}

export function throwOnError(error, fallback = 'Error de base de datos') {
  if (!error) return;
  const taken = reservationSlotTakenMessage(error);
  if (taken) throw new DbError(taken, error);
  throw new DbError(error.message || fallback, error);
}

export async function unwrap(promise, fallback) {
  const { data, error } = await promise;
  throwOnError(error, fallback);
  return data;
}
