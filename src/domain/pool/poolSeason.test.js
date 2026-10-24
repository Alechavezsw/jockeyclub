import { describe, expect, it } from 'vitest';
import { isPoolSeasonLive, poolSeasonWindow } from './poolSeason';

describe('poolSeasonWindow', () => {
  it('fuera de temporada (abr–nov) apunta a la próxima temporada', () => {
    const win = poolSeasonWindow('2026-10-24');
    expect(win.live).toBe(false);
    expect(win.open).toBe('2026-12-01');
    expect(win.close).toBe('2027-03-31');
    expect(win.previousOpen).toBe('2025-12-01');
    expect(win.previousClose).toBe('2026-03-31');
  });

  it('en diciembre está viva hasta marzo del año siguiente', () => {
    const win = poolSeasonWindow(new Date('2026-12-01T12:00:00'));
    expect(win.live).toBe(true);
    expect(win.open).toBe('2026-12-01');
    expect(win.close).toBe('2027-03-31');
  });

  it('en enero–marzo sigue la temporada abierta el año anterior', () => {
    const win = poolSeasonWindow('2027-03-31');
    expect(win.live).toBe(true);
    expect(win.open).toBe('2026-12-01');
    expect(win.close).toBe('2027-03-31');
  });

  it('el 1 de abril ya no está en temporada', () => {
    expect(isPoolSeasonLive('2027-04-01')).toBe(false);
    expect(isPoolSeasonLive('2026-11-30')).toBe(false);
    expect(isPoolSeasonLive('2026-12-01')).toBe(true);
    expect(isPoolSeasonLive('2027-03-31')).toBe(true);
  });
});
