import { describe, expect, it } from 'vitest';
import {
  estimateSlotDurationMinutes,
  getFacilityLiveStatus,
  isSeasonOpen,
} from './availability';

const facility = {
  id: 'tenis_trad',
  name: 'Tenis',
  hours: '08:00 - 22:00',
  isOutdoor: true,
  slots: ['08:00', '09:30', '11:00', '17:00', '18:30'],
};

describe('availability', () => {
  it('estima duración por gap de slots', () => {
    expect(estimateSlotDurationMinutes(facility.slots, '17:00')).toBe(90);
  });

  it('marca disponible si no hay reserva actual', () => {
    const now = new Date('2026-07-24T10:00:00');
    const status = getFacilityLiveStatus(facility, { reservations: [], now });
    expect(status.status).toBe('available');
    expect(status.label).toBe('Disponible');
  });

  it('marca ocupada si hay turno en curso', () => {
    const now = new Date('2026-07-24T17:20:00');
    const status = getFacilityLiveStatus(facility, {
      now,
      reservations: [{
        facilityId: 'tenis_trad',
        date: '2026-07-24',
        time: '17:00',
        status: 'confirmed',
        memberName: 'Victoria Cantoni',
      }],
    });
    expect(status.status).toBe('occupied');
    expect(status.detail).toContain('Victoria Cantoni');
  });

  it('suspende exteriores con Zonda', () => {
    const status = getFacilityLiveStatus(facility, {
      isZondaActive: true,
      now: new Date('2026-07-24T10:00:00'),
    });
    expect(status.status).toBe('suspended');
  });

  it('respeta temporada de pileta', () => {
    const pool = { id: 'piscina_verano', isSeasonal: true, hours: '09:00 - 20:00', slots: [] };
    expect(isSeasonOpen(pool, new Date('2026-07-24T12:00:00'))).toBe(false);
    expect(isSeasonOpen(pool, new Date('2026-01-10T12:00:00'))).toBe(true);
    const status = getFacilityLiveStatus(pool, { now: new Date('2026-07-24T12:00:00') });
    expect(status.status).toBe('season_closed');
  });

  it('cerrada fuera de horario', () => {
    const status = getFacilityLiveStatus(facility, {
      now: new Date('2026-07-24T23:10:00'),
    });
    expect(status.status).toBe('closed');
  });
});
