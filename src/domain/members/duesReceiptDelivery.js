import { paymentBoletoPdfFile, paymentReceiptPdfFile } from './exportPaymentReceiptPdf';
import { duesBoletoMessage, duesReceiptMessage } from './duesPaymentNotice';
import { paymentReceiptDeliverableEmail } from './paymentReceiptEmail';
import { uploadDuesReceipt } from '../../data/storage';
import { sendPaymentReceiptEmail } from '../../data/repos';
import { mpReceiptMoney } from './mpPaymentReceipt';
import { formatAccessinCashDate } from '../accounting/cashLedger';

export function buildOnlineDuesBoleto({ member, amount, dueLabel } = {}) {
  const date = new Date().toISOString().slice(0, 10);
  const receipt = `BOL-${String(member?.memberId || '').replace(/\W/g, '').slice(-6) || 'SOCIO'}-${date.replace(/-/g, '')}`;
  return {
    id: `boleto-${member?.memberId || 'socio'}-${date}`,
    date,
    concept: 'Cuota social · Mercado Pago',
    amount: Number(amount) || 0,
    method: 'mercadopago',
    status: 'issued',
    receipt,
    receiptNumber: receipt,
    period: dueLabel || '',
  };
}

export async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) {
    binary += String.fromCharCode(...bytes.subarray(i, i + size));
  }
  return btoa(binary);
}

/**
 * Arma el boleto de Mercado Pago, lo manda por mensajería al socio
 * y devuelve el PDF para el mail y para descargarlo en Cuotas.
 */
export async function prepareOnlineDuesBoleto({ member, amount, dueLabel, profileId }) {
  const boleto = buildOnlineDuesBoleto({ member, amount, dueLabel });
  const file = await paymentBoletoPdfFile({ member, boleto });
  let attachment;
  try {
    attachment = await uploadDuesReceipt(file, profileId || member?.memberId);
  } catch {
    attachment = undefined;
  }
  return {
    boleto,
    file,
    message: duesBoletoMessage({ member, boleto, attachment }),
  };
}

/**
 * Genera el recibo del cobro, lo manda por Mensajería y por mail (Resend).
 * Misma regla que Mercado Pago. Best-effort: no interrumpe el cobro ya registrado.
 */
export async function sendDuesReceiptMessage({ member, payment, onSendMessage }) {
  if (!member?.memberId || !payment) return;
  try {
    const file = await paymentReceiptPdfFile({ member, payment });
    let attachment;
    try {
      attachment = await uploadDuesReceipt(file, member.memberId);
    } catch {
      attachment = undefined;
    }
    if (typeof onSendMessage === 'function') {
      try {
        await onSendMessage(duesReceiptMessage({ member, payment, attachment }));
      } catch {
        /* best-effort MD */
      }
    }
    const email = paymentReceiptDeliverableEmail(member.email)
      || paymentReceiptDeliverableEmail(member.contactEmail);
    if (!email) return;
    const pdfBase64 = await fileToBase64(file);
    await sendPaymentReceiptEmail({
      memberNumber: member.memberId,
      amountLabel: mpReceiptMoney(payment.amount),
      receiptNo: payment.receiptNumber || payment.receipt || '',
      concept: payment.concept || 'Cuota social',
      methodLabel: payment.methodLabel || payment.method || 'Caja',
      dateLabel: payment.date ? formatAccessinCashDate(payment.date) : '',
      periodLabel: payment.period || payment.periodLabel || '',
      pdfBase64,
      fileName: file.name,
    });
  } catch {
    /* best-effort */
  }
}
