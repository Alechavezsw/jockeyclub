/**
 * Comprobantes Colonia — internos, no fiscales.
 * Reutiliza patrones de deliverPaymentReceipt sin mezclar cuota social.
 */

import { buildColoniaReceipt } from './coloniaLedger';
import { paymentReceiptDeliverableEmail } from '../members/paymentReceiptEmail';

export const COLONIA_RECEIPT_KIND = 'colonia';

export function shouldDeliverColoniaReceipt(payment = {}) {
  return String(payment.status || '').toLowerCase() === 'confirmed'
    && !payment.receipt_delivered_at
    && !payment.receiptDeliveredAt;
}

export function coloniaReceiptIdempotencyKey(paymentId) {
  return `colonia_receipt:${paymentId}`;
}

export function buildColoniaReceiptDeliveryPayload({
  payment,
  student,
  guardian,
  season,
  chargeConcepts = [],
  onSendMessage,
} = {}) {
  if (!shouldDeliverColoniaReceipt(payment)) {
    return { ok: false, reason: 'not_confirmed_or_already_sent' };
  }
  const receipt = buildColoniaReceipt({
    payment,
    student,
    guardian,
    season,
    chargeConcepts,
  });
  if (!receipt) return { ok: false, reason: 'receipt_unavailable' };

  const email = paymentReceiptDeliverableEmail(
    guardian?.email || guardian?.Email || payment?.guardianEmail,
  );
  const memberNumber = guardian?.member_number
    || guardian?.memberNumber
    || student?.member_number
    || student?.memberNumber
    || null;

  return {
    ok: true,
    kind: COLONIA_RECEIPT_KIND,
    fiscalClaim: false,
    receipt,
    email,
    memberNumber,
    canMessage: Boolean(memberNumber && typeof onSendMessage === 'function'),
    idempotencyKey: coloniaReceiptIdempotencyKey(payment.id || payment.paymentId),
    notificationKinds: ['pago_confirmado', 'comprobante_disponible'],
  };
}

/**
 * Best-effort delivery helper (dry-run por defecto).
 * No envía mail real si dryRun=true.
 */
export async function deliverColoniaPaymentReceipt({
  payment,
  student,
  guardian,
  season,
  chargeConcepts,
  onSendMessage,
  enqueueNotification,
  markDelivered,
  dryRun = true,
} = {}) {
  const payload = buildColoniaReceiptDeliveryPayload({
    payment,
    student,
    guardian,
    season,
    chargeConcepts,
    onSendMessage,
  });
  if (!payload.ok) return { emailed: false, messaged: false, reason: payload.reason };

  let messaged = false;
  if (payload.canMessage && !dryRun) {
    try {
      await onSendMessage({
        subject: 'Comprobante Colonia de Verano',
        content: [
          `Registramos tu pago de Colonia por $${payload.receipt.amount}.`,
          `Alumno: ${payload.receipt.studentName}`,
          `Operación: ${payload.receipt.operationId || '—'}`,
          payload.receipt.fiscalNote,
        ].join('\n'),
        recipientId: String(payload.memberNumber),
        meta: { kind: 'colonia_receipt', paymentId: payment.id },
      });
      messaged = true;
    } catch {
      /* best-effort */
    }
  }

  if (typeof enqueueNotification === 'function') {
    for (const kind of payload.notificationKinds) {
      await enqueueNotification({
        kind,
        paymentId: payment.id,
        enrollmentId: payment.enrollment_id || payment.enrollmentId,
        recipientEmail: payload.email,
        dryRun,
        idempotencyKey: `${kind}:${payment.id}`,
        payload: { amount: payload.receipt.amount, dryRun },
      });
    }
  }

  if (!dryRun && typeof markDelivered === 'function') {
    await markDelivered({
      paymentId: payment.id,
      status: payload.email ? 'sent' : 'messaged_only',
    });
  }

  return {
    emailed: Boolean(payload.email) && !dryRun,
    messaged,
    dryRun,
    reason: dryRun ? 'dry_run' : 'ok',
    receipt: payload.receipt,
  };
}
