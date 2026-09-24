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

  it('ops con padrón ve solicitudes de nuevo socio pendientes', () => {
    const list = buildNotifications({
      role: 'admin',
      membershipApplications: [
        {
          id: 'j1',
          fullName: 'Nuevo Socio',
          documentNumber: '30111222',
          status: 'pending',
          createdAt: '2026-09-22T12:00:00.000Z',
        },
        { id: 'j2', fullName: 'Ya resuelto', status: 'approved' },
      ],
    });
    expect(list.map((n) => n.id)).toContain('join-j1');
    expect(list.map((n) => n.id)).not.toContain('join-j2');
    expect(list.find((n) => n.id === 'join-j1')?.title).toBe('Solicitud de nuevo socio');
  });

  it('el socio no ve solicitudes de alta ajenas', () => {
    const list = buildNotifications({
      role: 'member',
      memberId: '111',
      member: { memberId: '111' },
      membershipApplications: [{ id: 'j1', fullName: 'Otro', status: 'pending' }],
    });
    expect(list.some((n) => n.kind === 'join_request')).toBe(false);
  });

  it('el día 10 avisa el vencimiento aunque la ficha no tenga fecha', () => {
    const list = buildNotifications({
      role: 'member',
      memberId: '111',
      member: { memberId: '111', status: 'active', outstandingBalance: 0, notifyDues: true },
      todayIso: '2026-10-10',
    });
    expect(list.map((n) => n.title)).toEqual(['Hoy vence tu cuota']);
    expect(list[0].id).toBe('dues-due-111-2026-10-10');
    expect(list[0].path).toBe('/cuenta');
  });

  it('fuera del día 10 no inventa un aviso de vencimiento', () => {
    const list = buildNotifications({
      role: 'member',
      memberId: '111',
      member: { memberId: '111', status: 'active', outstandingBalance: 5000, notifyDues: true },
      todayIso: '2026-09-23',
    });
    expect(list.map((n) => n.title)).toEqual(['Cuota pendiente']);
  });

  it('una cuota ya pasada queda como vencida', () => {
    const list = buildNotifications({
      role: 'member',
      memberId: '111',
      member: {
        memberId: '111',
        status: 'active',
        nextDueDate: '2026-07-10',
        outstandingBalance: 0,
      },
      todayIso: '2026-09-23',
    });
    expect(list[0].title).toBe('Tu cuota está vencida');
    expect(list[0].id).toBe('dues-overdue-111-2026-07-10');
  });

  it('si el aviso de vencimiento ya está en la bandeja, no lo duplica', () => {
    const list = buildNotifications({
      role: 'member',
      memberId: '111',
      member: { memberId: '111', status: 'active', notifyDues: true },
      todayIso: '2026-10-10',
      messages: [{
        id: 'm1',
        recipientId: '111',
        subject: 'Hoy vence tu cuota',
        sender: 'Secretaría',
        isRead: false,
        date: '2026-10-10',
        meta: { kind: 'dues_due', dueOn: '2026-10-10' },
      }],
    });
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe('message');
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
