import { paymentReceiptPdfFile } from './exportPaymentReceiptPdf';
import { duesReceiptMessage } from './duesPaymentNotice';
import { uploadDuesReceipt } from '../../data/storage';

/**
 * Genera el recibo del cobro y lo manda por Mensajería al socio.
 * Best-effort: si falla (sin Supabase, sin red), no interrumpe el cobro ya registrado.
 */
export async function sendDuesReceiptMessage({ member, payment, onSendMessage }) {
  if (typeof onSendMessage !== 'function' || !member?.memberId || !payment) return;
  try {
    const file = await paymentReceiptPdfFile({ member, payment });
    let attachment;
    try {
      attachment = await uploadDuesReceipt(file, member.memberId);
    } catch {
      attachment = undefined;
    }
    const msg = duesReceiptMessage({ member, payment, attachment });
    await onSendMessage(msg);
  } catch {
    /* best-effort */
  }
}
