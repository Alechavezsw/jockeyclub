/** Envío automático de comprobantes de pagos de socio en caja (idempotente). */

import { getSetting, setSetting } from '../../data/repos';
import { isSupabaseConfigured } from '../../lib/supabase';
import { paymentReceiptDeliverableEmail } from '../members/paymentReceiptEmail';
import { buildCashPaymentDetail, isCashMemberPayment } from './cashPaymentDetail';
import { sendCashPaymentReceipt } from './cashPaymentReceiptDelivery';

export const CASH_RECEIPTS_SENT_SETTING = 'cash_payment_receipts_sent';

/** Clave estable por movimiento/pago para no reenviar. */
export function cashPaymentReceiptKey(movementOrDetail) {
  const payment = String(
    movementOrDetail?.paymentNumber
    || movementOrDetail?.accessinId
    || movementOrDetail?.receiptId
    || '',
  ).trim();
  const member = String(movementOrDetail?.memberNumber || '').replace(/\D/g, '');
  const date = String(movementOrDetail?.date || '').slice(0, 10);
  const amount = Math.round((Number(movementOrDetail?.paymentTotal ?? movementOrDetail?.amount) || 0) * 100);
  if (payment && member) return `${member}:${payment}`;
  if (member && date) return `${member}:${date}:${amount}`;
  return '';
}

/**
 * Pagos de socio que llevan comprobante automático (efectivo y demás medios de cobro).
 * No incluye egresos ni movimientos sin socio.
 */
export function isAutoCashReceiptCandidate(movement) {
  if (!movement) return false;
  const memberNumber = String(movement.memberNumber || '').replace(/\D/g, '');
  if (!memberNumber) return false;
  const amount = Number(movement.amount) || 0;
  if (!(amount > 0)) return false;
  const mt = String(movement.movementType || '').toLowerCase();
  if (mt === 'expense' || mt === 'transfer_out' || mt === 'egreso') return false;
  if (isCashMemberPayment(movement)) return true;
  const label = `${movement.typeLabel || ''} ${movement.description || ''}`;
  if (/egreso|proveedor|sueldo|haberes|retenci[oó]n/i.test(label)) return false;
  return /pago|cuota|cobro|efectivo|transfer|macro|electr|cheque|mercado\s*pago|\bmp\b/i.test(label);
}

export async function loadCashReceiptsSentMap() {
  if (!isSupabaseConfigured) return {};
  try {
    const value = await getSetting(CASH_RECEIPTS_SENT_SETTING);
    if (value && typeof value === 'object' && !Array.isArray(value)) return { ...value };
  } catch {
    /* best-effort */
  }
  return {};
}

export async function persistCashReceiptsSentMap(map) {
  if (!isSupabaseConfigured) return map;
  try {
    await setSetting(CASH_RECEIPTS_SENT_SETTING, map);
  } catch {
    /* best-effort */
  }
  return map;
}

export function markCashReceiptSentLocal(map, key, meta = {}) {
  if (!key) return map;
  return {
    ...map,
    [key]: {
      at: new Date().toISOString(),
      ...meta,
    },
  };
}

const AUTO_RECEIPT_BATCH = 30;
const AUTO_RECEIPT_GAP_MS = 200;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Encola el envío automático de comprobantes pendientes del mes.
 * Best-effort, de a uno, máx. 30 por pasada (el resto al reabrir la hoja).
 */
export async function autoSendCashPaymentReceipts({
  movements = [],
  cobranzas = [],
  members = [],
  onSendMessage,
  sentMap = {},
  onProgress,
  shouldCancel,
  limit = AUTO_RECEIPT_BATCH,
} = {}) {
  let sent = { ...(sentMap || {}) };
  const candidates = (movements || []).filter((row) => {
    if (!isAutoCashReceiptCandidate(row)) return false;
    const key = cashPaymentReceiptKey(row);
    return key && !sent[key];
  });
  const pendingTotal = candidates.length;
  const batch = candidates.slice(0, Math.max(1, Number(limit) || AUTO_RECEIPT_BATCH));

  const summary = {
    total: pendingTotal,
    processed: 0,
    emailed: 0,
    messaged: 0,
    skipped: 0,
    failed: 0,
    remaining: Math.max(0, pendingTotal - batch.length),
  };

  for (let i = 0; i < batch.length; i += 1) {
    if (typeof shouldCancel === 'function' && shouldCancel()) break;
    const row = batch[i];
    const key = cashPaymentReceiptKey(row);
    const detail = buildCashPaymentDetail(row, cobranzas, members);
    if (!detail?.memberNumber) {
      summary.skipped += 1;
      summary.processed += 1;
      continue;
    }
    const email = paymentReceiptDeliverableEmail(detail.email);
    if (!email && typeof onSendMessage !== 'function') {
      summary.skipped += 1;
      summary.processed += 1;
      sent = markCashReceiptSentLocal(sent, key, { status: 'no-contact' });
      if (typeof onProgress === 'function') onProgress({ ...summary, index: i + 1 });
      continue;
    }

    const result = await sendCashPaymentReceipt({ detail, onSendMessage });
    summary.processed += 1;
    if (result.emailed || result.messaged) {
      if (result.emailed) summary.emailed += 1;
      if (result.messaged) summary.messaged += 1;
      sent = markCashReceiptSentLocal(sent, key, {
        status: result.emailed ? 'emailed' : 'messaged',
        to: result.to || null,
      });
    } else if (result.reason === 'sin-contacto' || result.reason === 'sin-socio') {
      summary.skipped += 1;
      sent = markCashReceiptSentLocal(sent, key, { status: 'no-contact', reason: result.reason });
    } else {
      summary.failed += 1;
    }
    if (typeof onProgress === 'function') onProgress({ ...summary, index: i + 1 });
    if (i < batch.length - 1 && typeof window !== 'undefined') {
      await sleep(AUTO_RECEIPT_GAP_MS);
    }
  }

  await persistCashReceiptsSentMap(sent);
  return { ...summary, sentMap: sent };
}
