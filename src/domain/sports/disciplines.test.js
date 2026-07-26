import { describe, expect, it } from 'vitest';
import { buildDisciplineStats, resolveDiscipline } from './disciplines';

describe('resolveDiscipline', () => {
  it('normaliza aliases', () => {
    expect(resolveDiscipline('Padel')?.id).toBe('padel');
    expect(resolveDiscipline('Equitación')?.id).toBe('hipica');
  });
});

describe('buildDisciplineStats', () => {
  it('cuenta socios y reservas por disciplina', () => {
    const stats = buildDisciplineStats({
      members: [
        { memberId: '1', name: 'A', tier: 'royal', status: 'active', disciplines: ['Tenis', 'Pádel'] },
        { memberId: '2', name: 'B', tier: 'gold', status: 'active', disciplines: ['Rugby'] },
        { memberId: '3', name: 'C', tier: 'gold', status: 'active', disciplines: [] },
      ],
      reservations: [
        { facilityId: 'tenis_trad', facilityName: 'Tenis', date: '2099-01-01', status: 'confirmed' },
        { facilityId: 'rugby_masc', facilityName: 'Rugby', date: '2099-01-02', status: 'confirmed' },
        { facilityId: 'tenis_trad', facilityName: 'Tenis', date: '2099-01-03', status: 'cancelled' },
      ],
      today: new Date('2026-07-24T12:00:00'),
    });
    expect(stats.summary.membersWithoutDiscipline).toBe(1);
    const tenis = stats.rows.find((r) => r.id === 'tenis');
    expect(tenis.enrolledCount).toBe(1);
    expect(tenis.upcomingBookings).toBe(1);
    const rugby = stats.rows.find((r) => r.id === 'rugby');
    expect(rugby.enrolledCount).toBe(1);
  });
});
