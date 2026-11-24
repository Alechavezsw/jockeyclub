import { createMessage, MAILBOX } from '../messaging/messages';

const STAFF_MAIL_ROLES = [
  'staff',
  'hr',
  'admin_employee',
  'gate_operator',
  'pool_operator',
  'cashier',
  'accountant',
  'admin',
  'superadmin',
];

const ADMIN_MAIL_ROLES = ['admin', 'superadmin', 'accountant'];

/** Destino del MD según audiencia de la alerta. */
export function alertDmRecipient(audience) {
  const next = String(audience || 'all').toLowerCase();
  if (next === 'staff' || next === 'admin') return MAILBOX.OPERATIONS;
  return MAILBOX.ALL_MEMBERS;
}

/** Audiencia para send-club-mail (all | staff | admin). */
export function alertMailAudience(audience) {
  const next = String(audience || 'all').toLowerCase();
  if (next === 'staff') return 'staff';
  if (next === 'admin') return 'admin';
  // members / all → mail a socios
  return 'all';
}

/** El mail a socios sale por la revisión de Mensajería, no desde la alerta. */
export function alertMailNeedsPadronPreview(audience) {
  return alertMailAudience(audience) === 'all';
}

export function alertMailRoles(audience) {
  const next = String(audience || 'all').toLowerCase();
  if (next === 'admin') return [...ADMIN_MAIL_ROLES];
  if (next === 'staff') return [...STAFF_MAIL_ROLES];
  return [];
}

export function buildAlertDmMessage(alert, {
  senderName = 'Administración Jockey Club',
} = {}) {
  const title = String(alert?.title || '').trim();
  const body = String(alert?.body || '').trim();
  if (!title || !body) return null;
  const severity = String(alert?.severity || 'info');
  const subject = severity === 'critical'
    ? `Alerta · ${title}`
    : title;
  return createMessage({
    sender: senderName,
    senderId: MAILBOX.OPERATIONS,
    recipientId: alertDmRecipient(alert?.audience),
    subject,
    content: body,
    meta: {
      kind: 'club_alert',
      alertId: alert?.id || null,
      severity,
      audience: alert?.audience || 'all',
      source: alert?.source || 'manual',
      requiresAck: Boolean(alert?.requiresAck),
      mail: true,
    },
  });
}

export function alertDeliverySummary({ dm, mail, mailed, mailPadron } = {}) {
  const bits = [];
  if (dm) bits.push(dm === MAILBOX.OPERATIONS ? 'MD a operaciones' : 'MD a socios');
  if (mailPadron) bits.push('el mail al padrón se confirma en Mensajería');
  if (mail) {
    const sent = Number(mailed?.sent) || 0;
    const failed = Number(mailed?.failed) || 0;
    bits.push(sent === 1 ? '1 mail' : `${sent} mails`);
    if (failed) bits.push(`${failed} mails no salieron`);
  }
  return bits.length ? `Alerta publicada. ${bits.join(' · ')}.` : 'Alerta publicada.';
}
