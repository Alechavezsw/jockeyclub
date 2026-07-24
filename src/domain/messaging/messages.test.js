import { describe, expect, it } from 'vitest';
import {
  countUnread,
  createMessage,
  getInbox,
  getSent,
  isMessageForUser,
  MAILBOX,
} from './messages';

const base = [
  {
    id: 1,
    sender: 'Admin',
    senderId: 'ops',
    recipientId: '2026887744320988',
    subject: 'A',
    content: 'x',
    isRead: false,
    date: '2026-05-01',
  },
  {
    id: 2,
    sender: 'Admin',
    senderId: 'ops',
    recipientId: MAILBOX.ALL_MEMBERS,
    subject: 'B',
    content: 'y',
    isRead: false,
    date: '2026-05-02',
  },
  {
    id: 3,
    sender: 'Socio',
    senderId: '2026887744320988',
    recipientId: MAILBOX.OPERATIONS,
    subject: 'Consulta',
    content: 'z',
    isRead: false,
    date: '2026-05-03',
  },
];

describe('messaging', () => {
  it('el socio recibe mensajes propios y broadcasts', () => {
    const inbox = getInbox(base, {
      userId: 'local-member-1',
      memberId: '2026887744320988',
      role: 'member',
    });
    expect(inbox.map((m) => m.id)).toEqual([2, 1]);
  });

  it('administración recibe el buzón ops', () => {
    expect(
      isMessageForUser(base[2], { userId: 'local-admin-1', memberId: null, role: 'admin' })
    ).toBe(true);
    expect(countUnread(base, { userId: 'local-admin-1', role: 'admin' })).toBe(1);
  });

  it('createMessage y enviados por senderId', () => {
    const msg = createMessage({
      sender: 'Alejandro',
      senderId: '2026887744320988',
      recipientId: MAILBOX.OPERATIONS,
      subject: 'Hola',
      content: 'Consulta',
    });
    const sent = getSent([msg], { userId: 'x', memberId: '2026887744320988' });
    expect(sent).toHaveLength(1);
    expect(msg.isRead).toBe(false);
  });
});
