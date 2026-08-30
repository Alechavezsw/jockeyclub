import { describe, it, expect } from 'vitest';
import { hasReservationConflict } from './conflicts';

const base = [
  { id: 1, facilityId: 'tenis_trad', date: '2026-07-25', time: '17:00', status: 'confirmed' },
  { id: 2, facilityId: 'rugby_masc', date: '2026-07-25', time: '09:00', status: 'cancelled' },
];

describe('hasReservationConflict', () => {
  it('detecta choque exacto de instalación, fecha y hora', () => {
    expect(hasReservationConflict(base, { facilityId: 'tenis_trad', date: '2026-07-25', time: '17:00' })).toBe(true);
  });

  it('ignora reservas canceladas', () => {
    expect(hasReservationConflict(base, { facilityId: 'rugby_masc', date: '2026-07-25', time: '09:00' })).toBe(false);
  });

  it('no hay choque en otro horario o cancha', () => {
    expect(hasReservationConflict(base, { facilityId: 'tenis_trad', date: '2026-07-25', time: '18:30' })).toBe(false);
    expect(hasReservationConflict(base, { facilityId: 'padel_vidrio', date: '2026-07-25', time: '17:00' })).toBe(false);
  });

  it('permite excluir la propia reserva al editar (ignoreId)', () => {
    expect(hasReservationConflict(base, { facilityId: 'tenis_trad', date: '2026-07-25', time: '17:00' }, 1)).toBe(false);
  });

  it('tolera lista vacía o indefinida', () => {
    expect(hasReservationConflict([], { facilityId: 'x', date: 'y', time: 'z' })).toBe(false);
    expect(hasReservationConflict(undefined, { facilityId: 'x', date: 'y', time: 'z' })).toBe(false);
  });

  it('bloquea turnos intermedios cuando la reserva tiene endTime (jornada real)', () => {
    const salonDay = [
      {
        id: 9,
        facilityId: 'salon_anhelo',
        date: '2026-08-30',
        time: '11:00',
        endTime: '23:00',
        status: 'confirmed',
      },
    ];
    expect(hasReservationConflict(salonDay, { facilityId: 'salon_anhelo', date: '2026-08-30', time: '11:00' })).toBe(true);
    expect(hasReservationConflict(salonDay, { facilityId: 'salon_anhelo', date: '2026-08-30', time: '14:00' })).toBe(true);
    expect(hasReservationConflict(salonDay, { facilityId: 'salon_anhelo', date: '2026-08-30', time: '21:00' })).toBe(true);
    expect(hasReservationConflict(salonDay, { facilityId: 'salon_anhelo', date: '2026-08-30', time: '23:00' })).toBe(false);
  });
});
