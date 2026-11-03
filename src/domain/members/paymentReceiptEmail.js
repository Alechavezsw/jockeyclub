/** Texto/HTML del comprobante de pago por mail (misma línea que Mercado Pago). */

import { portalAccountUrl } from './selfService';
import { mpReceiptDeliverableEmail, mpReceiptMoney } from './mpPaymentReceipt';

export const PORTAL_ACCOUNT = portalAccountUrl();

export { mpReceiptDeliverableEmail as paymentReceiptDeliverableEmail };

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function row(label, value) {
  if (!value) return '';
  return `<tr>
    <td style="padding:7px 0;font-size:13px;color:#6a6156;width:42%;">${escapeHtml(label)}</td>
    <td style="padding:7px 0;font-size:14px;color:#1a1612;">${escapeHtml(value)}</td>
  </tr>`;
}

/**
 * Cuerpo del mail de comprobante (cuota en caja, efectivo, transferencia, etc.).
 * Misma plantilla institucional que el recibo de Mercado Pago.
 */
export function paymentReceiptEmailCopy({
  name,
  memberNumber,
  amount,
  receiptNumber,
  methodLabel,
  date,
  concept,
  period,
} = {}) {
  const who = String(name || 'socio').trim() || 'socio';
  const money = mpReceiptMoney(amount);
  const receipt = String(receiptNumber || '').trim() || '—';
  const conceptLabel = String(concept || 'Pago').trim();
  const method = String(methodLabel || 'Caja').trim() || 'Caja';
  const number = String(memberNumber || '').trim();
  const subject = 'Comprobante de pago · Jockey Club San Juan';
  const greeting = `Hola ${who},`;
  const lead = `Registramos tu pago de ${conceptLabel}.`;
  const lines = [
    greeting,
    '',
    lead,
    '',
    `Comprobante: ${receipt}`,
    `Importe: ${money}`,
    `Medio: ${method}`,
    date ? `Fecha: ${date}` : '',
    period ? `Período: ${period}` : '',
    number ? `Socio Nº ${number}` : '',
    '',
    'Quedó asentado en tu cuenta. Conservá este comprobante.',
    PORTAL_ACCOUNT,
  ].filter((line, i, all) => line !== '' || all[i - 1] !== '');

  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#efe6d4;font-family:Georgia,'Times New Roman',serif;color:#1a1612;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efe6d4;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fffdf8;border:1px solid #d8c7a4;">
        <tr>
          <td style="background:#096755;padding:28px 28px 22px;text-align:center;color:#fffdf8;">
            <p style="margin:0;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#d7c48a;">Comprobante de pago</p>
            <h1 style="margin:10px 0 0;font-size:26px;font-weight:normal;">Jockey Club San Juan</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:28px;">
            <p style="margin:0 0 12px;font-size:18px;">${escapeHtml(greeting)}</p>
            <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#3f3830;">${escapeHtml(lead)}</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eadcc0;border-bottom:1px solid #eadcc0;margin:0 0 22px;">
              ${row('Comprobante', receipt)}
              ${row('Importe', money)}
              ${row('Concepto', conceptLabel)}
              ${row('Medio', method)}
              ${row('Fecha', date)}
              ${row('Período', period)}
              ${row('Socio', number ? `Nº ${number}` : '')}
            </table>
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr><td style="background:#ca390c;border-radius:999px;">
                <a href="${PORTAL_ACCOUNT}" style="display:inline-block;padding:12px 22px;color:#fffdf8;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;">Ver Mi cuenta</a>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 28px 26px;border-top:1px solid #eadcc0;font-size:12px;color:#6a6156;">
            Jockey Club San Juan · República del Líbano 1799 Oeste, Rivadavia
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return {
    subject,
    text,
    html,
    kind: 'dues_receipt',
    receiptNumber: receipt,
    money,
  };
}
