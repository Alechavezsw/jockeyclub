import { describe, expect, it } from 'vitest';
import {
  buildDisciplineStats,
  resolveDiscipline,
  upsertDiscipline,
  toggleMemberDiscipline,
  remapMemberDisciplines,
  DISCIPLINE_CATALOG,
} from './disciplines';

describe('resolveDiscipline', () => {
  it('normaliza aliases', () => {
    expect(resolveDiscipline('Padel')?.id).toBe('padel');
    expect(resolveDiscipline('Equitación')?.id).toBe('hipica');
  });
});

describe('upsertDiscipline', () => {
  it('alta y edición de catálogo', () => {
    const created = upsertDiscipline(DISCIPLINE_CATALOG, {
      name: 'Esgrima',
      aliases: ['fencing'],
      color: '#111111',
      facilityIds: [],
    });
    expect(created.some((d) => d.name === 'Esgrima')).toBe(true);
    const row = created.find((d) => d.name === 'Esgrima');
    const edited = upsertDiscipline(created, { ...row, coachRole: 'Maestro Esgrima' });
    expect(edited.find((d) => d.id === row.id).coachRole).toBe('Maestro Esgrima');
  });
});

describe('toggleMemberDiscipline / remap', () => {
  it('inscribe y da de baja', () => {
    const members = [{ memberId: '1', name: 'A', disciplines: ['Tenis'] }];
    const enrolled = toggleMemberDiscipline(members, '1', 'Rugby', true);
    expect(enrolled[0].disciplines).toEqual(['Tenis', 'Rugby']);
    const out = toggleMemberDiscipline(enrolled, '1', 'Tenis', false);
    expect(out[0].disciplines).toEqual(['Rugby']);
  });

  it('renombra etiquetas en el padrón', () => {
    const members = [{
      memberId: '1',
      disciplines: ['Pádel'],
      adherents: [{ id: 'a', disciplines: ['padel'] }],
    }];
    const next = remapMemberDisciplines(members, {
      fromLabels: ['Pádel', 'padel'],
      toLabel: 'Padel Pro',
    });
    expect(next[0].disciplines).toEqual(['Padel Pro']);
    expect(next[0].adherents[0].disciplines).toEqual(['Padel Pro']);
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
