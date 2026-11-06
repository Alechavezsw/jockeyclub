import { describe, expect, it } from 'vitest';
import {
  buildWeekReservationsModel,
  weekRangeContaining,
} from './exportWeekReservationsPdf';

describe('weekRangeContaining', () => {
  it('arma lunes a domingo', () => {
    // 2026-11-06 es viernes
    const range = weekRangeContaining('2026-11-06');
    expect(range.from).toBe('2026-11-02');
    expect(range.to).toBe('2026-11-08');
  });
});

describe('buildWeekReservationsModel', () => {
  it('filtra y ordena reservas de la semana', () => {
    const model = buildWeekReservationsModel([
      {
        id: '1',
        date: '2026-11-08',
        time: '10:00',
        facilityName: 'Cancha 1',
        memberName: 'B',
        memberId: '2',
        status: 'confirmed',
        estimatedPrice: 1000,
      },
      {
        id: '2',
        date: '2026-11-03',
        time: '20:00',
        facilityName: 'Salón',
        memberName: 'A',
        memberId: '1',
        status: 'pending',
        chargedPrice: 50000,
        estimatedPrice: 100000,
      },
      {
        id: '3',
        date: '2026-11-10',
        time: '12:00',
        facilityName: 'Fuera',
        memberName: 'C',
        memberId: '3',
        status: 'confirmed',
      },
    ], { weekOf: '2026-11-06' });

    expect(model.total).toBe(2);
    expect(model.rows[0].member).toBe('A');
    expect(model.rows[1].member).toBe('B');
    expect(model.rows.map((r) => r.date)).toEqual(['2026-11-03', '2026-11-08']);
  });
});
