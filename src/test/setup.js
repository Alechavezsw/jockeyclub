import { afterEach, beforeEach, vi } from 'vitest';

/** El calendario del test no se mueve: el corte de caja y las vigencias quedan en noviembre 2026. */
const FIXED_NOW = new Date('2026-11-03T12:00:00-03:00');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});
