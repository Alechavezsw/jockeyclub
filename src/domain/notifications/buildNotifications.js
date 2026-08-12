import { filterAlertsForRole } from '../alerts/alerts';
import { MAILBOX } from '../messaging/messages';

/**
 * Notificaciones reales de la campanita (sin semillas demo).
 * - Socio: mensajes no leídos a su credencial / all, deuda propia, waitlist
 * - Staff: bandeja ops, alertas, reclamos abiertos
 */
export function buildNotifications({
  role,
  userId = null,
  memberId = null,
  member = null,
  messages = [],
  waitlist = [],
  claims = [],
  alerts = [],
  alertAcks = [],
  dismissedIds = [],
} = {}) {
  const dismissed = new Set((dismissedIds || []).map(String));
  const push = (list, item) => {
    if (!item?.id || dismissed.has(String(item.id))) return;
    list.push(item);
  };

  const out = [];

  if (role === 'member') {
    if (memberId) {
      (messages || []).forEach((m) => {
        if (m.isRead) return;
        if (m.recipientId !== memberId && m.recipientId !== MAILBOX.ALL_MEMBERS) return;
        push(out, {
          id: `msg-${m.id}`,
          kind: 'message',
          messageId: m.id,
          title: m.subject || 'Mensaje nuevo',
          detail: `${m.sender || 'Administración'} · ${m.date || ''}`.trim(),
          view: 'messages',
          path: '/mensajes',
        });
      });
    }

    // Solo el socio de la sesión (nunca un fallback de padrón)
    if (member && member.memberId === memberId) {
      if (member.notifyDues !== false && (Number(member.outstandingBalance) || 0) > 0) {
        push(out, {
          id: `dues-debt-${member.memberId}`,
          kind: 'dues',
          title: 'Cuota pendiente',
          detail: 'Tenés saldo por abonar. Tocá para ver Mi Cuenta.',
          view: 'payments',
          path: '/cuenta',
        });
      } else if (member.notifyDues !== false && member.nextDueDate) {
        const days = Math.ceil(
          (new Date(`${member.nextDueDate}T12:00:00`) - new Date()) / 86400000
        );
        if (days >= 0 && days <= 10) {
          push(out, {
            id: `dues-soon-${member.memberId}-${member.nextDueDate}`,
            kind: 'dues',
            title: 'Próximo vencimiento de cuota',
            detail: `Vence en ${days} día(s) (${member.nextDueDate}).`,
            view: 'payments',
            path: '/cuenta',
          });
        }
      }

      (waitlist || [])
        .filter((w) => w.memberId === memberId && w.status === 'notified')
        .forEach((w) => {
          push(out, {
            id: `wl-${w.id}`,
            kind: 'waitlist',
            title: 'Turno liberado',
            detail: `${w.facilityName || 'Instalación'} · ${w.date || ''} ${w.time || ''}`.trim(),
            view: 'reservations',
            path: '/reservas',
          });
        });
    }

    return out;
  }

  // Roles operativos
  (messages || []).forEach((m) => {
    if (m.isRead || m.recipientId !== MAILBOX.OPERATIONS) return;
    push(out, {
      id: `inbox-${m.id}`,
      kind: 'message',
      messageId: m.id,
      title: m.subject || 'Mensaje de socio',
      detail: `${m.sender || 'Socio'} · ${m.date || ''}`.trim(),
      view: 'messages',
      path: '/mensajes',
    });
  });

  // Solo alertas que exigen acuse (las informativas van al banner, no a la campanita)
  filterAlertsForRole(alerts || [], role)
    .filter((a) => a.requiresAck && !(alertAcks || []).some((ack) => ack.alertId === a.id))
    .forEach((a) => {
      push(out, {
        id: `alert-${a.id}`,
        kind: 'alert',
        title: a.title || 'Alerta',
        detail: a.body || '',
        view: 'alerts',
        path: '/panel/alerts',
      });
    });

  if (['staff', 'admin', 'superadmin', 'cashier'].includes(role)) {
    (claims || [])
      .filter((c) => ['pending', 'open', 'nuevo', 'in_progress'].includes(String(c.status || '').toLowerCase()))
      .forEach((c) => {
        push(out, {
          id: `claim-${c.id}`,
          kind: 'claim',
          title: `Reclamo: ${c.title || c.subject || 'Sin asunto'}`,
          detail: `${c.memberName || 'Socio'} · ${c.date || ''}`.trim(),
          view: 'claims',
          path: '/panel/claims',
        });
      });
  }

  return out;
}

const DISMISS_KEY = 'jockey-notif-dismissed';

export function loadDismissedNotificationIds() {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

export function saveDismissedNotificationIds(ids) {
  const unique = [...new Set((ids || []).map(String))].slice(-200);
  localStorage.setItem(DISMISS_KEY, JSON.stringify(unique));
  return unique;
}
