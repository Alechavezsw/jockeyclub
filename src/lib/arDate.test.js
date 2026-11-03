import { describe, expect, it } from 'vitest';
import { formatInstantAR, hasClock, todayAR } from './arDate';

describe('formatInstantAR', () => {
  it('fecha sola no inventa mediodía', () => {
    const label = formatInstantAR('2026-10-01');
    expect(label).toMatch(/2026/);
    expect(label).not.toMatch(/\d{2}:\d{2}/);
  });

  it('ISO con zona muestra hora argentina', () => {
    const label = formatInstantAR('2026-10-01T17:57:51.952Z');
    expect(label).toMatch(/14:57/);
  });
});

describe('todayAR', () => {
  it('a las 23:30 del día 10 en Argentina sigue siendo el 10', () => {
    expect(todayAR(new Date('2026-11-10T23:30:00-03:00'))).toBe('2026-11-10');
  });

  it('pasada la medianoche de Argentina ya es el 11', () => {
    expect(todayAR(new Date('2026-11-11T00:30:00-03:00'))).toBe('2026-11-11');
  });

  it('una fecha sola no se corre al día anterior', () => {
    expect(todayAR('2026-09-04')).toBe('2026-09-04');
  });
});

describe('hasClock', () => {
  it('distingue fecha de instante', () => {
    expect(hasClock('2026-10-01')).toBe(false);
    expect(hasClock('2026-10-01T17:57:51.952Z')).toBe(true);
  });
});
