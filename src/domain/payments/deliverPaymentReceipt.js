/**
 * Regla absoluta: comprobante automático (MD + mail) cuando un cobro de socio queda acreditado.
 * Ver `.cursor/rules/comprobante-automatico.mdc`.
 */

import { isDuesExemptMember } from '../members/dues';
import { sendDuesReceiptMessage } from '../members/duesReceiptDelivery';
import { sendCashPaymentReceipt } from '../accounting/cashPaymentReceiptDelivery';

/**
 * @param {object} args
 * @param {object} [args.member] Socio destinatario
 * @param {object} [args.payment] Pago de cuota / genérico ({ amount, date, method, receiptNumber, concept, period })
 * @param {object} [args.cashDetail] Detalle de caja (buildCashPaymentDetail)
 * @param {function} [args.onSendMessage] Mensajería interna
 * @param {'cuota'|'reserva'|'porteria'|'pileta'|'colonia'|'otro'|string} [args.kind]
 * @param {object} [args.colonia] Contexto Colonia ({ student, guardian, season, dryRun })
 */
export async function deliverPaymentReceipt({
  member,
  payment,
  cashDetail,
  onSendMessage,
  kind = 'otro',
  colonia = null,
} = {}) {
  // Cuota: exentos nunca reciben comprobante de cuota.
  if (kind === 'cuota' && member && isDuesExemptMember(member)) {
    return { emailed: false, messaged: false, reason: 'dues-exempt' };
  }

  if (kind === 'colonia' || colonia) {
    const { deliverColoniaPaymentReceipt } = await import('../colonia/coloniaReceipts.js');
    return deliverColoniaPaymentReceipt({
      payment,
      student: colonia?.student,
      guardian: colonia?.guardian || member,
      season: colonia?.season,
      chargeConcepts: colonia?.chargeConcepts,
      onSendMessage,
      enqueueNotification: colonia?.enqueueNotification,
      markDelivered: colonia?.markDelivered,
      dryRun: colonia?.dryRun !== false,
    });
  }

  if (cashDetail?.memberNumber) {
    return sendCashPaymentReceipt({ detail: cashDetail, onSendMessage });
  }

  if (member?.memberId && payment) {
    const result = await sendDuesReceiptMessage({ member, payment, onSendMessage });
    return { emailed: Boolean(result?.emailed), messaged: Boolean(result?.messaged), kind };
  }

  return { emailed: false, messaged: false, reason: 'sin-destino' };
}

/** Medios / orígenes que disparan comprobante automático. */
export const PAYMENT_RECEIPT_TRIGGERS = Object.freeze([
  'debito_automatico',
  'app_socio',
  'efectivo',
  'a_cuenta',
  'mercadopago',
  'tarjeta',
  'transferencia',
  'mixto',
  'reserva',
  'cuota',
  'porteria',
  'pileta',
  'colonia',
  'otro_ingreso',
]);
