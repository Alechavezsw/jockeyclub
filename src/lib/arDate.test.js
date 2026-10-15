import { describe, expect, it } from 'vitest';
import { formatInstantAR, hasClock } from './arDate';

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

describe('hasClock', () => {
  it('distingue fecha de instante', () => {
    expect(hasClock('2026-10-01')).toBe(false);
    expect(hasClock('2026-10-01T17:57:51.952Z')).toBe(true);
  });
});
