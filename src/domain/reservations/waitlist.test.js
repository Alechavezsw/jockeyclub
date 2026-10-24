import { describe, expect, it } from 'vitest';
import {
  canJoinWaitlist,
  joinWaitlist,
  leaveWaitlist,
  notifyNextOnWaitlist,
  waitingForSlot,
} from './waitlist';

const slot = {
  facilityId: 'tenis-1',
  facilityName: 'Cancha 1',
  date: '2026-12-15',
  time: '18:00',
};

describe('joinWaitlist', () => {
  it('exige instalación, fecha, horario y socio', () => {
    expect(() => joinWaitlist([], { ...slot, memberId: '' })).toThrow(/socio/i);
    expect(() => joinWaitlist([], { memberId: '1', date: '2026-12-15', time: '18:00' }))
      .toThrow(/instalación/i);
  });

  it('agrega en waiting y rechaza duplicado', () => {
    const first = joinWaitlist([], { ...slot, memberId: '10', memberName: 'Ana' });
    expect(first.entry.status).toBe('waiting');
    expect(first.entries).toHaveLength(1);
    expect(() => joinWaitlist(first.entries, { ...slot, memberId: '10' }))
      .toThrow(/ya estás en lista/i);
  });
});

describe('leaveWaitlist / waitingForSlot / notifyNext', () => {
  it('cancela, ordena por llegada y notifica al primero', () => {
    const a = joinWaitlist([], { ...slot, memberId: '1', memberName: 'A' });
    // fuerza createdAt distinto
    const early = { ...a.entry, id: 'wl-a', createdAt: '2026-12-01T10:00:00.000Z' };
    const late = {
      ...a.entry,
      id: 'wl-b',
      memberId: '2',
      memberName: 'B',
      createdAt: '2026-12-01T11:00:00.000Z',
    };
    const entries = [late, early];
    expect(waitingForSlot(entries, slot).map((e) => e.id)).toEqual(['wl-a', 'wl-b']);

    const left = leaveWaitlist(entries, 'wl-a');
    expect(left.find((e) => e.id === 'wl-a').status).toBe('cancelled');

    const stillWaiting = left.filter((e) => e.status === 'waiting');
    const { notified, entries: after } = notifyNextOnWaitlist(stillWaiting, slot);
    expect(notified.id).toBe('wl-b');
    expect(after.find((e) => e.id === 'wl-b').status).toBe('notified');
    expect(notifyNextOnWaitlist([], slot).notified).toBeNull();
  });
});

describe('canJoinWaitlist', () => {
  it('solo si el turno ya está ocupado', () => {
    expect(canJoinWaitlist([], slot)).toBe(false);
    expect(canJoinWaitlist([{
      facilityId: 'tenis-1',
      date: '2026-12-15',
      time: '18:00',
      status: 'confirmed',
    }], slot)).toBe(true);
    expect(canJoinWaitlist([{
      facilityId: 'tenis-1',
      date: '2026-12-15',
      time: '18:00',
      status: 'cancelled',
    }], slot)).toBe(false);
  });
});
