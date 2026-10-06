import { describe, expect, it } from 'vitest';
import {
  buildDoorWeek,
  buildMonthHorizon,
  buildPadronOutlook,
  buildPoolSeason,
} from './jevForecasts';

describe('jevForecasts', () => {
  it('proyecta el mes con el ritmo ya cobrado', () => {
    const horizon = buildMonthHorizon({
      today: '2026-10-03',
      collected: 30000000,
      liquidated: 60000000,
      cashMovements: [
        { id: 'a', date: '2026-10-01', amount: 10000000, movementType: 'income' },
        { id: 'b', date: '2026-10-02', amount: 10000000, movementType: 'income' },
        { id: 'c', date: '2026-10-03', amount: 10000000, movementType: 'income' },
      ],
    });
    expect(horizon.pace).toBe(10000000);
    expect(horizon.forecastDue).toBe(60000000);
    expect(horizon.pctDue).toBe(100);
    expect(horizon.points[0].kind).toBe('actual');
    expect(horizon.points.at(-1).kind).toBe('forecast');
  });

  it('no deja que un solo día gordo pinte el 10 como cerrado', () => {
    const horizon = buildMonthHorizon({
      today: '2026-10-03',
      collected: 34000000,
      liquidated: 63000000,
      cashMovements: [
        { id: 'a', date: '2026-10-01', amount: 30000000, movementType: 'income' },
        { id: 'b', date: '2026-10-02', amount: 2000000, movementType: 'income' },
        { id: 'c', date: '2026-10-03', amount: 2000000, movementType: 'income' },
      ],
    });
    expect(horizon.pace).toBe(2000000);
    expect(horizon.forecastDue).toBe(48000000);
    expect(horizon.pctDue).toBe(76);
  });

  it('cuenta la puerta de la semana sin canceladas', () => {
    const week = buildDoorWeek({
      today: '2026-10-03',
      entryLogs: [
        { date: '2026-10-03' },
        { date: '2026-10-03' },
        { date: '2026-09-30' },
      ],
      reservations: [
        { date: '2026-10-02', status: 'confirmed' },
        { date: '2026-10-02', status: 'cancelled' },
      ],
      poolAccesses: [{ date: '2026-10-01' }],
    });
    expect(week.days).toHaveLength(7);
    expect(week.days.at(-1).door).toBe(2);
    expect(week.days.find((row) => row.date === '2026-10-02')?.bookings).toBe(1);
  });

  it('parte el padrón sin inventar fichas', () => {
    const padron = buildPadronOutlook({
      activos: 100,
      bien: 70,
      fichas: 30,
      deudores: 12,
    });
    expect(padron.okPct).toBe(70);
    expect(padron.alDia).toBe(88);
  });

  it('cierra la pileta entre abril y noviembre y cuenta los días', () => {
    const pool = buildPoolSeason({ today: '2026-10-03', poolAccesses: [] });
    expect(pool.live).toBe(false);
    expect(pool.open).toBe('2026-12-01');
    expect(pool.close).toBe('2027-03-31');
    expect(pool.daysUntilOpen).toBe(59);
    expect(pool.seasonDays).toBe(121);
    expect(pool.forecastVisits).toBe(0);
    expect(pool.months).toHaveLength(4);
  });

  it('estima la temporada con el ritmo de la pasada', () => {
    const pool = buildPoolSeason({
      today: '2026-10-03',
      poolAccesses: [
        { date: '2025-12-15', payment: { amount: 5000 } },
        { date: '2026-01-10', payment: { amount: 5000 } },
        { date: '2026-02-02', payment: { amount: 8000 } },
      ],
    });
    expect(pool.visitsPrev).toBe(3);
    expect(pool.forecastVisits).toBe(3);
    expect(pool.forecastCanon).toBe(18000);
    expect(pool.points.some((row) => row.kind === 'forecast')).toBe(true);
  });
});
