import { describe, expect, it } from 'vitest';
import { isSlotPast } from './slotTime.js';

const at = (iso) => new Date(iso);

describe('isSlotPast', () => {
  it('a las 21 no deja reservar las 11 del mismo día', () => {
    const now = at('2026-09-23T21:00:00-03:00');
    expect(isSlotPast('2026-09-23', '11:00', now)).toBe(true);
    expect(isSlotPast('2026-09-23', '14:00', now)).toBe(true);
    expect(isSlotPast('2026-09-23', '18:00', now)).toBe(true);
    expect(isSlotPast('2026-09-23', '21:00', now)).toBe(true);
  });

  it('un turno que todavía no empieza sigue libre', () => {
    const now = at('2026-09-23T20:30:00-03:00');
    expect(isSlotPast('2026-09-23', '18:00', now)).toBe(true);
    expect(isSlotPast('2026-09-23', '21:00', now)).toBe(false);
  });

  it('otro día no usa la hora de hoy', () => {
    const now = at('2026-09-23T21:00:00-03:00');
    expect(isSlotPast('2026-09-24', '11:00', now)).toBe(false);
    expect(isSlotPast('2026-09-22', '21:00', now)).toBe(true);
  });
});
