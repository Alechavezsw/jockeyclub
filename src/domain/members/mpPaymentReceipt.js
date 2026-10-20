/** Comprobante automático cuando Mercado Pago acredita la cuota. */

import { portalAccountUrl } from './selfService';

export const PORTAL_ACCOUNT = portalAccountUrl();

export function shouldIssueMpDuesReceipt(kind) {
  const next = String(kind || '').toLowerCase();
  return next === 'dues' || next === 'subscription';
}

export function mpReceiptChannelOf(meta = {}) {
  if (meta?.from_subscription || meta?.channel === 'subscription') return 'subscription';
  if (meta?.channel === 'onsite') return 'onsite';
  return 'online';
}

export function mpReceiptChannelLabel(channel) {
  if (channel === 'onsite') return 'QR en el club';
  if (channel === 'subscription') return 'débito mensual';
  return 'pago en Mi cuenta';
}

export function mpReceiptMoney(amount) {
  const n = Number(amount);
  const safe = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(safe);
}

export function mpReceiptDeliverableEmail(value) {
  const email = String(value || '').trim();
  if (!email.includes('@')) return '';
  const lower = email.toLowerCase();
  if (lower.includes('@lila-jockey')) return '';
  if (lower.endsWith('@jockeyclubsj.com')) return '';
  return email;
}

export function mpReceiptCopy({
  name,
  memberNumber,
  amount,
  receiptNumber,
  channel,
  date,
  concept,
  period,
} = {}) {
  const who = String(name || 'socio').trim() || 'socio';
  const via = mpReceiptChannelLabel(channel);
  const money = mpReceiptMoney(amount);
  const receipt = String(receiptNumber || '').trim() || '—';
  const conceptLabel = String(concept || 'Cuota social').trim();
  const number = String(memberNumber || '').trim();
  const subject = 'Comprobante de pago · Jockey Club San Juan';
  const greeting = `Hola ${who},`;
  const lead = `Acreditamos tu pago de ${conceptLabel} por Mercado Pago (${via}).`;
  const lines = [
    greeting,
    '',
    lead,
    '',
    `Comprobante: ${receipt}`,
    `Importe: ${money}`,
    date ? `Fecha: ${date}` : '',
    period ? `Período: ${period}` : '',
    number ? `Socio Nº ${number}` : '',
    '',
    'Quedó asentado en tu cuenta. Conservá este comprobante.',
    PORTAL_ACCOUNT,
  ].filter((line, i, all) => line !== '' || all[i - 1] !== '');

  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const html = mpReceiptHtml({
    subject,
    greeting,
    lead,
    receipt,
    money,
    date,
    period,
    number,
    concept: conceptLabel,
    via,
  });

  return {
    subject,
    greeting,
    lead,
    text,
    html,
    kind: 'dues_receipt',
    receiptNumber: receipt,
  };
}

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

function mpReceiptHtml({
  subject,
  greeting,
  lead,
  receipt,
  money,
  date,
  period,
  number,
  concept,
  via,
}) {
  return `<!DOCTYPE html>
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
              ${row('Concepto', concept)}
              ${row('Medio', `Mercado Pago · ${via}`)}
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
}
