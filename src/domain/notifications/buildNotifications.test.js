import { describe, expect, it } from 'vitest';
import { buildNotifications } from './buildNotifications';

describe('buildNotifications', () => {
  it('socio solo ve mensajes a su credencial, no usa otro socio del padrón', () => {
    const list = buildNotifications({
      role: 'member',
      memberId: '111',
      member: { memberId: '111', outstandingBalance: 0, notifyDues: true },
      messages: [
        { id: 'a', recipientId: '111', subject: 'Hola', sender: 'Ops', isRead: false, date: '2026-08-12' },
        { id: 'b', recipientId: '999', subject: 'Otro', sender: 'Ops', isRead: false, date: '2026-08-12' },
        { id: 'c', recipientId: 'all', subject: 'Broadcast', sender: 'Ops', isRead: false, date: '2026-08-12' },
      ],
    });
    expect(list.map((n) => n.messageId)).toEqual(['a', 'c']);
  });

  it('no inventa deuda si el member de sesión no coincide', () => {
    const list = buildNotifications({
      role: 'member',
      memberId: '111',
      member: { memberId: '222', outstandingBalance: 50000 },
      messages: [],
    });
    expect(list).toEqual([]);
  });

  it('ops ve bandeja ops no leída', () => {
    const list = buildNotifications({
      role: 'admin',
      messages: [
        { id: 'x', recipientId: 'ops', subject: 'Consulta', sender: 'Socio', isRead: false, date: '2026-08-12' },
        { id: 'y', recipientId: 'ops', subject: 'Viejo', sender: 'Socio', isRead: true, date: '2026-08-11' },
      ],
      claims: [],
      alerts: [],
    });
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Consulta');
  });

  it('notificaciones leídas en BD (dismissedIds) no vuelven a aparecer', () => {
    const list = buildNotifications({
      role: 'admin',
      messages: [
        { id: 'x', recipientId: 'ops', subject: 'Consulta', sender: 'Socio', isRead: false, date: '2026-08-12' },
      ],
      dismissedIds: ['inbox-x'],
    });
    expect(list).toHaveLength(0);
  });

  it('no mete alertas informativas (sin acuse) en la campanita', () => {
    const list = buildNotifications({
      role: 'admin',
      messages: [],
      alerts: [
        {
          id: 'alert-seed-1',
          title: 'Asamblea',
          body: 'Demo',
          audience: 'members',
          isActive: true,
          startsAt: '2020-01-01T00:00:00.000Z',
          requiresAck: false,
        },
      ],
    });
    expect(list).toHaveLength(0);
  });
});
