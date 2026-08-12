import { canAccessAdmin } from '../auth/roles';

/** Buzones especiales del club. */
export const MAILBOX = {
  ALL_MEMBERS: 'all',
  OPERATIONS: 'ops',
};

export function createMessage({
  sender,
  senderId,
  recipientId,
  subject,
  content,
  parentId = null,
}) {
  const now = new Date();
  return {
    id: `msg-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
    date: now.toISOString().split('T')[0],
    createdAt: now.toISOString(),
    sender: sender.trim(),
    senderId: senderId || null,
    recipientId,
    subject: subject.trim(),
    content: content.trim(),
    isRead: false,
    parentId,
  };
}

export function isMessageForUser(message, { userId, memberId, role }) {
  if (!message) return false;
  const to = message.recipientId;

  if (to === MAILBOX.ALL_MEMBERS && role === 'member') return true;
  if (memberId && to === memberId) return true;
  if (userId && to === userId) return true;
  if (to === MAILBOX.OPERATIONS && canAccessAdmin(role)) return true;

  return false;
}

export function getInbox(messages, identity) {
  return [...messages]
    .filter((m) => isMessageForUser(m, identity))
    .sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)));
}

export function getSent(messages, { userId, memberId, role }) {
  return [...messages]
    .filter((m) => {
      if (memberId && m.senderId === memberId) return true;
      if (userId && m.senderId === userId) return true;
      // Staff/admin: también lo enviado como buzón ops
      if (canAccessAdmin(role) && m.senderId === MAILBOX.OPERATIONS) return true;
      return false;
    })
    .sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)));
}

export function countUnread(messages, identity) {
  return getInbox(messages, identity).filter((m) => !m.isRead).length;
}

export function markMessageRead(messages, messageId) {
  return messages.map((m) => (m.id === messageId ? { ...m, isRead: true } : m));
}

export function markInboxRead(messages, identity) {
  return messages.map((m) => (isMessageForUser(m, identity) ? { ...m, isRead: true } : m));
}

/** Destinatarios disponibles según rol. */
export function composeRecipients({ role, members = [], user }) {
  if (canAccessAdmin(role)) {
    return [
      { id: MAILBOX.ALL_MEMBERS, label: 'Todos los socios' },
      ...members.map((m) => ({
        id: m.memberId,
        label: `${m.name} · Socio`,
      })),
    ];
  }

  return [
    { id: MAILBOX.OPERATIONS, label: 'Administración / Secretaría' },
  ];
}

export function recipientLabel(recipientId, members = []) {
  if (recipientId === MAILBOX.ALL_MEMBERS) return 'Todos los socios';
  if (recipientId === MAILBOX.OPERATIONS) return 'Administración';
  const member = members.find((m) => m.memberId === recipientId);
  return member?.name || recipientId;
}
