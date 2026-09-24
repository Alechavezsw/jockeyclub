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

const READ_STORE = 'jockey-read-messages:v1';
const memoryReads = new Map();

export function messageReaderKey({ userId, memberId } = {}) {
  return String(userId || memberId || '');
}

export function loadReadMessageIds(reader) {
  const ids = new Set(memoryReads.get(reader) || []);
  if (!reader || typeof localStorage === 'undefined') return ids;
  try {
    const raw = JSON.parse(localStorage.getItem(`${READ_STORE}:${reader}`) || '[]');
    if (Array.isArray(raw)) raw.forEach((id) => ids.add(String(id)));
  } catch {
    /* almacenamiento no disponible */
  }
  return ids;
}

export function rememberReadMessage(reader, messageId) {
  if (!reader || messageId == null) return;
  const ids = loadReadMessageIds(reader);
  ids.add(String(messageId));
  memoryReads.set(reader, ids);
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(`${READ_STORE}:${reader}`, JSON.stringify([...ids]));
  } catch {
    /* incógnito o cuota: queda en memoria de la sesión */
  }
}

/** La lectura de un aviso a todos los socios es de cada persona, no de la fila compartida. */
export function withRememberedReads(messages, reader, previous = []) {
  const remembered = loadReadMessageIds(reader);
  const already = new Set(
    (previous || []).filter((m) => m?.isRead).map((m) => String(m.id))
  );
  if (!remembered.size && !already.size) return messages || [];
  return (messages || []).map((m) => (
    remembered.has(String(m.id)) || already.has(String(m.id))
      ? { ...m, isRead: true }
      : m
  ));
}

export function markMessageRead(messages, messageId) {
  return messages.map((m) => (m.id === messageId ? { ...m, isRead: true } : m));
}

export function markInboxRead(messages, identity) {
  return messages.map((m) => (isMessageForUser(m, identity) ? { ...m, isRead: true } : m));
}

/** Destinatarios disponibles según rol. */
export function composeRecipients({ role, members = [] }) {
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
