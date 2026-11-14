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
    subject = 'Operación Mercado Pago · cuota';
    lines = [
      `${who}${cred ? ` (${cred})` : ''} inició un pago de cuota por Mercado Pago desde la app.`,
      money,
      when,
      `Alias: ${MERCADO_PAGO.alias}`,
      qrRef ? `Referencia: ${qrRef}` : '',
      'Mercado Pago acredita solo: no hace falta imputar a mano. La operación queda en Pagos entrantes.',
    ];
  } else if (method === 'transferencia') {
    subject = 'Solicitud de pago · transferencia';
    lines = [
      `${who}${cred ? ` (${cred})` : ''} envió el comprobante de una transferencia desde la app.`,
      money,
      when,
      bankName ? `Banco: ${bankName}` : '',
      attachment?.name ? `Archivo: ${attachment.name}` : '',
      'Es una solicitud de pago: acreditá en Socios con app o en Cobrar cuando veas el movimiento en el banco.',
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
    paymentRequest: method === 'transferencia' || method === 'debito' || method === 'tarjeta',
    paymentAuto: method === 'mercadopago',
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
  const isBooking = payment?.kind === 'reserva' || payment?.bookingScope === 'deposit' || payment?.bookingScope === 'total';
  const quota = Number(payment?.quota);
  const surcharge = Number(payment?.surcharge);
  const total = payment?.amount != null ? payment.amount : (Number.isFinite(quota) ? quota + (Number.isFinite(surcharge) ? surcharge : 0) : null);
  const balance = Number(payment?.balanceRemaining);
  const credit = Number(payment?.creditLeftover);
  const creditApplied = Number(payment?.creditApplied);
  const onAccount = String(payment?.method || '').toLowerCase() === 'a_cuenta'
    || /a\s*cuenta/i.test(String(payment?.methodLabel || payment?.concept || ''));
  const lines = [
    `Hola ${who}, registramos tu pago de ${payment?.concept || (isBooking ? 'reserva' : (onAccount ? 'pago a cuenta' : 'cuota social'))}.`,
    payment?.facilityName ? `Espacio: ${payment.facilityName}` : '',
    payment?.period && isBooking ? `Evento: ${payment.period}` : '',
    Number.isFinite(quota) && quota > 0 && !onAccount ? moneyLine('Cuota', quota) : '',
    Number.isFinite(surcharge) && surcharge > 0 && !onAccount ? moneyLine('Interés', surcharge) : '',
    Number.isFinite(creditApplied) && creditApplied > 0.01
      ? moneyLine('Saldo a favor imputado', creditApplied)
      : '',
    Number(payment?.discount) > 0.009
      ? `${moneyLine('Descuento', payment.discount)}${payment.discountDetail ? ` · ${String(payment.discountDetail).trim()}` : ''}`
      : '',
    total != null ? moneyLine(onAccount ? 'Entregado' : (isBooking ? 'Abonado' : 'Total'), total) : '',
    isBooking && Number.isFinite(Number(payment?.totalPrice))
      ? moneyLine('Precio total alquiler', payment.totalPrice)
      : '',
    (isBooking || onAccount) && Number.isFinite(balance)
      ? (balance > 0
        ? moneyLine(onAccount ? 'Deuda restante' : 'Saldo pendiente', balance)
        : (onAccount ? 'Deuda restante: $ 0 (saldada)' : 'Saldo pendiente: $ 0 (saldado)'))
      : '',
    Number.isFinite(credit) && credit > 0.01
      ? moneyLine('Saldo a favor', credit)
      : '',
    payment?.date ? `Fecha: ${payment.date}` : '',
    payment?.receiptNumber || payment?.receipt ? `Comprobante: ${payment.receiptNumber || payment.receipt}` : '',
    'También lo ves en Mi cuenta: https://www.jockeyclubsj.com.ar/cuenta',
  ];

  const msg = createMessage({
    sender: 'Administración',
    senderId: MAILBOX.OPERATIONS,
    recipientId: member?.memberId,
    subject: isBooking
      ? (payment?.bookingScope === 'deposit' || (Number.isFinite(balance) && balance > 0)
        ? 'Comprobante de seña de reserva'
        : 'Comprobante de alquiler')
      : (onAccount ? 'Comprobante de pago a cuenta' : 'Recibo de pago de cuota'),
    content: lines.filter(Boolean).join('\n'),
  });
  msg.meta = {
    kind: isBooking ? 'booking_receipt' : 'dues_receipt',
    ...(attachment ? { attachment } : {}),
  };
  return msg;
}

/** Aviso al socio: el comprobante de cuota quedó anulado. */
export function duesVoidedReceiptMessage({ member, payment, reason } = {}) {
  const who = String(member?.name || 'Socio').trim();
  const receipt = payment?.receiptNumber || payment?.receipt || '';
  const lines = [
    `Hola ${who}, anulamos el comprobante de cuota${receipt ? ` ${receipt}` : ''}.`,
    moneyLine('Importe anulado', payment?.amount),
    payment?.concept ? `Concepto: ${payment.concept}` : '',
    reason ? `Motivo: ${String(reason).trim()}` : '',
    'El saldo y el vencimiento volvieron a como estaban antes de ese cobro.',
    'Mi cuenta: https://www.jockeyclubsj.com.ar/cuenta',
  ];
  const msg = createMessage({
    sender: 'Administración',
    senderId: MAILBOX.OPERATIONS,
    recipientId: member?.memberId,
    subject: 'Comprobante de cuota anulado',
    content: lines.filter(Boolean).join('\n'),
  });
  msg.meta = {
    kind: 'dues_receipt_void',
    paymentId: payment?.id || null,
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
    subject = 'Operación Mercado Pago · reserva';
    lines = [
      `${head} inició un pago de reserva por Mercado Pago desde la app.`,
      place,
      money,
      `Alias: ${MERCADO_PAGO.alias}`,
      qrRef ? `Referencia: ${qrRef}` : '',
      'Mercado Pago acredita solo: la operación queda en Pagos entrantes.',
    ];
  } else if (method === 'transferencia') {
    subject = 'Solicitud de pago · reserva';
    lines = [
      `${head} envió el comprobante de una reserva desde la app.`,
      place,
      money,
      bankName ? `Banco: ${bankName}` : '',
      attachment?.name ? `Archivo: ${attachment.name}` : '',
      'Es una solicitud de pago: acreditá cuando veas el movimiento en el banco.',
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
    paymentRequest: method === 'transferencia' || method === 'debito' || method === 'tarjeta',
    paymentAuto: method === 'mercadopago',
    ...(attachment ? { attachment } : {}),
  };
  return msg;
}
