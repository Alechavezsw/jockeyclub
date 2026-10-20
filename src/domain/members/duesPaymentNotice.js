import { MAILBOX, createMessage } from '../messaging/messages';
import { MERCADO_PAGO } from './clubBanks';

export function duesPaymentNotice({
  memberName,
  memberId,
  amountLabel,
  dueLabel,
  method,
  bankName,
  qrRef,
  attachment,
} = {}) {
  const who = String(memberName || 'Socio').trim();
  const cred = memberId ? `Nº ${memberId}` : '';
  const when = dueLabel ? `Vencimiento: ${dueLabel}` : '';
  const money = amountLabel ? `Importe: ${amountLabel}` : '';

  let subject = 'Aviso de cuota';
  let lines = [`${who}${cred ? ` (${cred})` : ''} avisó un pago de cuota.`];

  if (method === 'mercadopago') {
    subject = 'Pago por Mercado Pago';
    lines = [
      `${who}${cred ? ` (${cred})` : ''} generó un QR de Mercado Pago para la cuota.`,
      money,
      when,
      `Alias: ${MERCADO_PAGO.alias}`,
      qrRef ? `Referencia: ${qrRef}` : '',
    ];
  } else if (method === 'transferencia') {
    subject = 'Comprobante de transferencia';
    lines = [
      `${who}${cred ? ` (${cred})` : ''} envió el comprobante de una transferencia.`,
      money,
      when,
      bankName ? `Banco: ${bankName}` : '',
      attachment?.name ? `Archivo: ${attachment.name}` : '',
    ];
  } else if (method === 'debito') {
    subject = 'Solicitud de débito automático';
    lines = [
      `${who}${cred ? ` (${cred})` : ''} pide adherirse al débito automático de la cuota.`,
      money,
      when,
    ];
  }

  const msg = createMessage({
    sender: who,
    senderId: memberId || null,
    recipientId: MAILBOX.OPERATIONS,
    subject,
    content: lines.filter(Boolean).join('\n'),
  });
  msg.meta = {
    kind: 'dues_payment',
    method,
    ...(attachment ? { attachment } : {}),
  };
  return msg;
}

/** Boleto del pago online, al buzón del socio. */
export function duesBoletoMessage({ member, boleto, attachment }) {
  const who = String(member?.name || 'Socio').trim();
  const money = boleto?.amount != null ? `Importe: $ ${Number(boleto.amount).toLocaleString('es-AR')}` : '';
  const lines = [
    `Hola ${who}, este es tu boleto para pagar la cuota con Mercado Pago.`,
    money,
    boleto?.period ? `Período: ${boleto.period}` : '',
    boleto?.receiptNumber || boleto?.receipt ? `Boleto: ${boleto.receiptNumber || boleto.receipt}` : '',
    'También lo podés descargar en Cuotas, dentro de la app.',
  ];

  const msg = createMessage({
    sender: 'Administración',
    senderId: MAILBOX.OPERATIONS,
    recipientId: member?.memberId,
    subject: 'Boleto de pago de cuota',
    content: lines.filter(Boolean).join('\n'),
  });
  msg.meta = {
    kind: 'dues_boleto',
    method: 'mercadopago',
    ...(attachment ? { attachment } : {}),
  };
  return msg;
}

function moneyLine(label, value) {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return `${label}: ${value}`;
  return `${label}: $ ${n.toLocaleString('es-AR')}`;
}

/** Recibo de cuota cobrada por administración, al buzón del socio. */
export function duesReceiptMessage({ member, payment, attachment }) {
  const who = String(member?.name || 'Socio').trim();
  const quota = Number(payment?.quota);
  const surcharge = Number(payment?.surcharge);
  const total = payment?.amount != null ? payment.amount : (Number.isFinite(quota) ? quota + (Number.isFinite(surcharge) ? surcharge : 0) : null);
  const lines = [
    `Hola ${who}, registramos tu pago de ${payment?.concept || 'cuota social'}.`,
    Number.isFinite(quota) && quota > 0 ? moneyLine('Cuota', quota) : '',
    Number.isFinite(surcharge) && surcharge > 0 ? moneyLine('Interés', surcharge) : '',
    total != null ? moneyLine('Total', total) : '',
    payment?.date ? `Fecha: ${payment.date}` : '',
    payment?.receiptNumber || payment?.receipt ? `Comprobante: ${payment.receiptNumber || payment.receipt}` : '',
  ];

  const msg = createMessage({
    sender: 'Administración',
    senderId: MAILBOX.OPERATIONS,
    recipientId: member?.memberId,
    subject: 'Recibo de pago de cuota',
    content: lines.filter(Boolean).join('\n'),
  });
  msg.meta = {
    kind: 'dues_receipt',
    ...(attachment ? { attachment } : {}),
  };
  return msg;
}

/** Aviso al socio cuando el débito de Mercado Pago no se acreditó. */
export function duesDebitFailedMessage({ member, date, amount }) {
  const who = String(member?.name || 'Socio').trim();
  const money = amount != null ? moneyLine('Importe', amount) : '';
  const lines = [
    `Hola ${who}, no pasó el débito automático de tu cuota.`,
    money,
    date ? `Intento: ${date}` : '',
    'Entrá a Mi cuenta para regularizarlo: https://www.jockeyclubsj.com.ar/cuenta',
  ];
  const msg = createMessage({
    sender: 'Administración',
    senderId: MAILBOX.OPERATIONS,
    recipientId: member?.memberId,
    subject: 'No pasó el débito de tu cuota',
    content: lines.filter(Boolean).join('\n'),
  });
  msg.meta = { kind: 'dues_debit_failed' };
  return msg;
}

/** Mismo aviso a administración, para el pago de un turno. */
export function bookingPaymentNotice({
  memberName,
  memberId,
  amountLabel,
  facilityName,
  dateLabel,
  time,
  method,
  bankName,
  qrRef,
  attachment,
} = {}) {
  const who = String(memberName || 'Socio').trim();
  const cred = memberId ? `Nº ${memberId}` : '';
  const place = [facilityName, dateLabel, time ? `${time} hs` : ''].filter(Boolean).join(' · ');
  const money = amountLabel ? `Importe: ${amountLabel}` : '';
  const head = `${who}${cred ? ` (${cred})` : ''}`;

  let subject = 'Pago de reserva';
  let lines = [`${head} avisó el pago de una reserva.`, place, money];

  if (method === 'mercadopago') {
    subject = 'Pago de reserva por Mercado Pago';
    lines = [
      `${head} generó un QR de Mercado Pago para una reserva.`,
      place,
      money,
      `Alias: ${MERCADO_PAGO.alias}`,
      qrRef ? `Referencia: ${qrRef}` : '',
    ];
  } else if (method === 'transferencia') {
    subject = 'Comprobante de reserva';
    lines = [
      `${head} envió el comprobante de una reserva.`,
      place,
      money,
      bankName ? `Banco: ${bankName}` : '',
      attachment?.name ? `Archivo: ${attachment.name}` : '',
    ];
  } else if (method === 'debito') {
    subject = 'Reserva con débito automático';
    lines = [
      `${head} pide pagar una reserva con débito automático.`,
      place,
      money,
    ];
  }

  const msg = createMessage({
    sender: who,
    senderId: memberId || null,
    recipientId: MAILBOX.OPERATIONS,
    subject,
    content: lines.filter(Boolean).join('\n'),
  });
  msg.meta = {
    kind: 'booking_payment',
    method,
    ...(attachment ? { attachment } : {}),
  };
  return msg;
}
