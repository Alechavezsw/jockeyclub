import { MAILBOX } from '../messaging/messages';
import { CLUB_BANK_ACCOUNTS } from './clubBanks';

const REQUEST_KINDS = new Set(['dues_payment', 'booking_payment']);
/** Incluye MP: la operación llega igual, aunque acredite solo. */
const REQUEST_METHODS = new Set(['transferencia', 'debito', 'tarjeta', 'mercadopago']);

/**
 * Aviso que llega cuando el socio paga desde la app.
 * Transferencia / débito / tarjeta → hay que imputar.
 * Mercado Pago → llega la operación, pero el cobro es automático.
 */
export function isAppPaymentRequest(message) {
  if (!message || message.recipientId !== MAILBOX.OPERATIONS) return false;
  const kind = String(message?.meta?.kind || '');
  if (!REQUEST_KINDS.has(kind)) return false;
  if (message.meta?.paymentRequest === true || message.meta?.paymentAuto === true) return true;
  const method = String(message?.meta?.method || '').toLowerCase();
  return REQUEST_METHODS.has(method);
}

/** Mercado Pago: se acredita solo; no abre cobro manual. */
export function isAppPaymentAuto(message) {
  if (!isAppPaymentRequest(message)) return false;
  if (message.meta?.paymentAuto === true) return true;
  return String(message?.meta?.method || '').toLowerCase() === 'mercadopago';
}

/** Solicitud todavía abierta: falta imputar / atender (no basta con marcar leída en MD). */
export function isOpenAppPaymentRequest(message) {
  if (!isAppPaymentRequest(message)) return false;
  if (message?.meta?.paymentHandled === true) return false;
  return true;
}

/** Cierra la operación en Pagos entrantes (tras cobro, Ver en MP o dismiss). */
export function withAppPaymentHandled(message, at = new Date().toISOString()) {
  if (!message) return message;
  return {
    ...message,
    isRead: true,
    meta: {
      ...(message.meta || {}),
      paymentHandled: true,
      paymentHandledAt: at,
    },
  };
}

export function listOpenAppPaymentRequests(messages = []) {
  return (messages || [])
    .filter(isOpenAppPaymentRequest)
    .toSorted((a, b) => String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || '')));
}

export function appPaymentRequestMethodLabel(message) {
  const method = String(message?.meta?.method || '').toLowerCase();
  if (method === 'transferencia') return 'Transferencia';
  if (method === 'debito') return 'Débito';
  if (method === 'tarjeta') return 'Tarjeta';
  if (method === 'mercadopago') return 'Mercado Pago';
  return 'Pago app';
}

export function appPaymentRequestKindLabel(message) {
  const kind = String(message?.meta?.kind || '');
  if (kind === 'booking_payment') return 'Reserva';
  return 'Cuota';
}

export function appPaymentRequestMemberId(message) {
  return String(message?.senderId || message?.meta?.memberId || '').trim();
}

/** Importe si vino en el cuerpo del aviso («Importe: $ …»). */
export function appPaymentRequestAmountLabel(message) {
  const text = String(message?.content || '');
  const match = text.match(/Importe:\s*([^\n]+)/i);
  return match ? String(match[1] || '').trim() : '';
}

/** Parsea «$ 77.000» / «77000» a número. */
export function parseAppPaymentAmountLabel(label) {
  const raw = String(label || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[^\d,.-]/g, '')
    .trim();
  if (!raw) return null;
  if (raw.includes(',') && raw.includes('.')) {
    const n = Number(raw.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  if (raw.includes(',')) {
    const n = Number(raw.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
    const n = Number(raw.replace(/\./g, ''));
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function paymentDay(row) {
  return String(row?.date || row?.paidAt || row?.createdAt || '').slice(0, 10);
}

function daysBetween(a, b) {
  const left = Date.parse(`${a}T12:00:00`);
  const right = Date.parse(`${b}T12:00:00`);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Infinity;
  return Math.abs(left - right) / 86400000;
}

function methodsCompatible(noticeMethod, paymentMethod) {
  const notice = String(noticeMethod || '').toLowerCase();
  const pay = String(paymentMethod || '').toLowerCase();
  if (!notice || !pay) return false;
  if (notice === pay) return true;
  if (notice === 'mercadopago' && (pay === 'mercadopago' || pay === 'debito')) return true;
  if (notice === 'debito' && (pay === 'debito' || pay === 'mercadopago')) return true;
  if (notice === 'transferencia' && pay === 'transferencia') return true;
  if (notice === 'tarjeta' && (pay === 'tarjeta' || pay === 'card')) return true;
  return false;
}

/**
 * Si ya hay un cobro del socio que cuadra con la solicitud (mismo medio,
 * importe parecido, ±7 días), la operación ya estaba imputada.
 */
export function findAppPaymentRequestCollection(message, member, { windowDays = 7 } = {}) {
  if (!isAppPaymentRequest(message) || !member) return null;
  const history = Array.isArray(member.paymentHistory) ? member.paymentHistory : [];
  if (!history.length) return null;

  const noticeMethod = String(message?.meta?.method || '').toLowerCase();
  const noticeAmount = parseAppPaymentAmountLabel(appPaymentRequestAmountLabel(message));
  const noticeDay = String(message?.date || message?.createdAt || '').slice(0, 10);
  if (!noticeDay) return null;

  let best = null;
  let bestScore = Infinity;
  for (const row of history) {
    if (String(row?.status || 'paid').toLowerCase() === 'void') continue;
    if (!methodsCompatible(noticeMethod, row?.method)) continue;
    const day = paymentDay(row);
    if (!day || daysBetween(noticeDay, day) > windowDays) continue;
    const paid = Number(row?.amount);
    if (!Number.isFinite(paid) || paid <= 0) continue;
    if (noticeAmount != null && noticeAmount > 0) {
      const ratio = paid / noticeAmount;
      // Exacto, o aviso con 10 % vs cobro solo capital (y al revés).
      const close = Math.abs(paid - noticeAmount) <= 1
        || Math.abs(paid - noticeAmount / 1.1) <= 1
        || Math.abs(paid - noticeAmount * 1.1) <= 1
        || (ratio >= 0.85 && ratio <= 1.15);
      if (!close) continue;
    }
    const score = daysBetween(noticeDay, day) + (noticeAmount != null
      ? Math.abs(paid - noticeAmount) / Math.max(noticeAmount, 1)
      : 0);
    if (score < bestScore) {
      bestScore = score;
      best = row;
    }
  }
  return best || null;
}

export function appPaymentRequestCollectionLabel(payment) {
  if (!payment) return '';
  const receipt = payment.receiptNumber || payment.receipt || '';
  const day = paymentDay(payment);
  if (receipt && day) return `Ya imputado y cobrado · ${receipt} · ${day}`;
  if (receipt) return `Ya imputado y cobrado · ${receipt}`;
  if (day) return `Ya imputado y cobrado · ${day}`;
  return 'Ya imputado y cobrado';
}

/** Comprobante ya subido por el socio (path en Storage). */
export function appPaymentRequestReceipt(message) {
  const attachment = message?.meta?.attachment;
  if (!attachment?.path && !attachment?.dataUrl) return null;
  return {
    path: attachment.path || null,
    bucket: attachment.bucket || 'dues-receipts',
    name: attachment.name || 'Comprobante app',
    mimeType: attachment.mimeType || attachment.mime || '',
    size: Number(attachment.size) || 0,
    dataUrl: attachment.dataUrl || null,
  };
}

/** Banco / alias mencionado en el aviso, si coincide con las cuentas del club. */
export function appPaymentRequestBankId(message) {
  const text = String(message?.content || '');
  const match = text.match(/Banco:\s*([^\n]+)/i);
  const label = String(match?.[1] || '').trim().toLowerCase();
  if (!label) return null;
  const bank = CLUB_BANK_ACCOUNTS.find((row) => {
    const name = String(row.name || '').toLowerCase();
    const alias = String(row.alias || '').toLowerCase();
    return (name && label.includes(name)) || (alias && label.includes(alias));
  });
  return bank?.id || null;
}

/** Método sugerido para el modal de cobro. */
export function appPaymentRequestCollectMethod(message) {
  const method = String(message?.meta?.method || '').toLowerCase();
  if (method === 'transferencia' || method === 'debito' || method === 'tarjeta') return method;
  return 'transferencia';
}
