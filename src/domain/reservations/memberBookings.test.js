import { describe, expect, it } from 'vitest';
import { upcomingMemberReservations } from './memberBookings';

describe('upcomingMemberReservations', () => {
  const today = '2026-09-22';
  const rows = [
    { id: 1, memberId: '2026887744320988', date: '2026-09-21', time: '10:00', status: 'confirmed' },
    { id: 2, memberId: '2026887744320988', date: '2026-09-22', time: '18:00', status: 'confirmed' },
    { id: 3, memberId: '2026887744320988', date: '2026-09-30', time: '09:00', status: 'pending' },
    { id: 4, memberId: '2026887744320988', date: '2026-10-01', time: '11:00', status: 'cancelled' },
    { id: 5, memberId: 'otro', date: '2026-09-25', time: '10:00', status: 'confirmed' },
    { id: 6, memberId: null, date: '2026-09-25', time: '10:00', status: 'confirmed', occupancyOnly: true },
  ];

  it('cuenta solo turnos propios vigentes desde hoy', () => {
    const upcoming = upcomingMemberReservations(rows, '2026887744320988', today);
    expect(upcoming.map((r) => r.id)).toEqual([2, 3]);
  });
});
