import { filterAlertsForRole, isAlertAcknowledged } from '../alerts/alerts';
import { MAILBOX } from '../messaging/messages';
import { allowedAdminTabs } from '../auth/roles';
import { isMemberBillingActive, nextDuesDueDate, pinDuesDueDate } from '../members/dues';
import { formatISODateLongAR, todayISODateAR } from '../../lib/arDate';

/**
 * Notificaciones reales de la campanita (sin semillas demo).
 * - Socio: mensajes no leídos a su credencial / all, deuda propia, waitlist
 * - Staff: bandeja ops, alertas, reclamos abiertos, solicitudes de alta
 */

const DAY_MS = 86400000;

function daysUntil(fromIso, toIso) {
  const from = Date.parse(`${fromIso}T12:00:00Z`);
  const to = Date.parse(`${toIso}T12:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / DAY_MS);
}

/** Día de cuota que corresponde avisar: el de la ficha, o el 10 si todavía no hay fecha. */
export function memberDueOn(member, todayIso = todayISODateAR()) {
  if (!member || member.notifyDues === false) return null;
  if (!isMemberBillingActive(member)) return null;
  if (member.nextDueDate) return pinDuesDueDate(member.nextDueDate);
  return nextDuesDueDate(`${todayIso}T12:00:00`);
}

export function duesBellItem(member, todayIso = todayISODateAR()) {
  const dueOn = memberDueOn(member, todayIso);
  const days = dueOn ? daysUntil(todayIso, dueOn) : null;
  if (days == null || days > 5) return null;
  const when = formatISODateLongAR(dueOn);
  if (days === 5) {
    return {
      id: `dues-upcoming-${member.memberId}-${dueOn}`,
      dueOn,
      kind: 'dues',
      title: 'Tu cuota vence en 5 días',
      detail: `Vence el ${when}. En mora hay recargo, no se entra al club y no se paga pileta.`,
      view: 'payments',
      path: '/cuenta',
    };
  }
  if (days > 0) return null;
  if (days === 0) {
    return {
      id: `dues-due-${member.memberId}-${dueOn}`,
      dueOn,
      kind: 'dues',
      title: 'Hoy vence tu cuota',
      detail: `Vence el ${when}. Si no abonás, desde mañana hay mora.`,
      view: 'payments',
      path: '/cuenta',
    };
  }
  return {
    id: `dues-overdue-${member.memberId}-${dueOn}`,
    dueOn,
    kind: 'dues',
    title: 'Tu cuota está en mora',
    detail: `Venció el ${when}. Recargo del 10 %, sin ingreso al club ni pileta hasta regularizar.`,
    view: 'payments',
    path: '/cuenta',
  };
}

function messageTitle(message, fallback) {
  const kind = message?.meta?.kind;
  if (kind === 'dues_payment') return message.subject || 'Comprobante de cuota';
  if (kind === 'booking_payment') return message.subject || 'Comprobante de reserva';
  if (kind === 'dues_receipt') return message.subject || 'Recibo de pago';
  if (kind === 'dues_due' || kind === 'dues_upcoming' || kind === 'dues_mora') {
    return message.subject || 'Aviso de cuota';
  }
  return message?.subject || fallback;
}

function requestWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16);
  return d.toLocaleString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function buildNotifications({
  role,
  memberId = null,
  member = null,
  messages = [],
  waitlist = [],
  claims = [],
  reservations = [],
  membershipApplications = [],
  alerts = [],
  alertAcks = [],
  dismissedIds = [],
  todayIso = todayISODateAR(),
  membersCanViewCurrentAccounts = true,
} = {}) {
  const dismissed = new Set((dismissedIds || []).map(String));
  const push = (list, item) => {
    if (!item?.id) return;
    // Leídas en BD (notification_reads) / descartadas: no vuelven a la campanita
    if (dismissed.has(String(item.id))) return;
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
          title: messageTitle(m, 'Mensaje nuevo'),
          detail: `${m.sender || 'Administración'} · ${m.date || ''}`.trim(),
          view: 'messages',
          path: '/mensajes',
        });
      });
    }

    // Solo el socio de la sesión (nunca un fallback de padrón)
    if (member && member.memberId === memberId) {
      const dueItem = duesBellItem(member, todayIso);
      const dueKind = String(dueItem?.id || '').startsWith('dues-upcoming-')
        ? 'dues_upcoming'
        : String(dueItem?.id || '').startsWith('dues-overdue-')
          ? 'dues_mora'
          : 'dues_due';
      const dueUnreadInInbox = dueItem && (messages || []).some((m) => (
        !m.isRead
        && m.meta?.kind === dueKind
        && m.meta?.dueOn === dueItem.dueOn
        && (m.recipientId === memberId || m.recipientId === MAILBOX.ALL_MEMBERS)
      ));
      if (dueItem && !dueUnreadInInbox) {
        push(out, membersCanViewCurrentAccounts
          ? dueItem
          : { ...dueItem, view: 'profile', path: '/perfil' });
      } else if (!dueItem && member.notifyDues !== false && (Number(member.outstandingBalance) || 0) > 0) {
        const bal = Number(member.outstandingBalance) || 0;
        push(out, {
          id: `dues-debt-${member.memberId}-${bal}`,
          kind: 'dues',
          title: 'Cuota pendiente',
          detail: membersCanViewCurrentAccounts
            ? 'Tenés saldo por abonar. Tocá para ver Mi Cuenta.'
            : 'Tenés un pendiente de cuota. Regularizalo en administración.',
          view: membersCanViewCurrentAccounts ? 'payments' : 'profile',
          path: membersCanViewCurrentAccounts ? '/cuenta' : '/perfil',
        });
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

      const todayBookings = (reservations || []).filter((r) => (
        String(r.memberId) === String(memberId)
        && r.status === 'confirmed'
        && String(r.date || '').slice(0, 10) === todayIso
      ));
      if (todayBookings.length) {
        const first = todayBookings[0];
        const place = [first.facilityName || first.facilityId, first.time].filter(Boolean).join(' · ');
        push(out, {
          id: `rsv-today-${memberId}-${todayIso}`,
          kind: 'reservation',
          title: todayBookings.length === 1 ? 'Tenés una reserva hoy' : `Tenés ${todayBookings.length} reservas hoy`,
          detail: place || 'Mirá tus turnos.',
          view: 'reservations',
          path: '/reservas',
        });
      }

      (claims || [])
        .filter((c) => String(c.memberId) === String(memberId) && String(c.response || '').trim())
        .forEach((c) => {
          push(out, {
            id: `claim-reply-${c.id}`,
            kind: 'claim_reply',
            title: 'Respondieron tu reclamo',
            detail: String(c.response).trim(),
            view: 'dashboard',
            path: '/',
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
      title: messageTitle(m, 'Mensaje de socio'),
      detail: `${m.sender || 'Socio'} · ${m.date || ''}`.trim(),
      view: 'messages',
      path: '/mensajes',
    });
  });

  // Solo alertas que exigen acuse (las informativas van al banner, no a la campanita)
  filterAlertsForRole(alerts || [], role)
    .filter((a) => a.requiresAck && !isAlertAcknowledged(a, alertAcks))
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

  if (allowedAdminTabs(role).includes('bookings')) {
    const pending = (reservations || []).filter((r) => r.status === 'pending');
    if (pending.length) {
      const stamp = pending.map((r) => r.id).sort().join(',');
      push(out, {
        id: `rsv-pending-${stamp}`,
        kind: 'reservation',
        title: pending.length === 1 ? 'Reserva pendiente' : `${pending.length} reservas pendientes`,
        detail: 'Hay turnos esperando confirmación.',
        view: 'bookings',
        path: '/panel/bookings',
      });
    }
  }

  if (allowedAdminTabs(role).includes('members')) {
    (membershipApplications || [])
      .filter((app) => String(app.status || 'pending') === 'pending')
      .forEach((app) => {
        const who = String(app.fullName || '').trim() || 'Sin nombre';
        const doc = String(app.documentNumber || '').replace(/\D/g, '');
        const when = requestWhen(app.createdAt);
        push(out, {
          id: `join-${app.id}`,
          kind: 'join_request',
          title: 'Solicitud de nuevo socio',
          detail: [who, doc ? `DNI ${doc}` : '', when].filter(Boolean).join(' · '),
          view: 'members',
          path: '/panel/members?solicitudes=alta',
        });
      });
  }

  return out;
}

const DISMISS_KEY = 'jockey-notif-dismissed-v2';

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
