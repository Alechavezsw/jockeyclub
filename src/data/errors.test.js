import { describe, expect, it } from 'vitest';
import { reservationSlotTakenMessage, RESERVATION_SLOT_TAKEN } from './errors';

describe('reservationSlotTakenMessage', () => {
  it('traduce el choque del índice de turnos', () => {
    const error = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "reservations_active_slot_uidx"',
      details: 'Key (facility_id, reservation_date, time_slot)=(tenis, 2026-11-20, 18:00) already exists.',
    };
    expect(reservationSlotTakenMessage(error)).toBe(RESERVATION_SLOT_TAKEN);
  });

  it('deja pasar otro duplicado', () => {
    expect(reservationSlotTakenMessage({
      code: '23505',
      message: 'duplicate key value violates unique constraint "members_pkey"',
    })).toBe('');
  });
});
