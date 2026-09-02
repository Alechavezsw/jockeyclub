import { describe, it, expect } from 'vitest';
import {
  duesStatus,
  upsertAttendanceMark,
  findAttendanceSession,
  markForMember,
  summarizeSession,
  disciplinesForTeacher,
} from './attendance';

describe('duesStatus', () => {
  it('marca al día o con deuda', () => {
    expect(duesStatus({ outstandingBalance: 0 }).ok).toBe(true);
    expect(duesStatus({ outstandingBalance: 12000 }).id).toBe('debt');
    expect(duesStatus({ status: 'suspended' }).id).toBe('suspended');
  });
});

describe('asistencia', () => {
  it('guarda y alterna marcas por disciplina/día', () => {
    let sessions = [];
    sessions = upsertAttendanceMark(sessions, {
      date: '2026-09-01',
      disciplineId: 'tenis',
      disciplineName: 'Tenis',
      memberId: '1',
      memberName: 'A',
      status: 'present',
    });
    expect(findAttendanceSession(sessions, { date: '2026-09-01', disciplineId: 'tenis' })).toBeTruthy();
    expect(markForMember(sessions[0], '1').status).toBe('present');

    sessions = upsertAttendanceMark(sessions, {
      date: '2026-09-01',
      disciplineId: 'tenis',
      memberId: '1',
      status: 'absent',
    });
    expect(markForMember(sessions[0], '1').status).toBe('absent');

    const summary = summarizeSession(sessions[0], 3);
    expect(summary.absent).toBe(1);
    expect(summary.pending).toBe(2);
  });

  it('filtra disciplinas del profesor', () => {
    const catalog = [
      { id: 'tenis', name: 'Tenis', isActive: true },
      { id: 'rugby', name: 'Rugby', isActive: true },
    ];
    expect(disciplinesForTeacher(catalog, ['tenis']).map((d) => d.id)).toEqual(['tenis']);
    expect(disciplinesForTeacher(catalog, null)).toHaveLength(2);
  });
});
