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
