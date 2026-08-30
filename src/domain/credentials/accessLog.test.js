import { describe, expect, it } from 'vitest';
import {
  accessCountsByDay,
  buildAccessLogEntry,
  filterAccessLogs,
  tierToGroup,
} from './accessLog';

describe('buildAccessLogEntry', () => {
  it('arma un log con hora SQL-safe, grupo y actividad', () => {
    const at = new Date('2026-08-12T00:15:42.000Z');
    const log = buildAccessLogEntry({
      memberName: 'Alejandro',
      memberId: '2026887744320988',
      role: 'Socio Royal',
      group: 'Royal',
      activity: 'Ingreso sede',
      status: 'granted',
      notes: 'OK',
      at,
    });
    expect(log.id).toMatch(/^log-/);
    expect(log.date).toBe('2026-08-12');
    expect(log.time).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(log.memberId).toBe('2026887744320988');
    expect(log.status).toBe('granted');
    expect(log.group).toBe('Royal');
    expect(log.activity).toBe('Ingreso sede');
  });
});

describe('tierToGroup', () => {
  it('mapea tiers del padrón', () => {
    expect(tierToGroup('socio_individual')).toBe('SOCIO INDIVIDUAL');
    expect(tierToGroup('grupo_familiar_familiar')).toBe('GRUPO FAMILIAR (Familiar)');
    expect(tierToGroup('')).toBe('—');
  });
});

describe('filterAccessLogs', () => {
  const logs = [
    buildAccessLogEntry({
      memberName: 'Ana',
      memberId: '1',
      group: 'Gold',
      activity: 'Ingreso sede',
      status: 'granted',
      at: new Date('2026-08-10T12:00:00'),
    }),
    buildAccessLogEntry({
      memberName: 'Bruno',
      memberId: '2',
      group: 'Royal',
      activity: 'Acceso denegado',
      status: 'denied',
      at: new Date('2026-08-11T15:00:00'),
    }),
  ];

  it('filtra por búsqueda y estado', () => {
    expect(filterAccessLogs(logs, { query: 'bru' })).toHaveLength(1);
    expect(filterAccessLogs(logs, { status: 'granted' })).toHaveLength(1);
    expect(filterAccessLogs(logs, { group: 'Royal' })[0].memberName).toBe('Bruno');
  });

  it('filtra por día', () => {
    expect(filterAccessLogs(logs, { day: '2026-08-10' })).toHaveLength(1);
  });
});

describe('accessCountsByDay', () => {
  it('agrupa por día del mes', () => {
    const logs = [
      { date: '2026-08-11', status: 'granted' },
      { date: '2026-08-11', status: 'denied' },
      { date: '2026-07-01', status: 'granted' },
    ];
    const map = accessCountsByDay(logs, 2026, 7); // agosto = 7
    expect(map['2026-08-11'].total).toBe(2);
    expect(map['2026-08-11'].granted).toBe(1);
    expect(map['2026-08-11'].denied).toBe(1);
    expect(map['2026-07-01']).toBeUndefined();
  });
});
