/** Aviso al socio cuando el club anula su reserva. */

import { formatISODateLongAR } from '../../lib/arDate';

export function clubCancelledReservationNotice(reservation = {}) {
  const facility = String(reservation.facilityName || reservation.facilityId || 'la instalación').trim();
  const dateIso = String(reservation.date || '').slice(0, 10);
  const dateLabel = dateIso ? formatISODateLongAR(dateIso) : 'la fecha acordada';
  const time = String(reservation.time || '').slice(0, 5);
  const when = time ? `${dateLabel} a las ${time}` : dateLabel;

  return {
    subject: 'Reserva anulada por el club',
    content: [
      `El club anuló tu reserva de ${facility} (${when}).`,
      'El turno ya no figura en Próximos turnos.',
      'Si necesitás otro horario o tenés una consulta, escribí a administración desde Mensajes.',
    ].join(' '),
  };
}
