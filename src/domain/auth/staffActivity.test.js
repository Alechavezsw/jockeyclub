import { describe, expect, it } from 'vitest';
import {
  buildStaffActivityDays,
  normalizeStaffActivityEvent,
  staffActivityActionLabel,
} from './staffActivity';

describe('staffActivity', () => {
  it('nombra acciones conocidas', () => {
    expect(staffActivityActionLabel('cobro', 'member_payments')).toMatch(/cobro/i);
    expect(staffActivityActionLabel('cash_close', 'cash_sessions')).toMatch(/caja/i);
  });

  it('agrupa por día y colapsa upserts de padrón', () => {
    const days = buildStaffActivityDays([
      {
        id: '1',
        action: 'cobro',
        entityType: 'member_payments',
        createdAt: '2026-11-22T15:00:00.000Z',
        payload: { amount: 70000, memberNumber: '10500', concept: 'Cuota' },
      },
      {
        id: '2',
        action: 'upsert',
        entityType: 'members',
        createdAt: '2026-11-22T14:00:00.000Z',
      },
      {
        id: '3',
        action: 'upsert',
        entityType: 'members',
        createdAt: '2026-11-22T13:00:00.000Z',
      },
      {
        id: '4',
        action: 'member.profile_update',
        entityType: 'members',
        createdAt: '2026-11-21T18:00:00.000Z',
        payload: { memberNumber: '10001' },
      },
    ]);

    expect(days).toHaveLength(2);
    expect(days[0].dayKey).toBe('2026-11-22');
    expect(days[0].counts.cobros).toBe(1);
    const rollup = days[0].events.find((row) => row.source === 'rollup');
    expect(rollup?.payload?.count).toBe(2);
    expect(days[1].events[0].action).toBe('member.profile_update');
  });

  it('arma resumen de cobro', () => {
    const row = normalizeStaffActivityEvent({
      action: 'cobro',
      entityType: 'member_payments',
      createdAt: '2026-11-22T12:00:00.000Z',
      payload: { amount: 40000, memberNumber: '101', memberName: 'Ana' },
    });
    expect(row.summary).toMatch(/101/);
    expect(row.summary).toMatch(/Ana/);
  });
});
