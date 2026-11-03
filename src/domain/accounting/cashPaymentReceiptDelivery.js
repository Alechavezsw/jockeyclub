/** Envío del comprobante de un movimiento de caja (MD + mail Resend). */

import { createMessage, MAILBOX } from '../messaging/messages';
import { fileToBase64 } from '../members/duesReceiptDelivery';
import { paymentReceiptDeliverableEmail } from '../members/paymentReceiptEmail';
import { mpReceiptMoney } from '../members/mpPaymentReceipt';
import { uploadDuesReceipt } from '../../data/storage';
import { sendPaymentReceiptEmail } from '../../data/repos';
import { cashPaymentPdfFile } from './exportCashPaymentPdf';

export function cashPaymentReceiptMessage({ detail, attachment } = {}) {
  if (!detail?.memberNumber) return null;
  const who = String(detail.memberName || 'Socio').trim();
  const total = mpReceiptMoney(detail.paymentTotal);
  const receipt = detail.paymentNumber || detail.accessinId || '';
  const lines = [
    `Hola ${who}, registramos tu pago.`,
    detail.description ? `Descripción: ${detail.description}` : '',
    `Total: ${total}`,
    detail.dateLabel ? `Fecha: ${detail.dateLabel}` : '',
    receipt ? `Comprobante: ${receipt}` : '',
  ];
  const msg = createMessage({
    sender: 'Administración',
    senderId: MAILBOX.OPERATIONS,
    recipientId: String(detail.memberNumber),
    subject: 'Comprobante de pago',
    content: lines.filter(Boolean).join('\n'),
  });
  msg.meta = {
    kind: 'dues_receipt',
    ...(attachment ? { attachment } : {}),
    paymentNumber: receipt || null,
  };
  return msg;
}

/**
 * Manda el PDF del pago de caja por mensajería y por mail.
 * Best-effort: no tira si falla Resend o el buzón.
 */
export async function sendCashPaymentReceipt({ detail, onSendMessage } = {}) {
  if (!detail?.memberNumber) return { emailed: false, messaged: false, reason: 'sin-socio' };
  const email = paymentReceiptDeliverableEmail(detail.email);
  const canMessage = typeof onSendMessage === 'function';
  if (!email && !canMessage) return { emailed: false, messaged: false, reason: 'sin-contacto' };

  try {
    const file = await cashPaymentPdfFile(detail);
    let attachment;
    try {
      attachment = await uploadDuesReceipt(file, detail.memberNumber);
    } catch {
      attachment = undefined;
    }

    let messaged = false;
    if (canMessage) {
      const msg = cashPaymentReceiptMessage({ detail, attachment });
      if (msg) {
        try {
          await onSendMessage(msg);
          messaged = true;
        } catch {
          /* best-effort */
        }
      }
    }

    let emailed = false;
    if (email) {
      const methodLabel = detail.paymentMethods?.[0]?.label || detail.typeLabel || 'Caja';
      const pdfBase64 = await fileToBase64(file);
      await sendPaymentReceiptEmail({
        memberNumber: detail.memberNumber,
        amountLabel: mpReceiptMoney(detail.paymentTotal),
        receiptNo: String(detail.paymentNumber || detail.accessinId || ''),
        concept: detail.description || 'Pago',
        methodLabel,
        dateLabel: detail.dateLabel || '',
        periodLabel: '',
        pdfBase64,
        fileName: file.name,
      });
      emailed = true;
    }

    return { emailed, messaged, to: email || null };
  } catch (err) {
    return {
      emailed: false,
      messaged: false,
      reason: err?.message || 'No se pudo enviar el comprobante.',
    };
  }
}
