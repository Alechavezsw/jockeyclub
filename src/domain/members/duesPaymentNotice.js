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

/** Recibo de cuota cobrada por administración, al buzón del socio. */
export function duesReceiptMessage({ member, payment, attachment }) {
  const who = String(member?.name || 'Socio').trim();
  const money = payment?.amount != null ? `Importe: $ ${Number(payment.amount).toLocaleString('es-AR')}` : '';
  const lines = [
    `Hola ${who}, registramos tu pago de ${payment?.concept || 'cuota social'}.`,
    money,
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
