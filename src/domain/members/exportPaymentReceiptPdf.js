import { loadAutoTable, loadJsPdf } from '../../lib/office.js';
import {
  BRAND,
  drawLabelPastilla,
  drawReportFooter,
  drawReportHeader,
  loadClubLogoDataUrl,
} from '../reports/pdfBrand';
import { CLUB_BANK_ACCOUNTS, MERCADO_PAGO } from './clubBanks';
import { paymentIsTennisAbonoOnly } from './dues';
import { getTierDisplayName } from './tiers';
import { duesMonthLabel, duesMonthsPhrase } from './duesImputations';

function formatCurrency(amount) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(Number(amount) || 0);
}

function formatLongDateAr(iso) {
  const d = new Date(`${String(iso || '').slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso || '—';
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
}

function formatShortDateAr(iso) {
  const raw = String(iso || '').slice(0, 10);
  const m = raw.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[1]}` : raw || '—';
}

function periodLabelFromDueOn(dueOn) {
  return duesMonthLabel(dueOn) || String(dueOn || '').slice(0, 7);
}

/** Período cubierto por el cobro (meses marcados o texto guardado). */
export function paymentPeriodLabel(payment) {
  const stored = String(payment?.period || '').trim();
  if (stored) return stored;
  const dueOns = Array.isArray(payment?.periodDueOns) ? payment.periodDueOns.filter(Boolean) : [];
  return duesMonthsPhrase(dueOns) || '—';
}

/** Categoría visible en el recibo (Socio / Grupo familiar, etc.). */
export function receiptCategoryLabel(member) {
  const fromCatalog = getTierDisplayName(member?.tier);
  if (fromCatalog && fromCatalog !== '—') return String(fromCatalog).toUpperCase();
  const categories = Array.isArray(member?.cuotaCategories)
    ? member.cuotaCategories.map((c) => String(c || '').trim()).filter(Boolean)
    : [];
  if (categories.length) return categories[0].toUpperCase();
  return '—';
}

function isOpeningDue(dueOn) {
  return String(dueOn || '').slice(0, 10) <= '1900-01-10';
}

function chargeLineFromImputation(row) {
  const dueOn = String(row?.dueOn || '').slice(0, 10);
  const period = periodLabelFromDueOn(dueOn);
  const capital = Number(row?.capital) || 0;
  const surcharge = Number(row?.surcharge) || 0;
  const detail = surcharge > 0.01
    ? `${period} · capital ${formatCurrency(capital)} · intereses ${formatCurrency(surcharge)}`
    : `${period} · sin intereses`;
  return {
    dueOn,
    detail,
    payable: capital + surcharge,
  };
}

/** Una línea por mes: capital e intereses, o el mes sin intereses. Sin saldo anterior. */
export function receiptChargeLines(payment) {
  const tennis = paymentIsTennisAbonoOnly(payment);
  const imputations = Array.isArray(payment?.imputations)
    ? payment.imputations.filter((row) => row && !row.voidedAt && !isOpeningDue(row.dueOn))
    : [];
  const selectedDueOns = Array.isArray(payment?.periodDueOns)
    ? payment.periodDueOns.map((value) => String(value || '').slice(0, 10)).filter(Boolean)
    : [];
  // Un solo mes marcado: una línea con el total (el adelanto no abre otra fila).
  if (selectedDueOns.length === 1) {
    const dueOn = selectedDueOns[0];
    const total = imputations.reduce((sum, row) => (
      sum + (Number(row.capital) || 0) + (Number(row.surcharge) || 0)
    ), 0);
    const cut = Number(payment?.discount) || 0;
    const billed = (Number(payment?.amount) || 0) + (cut > 0.009 ? cut : 0);
    const amount = total > 0.01 ? total : billed;
    if (amount > 0.01) {
      return [{
        dueOn,
        detail: duesPaymentDescription(dueOn, { tennis }),
        payable: amount,
      }];
    }
  }
  // Varios meses marcados: el recibo nombra esos, no un adelanto a diciembre.
  if (selectedDueOns.length > 1) {
    const byDue = new Map(
      imputations.map((row) => [String(row.dueOn || '').slice(0, 10), row]),
    );
    const matched = selectedDueOns
      .map((dueOn) => byDue.get(dueOn))
      .filter(Boolean)
      .map(chargeLineFromImputation)
      .filter((row) => row.payable > 0.01);
    if (matched.length === selectedDueOns.length) return matched;
    if (matched.length) return matched;
  }
  return imputations
    .filter((row) => String(row.kind || '').toLowerCase() !== 'adelanto')
    .map(chargeLineFromImputation)
    .filter((row) => row.payable > 0.01);
}

/** Descripción corta: «Pago de cuota social Noviembre 2026» o «Pago de abono tenis …». */
export function duesPaymentDescription(dueOnOrLabel, { tennis = false } = {}) {
  const noun = tennis ? 'abono tenis' : 'cuota social';
  const raw = String(dueOnOrLabel || '').trim();
  const fromDue = /^\d{4}-\d{2}-\d{2}/.test(raw) ? periodLabelFromDueOn(raw) : '';
  const label = fromDue || raw;
  if (!label || label === '—') return `Pago de ${noun}`;
  if (new RegExp(`^pago de ${noun}`, 'i').test(label)) {
    return label.replace(/\s+de\s+(\d{4})\b/i, ' $1');
  }
  const month = label
    .replace(/^abono tenis\s*[·•|-]?\s*/i, '')
    .replace(/^cuota social\s*[·•|-]?\s*/i, '')
    .replace(/^pago de\s+/i, '')
    .replace(/\s+de\s+(\d{4})\b/i, ' $1')
    .trim();
  return month ? `Pago de ${noun} ${month}` : `Pago de ${noun}`;
}

/** Línea de descuento del recibo. El mes y el recargo quedan como se cobraron. */
export function receiptDiscountLine(payment) {
  const discount = Number(payment?.discount) || 0;
  if (!(discount > 0.009)) return null;
  const detail = String(payment?.discountDetail || '').replace(/\s+/g, ' ').trim();
  return {
    detail: detail ? `Descuento · ${detail}` : 'Descuento',
    amount: discount,
  };
}

/**
 * A qué corresponde el cobro: meses imputados / período / concepto limpio.
 * Sin mezclar el medio de pago (eso va en TIPO).
 */
export function paymentCorrespondsTo(payment, { isBooking = false } = {}) {
  if (isBooking) {
    const space = String(payment?.facilityName || '').trim();
    const scope = payment?.bookingScope === 'deposit'
      ? 'Seña 50 % de alquiler'
      : payment?.bookingScope === 'total'
        ? 'Alquiler saldado'
        : 'Alquiler';
    return [scope, space, paymentPeriodLabel(payment)].filter((p) => p && p !== '—').join(' · ') || 'Reserva';
  }

  const onAccount = isOnAccountPayment(payment);
  const tennis = paymentIsTennisAbonoOnly(payment);
  const selectedDueOns = Array.isArray(payment?.periodDueOns)
    ? payment.periodDueOns.map((value) => String(value || '').slice(0, 10)).filter(Boolean)
    : [];
  const toAccountLabel = (text) => String(text || '').replace(/^Pago de (cuota social|abono tenis)/i, 'Pago a cuenta');
  // Meses marcados en el cobro: el recibo nombra esos, no un adelanto a diciembre.
  if (selectedDueOns.length === 1) {
    const one = duesPaymentDescription(selectedDueOns[0], { tennis });
    return onAccount ? toAccountLabel(one) : one;
  }
  if (selectedDueOns.length > 1) {
    const phrase = duesMonthsPhrase(selectedDueOns);
    if (phrase) {
      return onAccount
        ? `Pago a cuenta · ${phrase}`
        : `Pago de ${tennis ? 'abono tenis' : 'cuota social'} · ${phrase}`;
    }
  }

  const imputations = Array.isArray(payment?.imputations)
    ? payment.imputations.filter((row) => row && !row.voidedAt)
    : [];
  const charges = receiptChargeLines(payment);
  const monthCharges = charges.filter((row) => String(row.dueOn || '').slice(0, 10) > '1900-01-10');
  if (monthCharges.length === 1 && !(Number(imputations.find((row) => !isOpeningDue(row.dueOn))?.surcharge) > 0.01)) {
    const one = duesPaymentDescription(monthCharges[0].dueOn, { tennis });
    return onAccount ? toAccountLabel(one) : one;
  }
  if (charges.length) {
    const detail = charges.map((row) => row.detail).join(' · ');
    return onAccount ? `Pago a cuenta · ${detail}` : detail;
  }

  const period = paymentPeriodLabel(payment);
  const raw = String(payment?.concept || '').trim();
  const cleaned = raw
    .replace(/\s*[·•|-]\s*(Transferencia|Efectivo|Tarjeta|Mercado Pago|Caja|Débito|A cuenta|Comp:|saldo a favor)[^·•|-]*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (/^a cuenta/i.test(cleaned) || /^pago a cuenta/i.test(cleaned)) {
    const due = selectedDueOns[0] || (Array.isArray(payment?.imputations) ? payment.imputations.find((row) => !isOpeningDue(row?.dueOn))?.dueOn : null);
    if (due) return toAccountLabel(duesPaymentDescription(due, { tennis }));
    if (period && period !== '—') {
      return toAccountLabel(duesPaymentDescription(period, { tennis }));
    }
    return 'Pago a cuenta';
  }
  if (
    /^cuota social/i.test(cleaned)
    || /^pago de cuota social/i.test(cleaned)
    || /^abono tenis/i.test(cleaned)
    || /^pago de abono tenis/i.test(cleaned)
  ) {
    const due = selectedDueOns[0] || (Array.isArray(payment?.imputations) ? payment.imputations.find((row) => !isOpeningDue(row?.dueOn))?.dueOn : null);
    if (due) return duesPaymentDescription(due, { tennis });
    if (period && period !== '—') return duesPaymentDescription(period, { tennis });
  }
  if (cleaned && period && period !== '—' && !cleaned.toLowerCase().includes(period.toLowerCase())) {
    return `${cleaned} · ${period}`;
  }
  if (cleaned) return cleaned;
  if (period && period !== '—') return duesPaymentDescription(period, { tennis });
  return onAccount ? 'Pago a cuenta' : `Pago de ${tennis ? 'abono tenis' : 'cuota social'}`;
}

const METHOD = {
  transferencia: 'Transferencia bancaria',
  efectivo: 'Efectivo',
  debito: 'Débito',
  tarjeta: 'Tarjeta',
  caja: 'Caja / Secretaría',
  mercadopago: 'Mercado Pago',
  a_cuenta: 'A cuenta',
};

/** Medio de pago para el recibo (genérico; el banco va en CUENTA). */
export function receiptMethodLabel(payment) {
  const method = String(payment?.method || '').trim().toLowerCase();
  if (method === 'a_cuenta' || /a\s*cuenta/i.test(String(payment?.methodLabel || ''))) {
    return 'A cuenta';
  }
  if (method === 'transferencia' || /transferencia/i.test(String(payment?.methodLabel || ''))) {
    return 'Transferencia bancaria';
  }
  if (METHOD[method]) return METHOD[method];
  const label = String(payment?.methodLabel || '').trim();
  if (label) {
    return label.replace(/^Transferencia\s+.+$/i, 'Transferencia bancaria');
  }
  return method || '—';
}

function isOnAccountPayment(payment) {
  const method = String(payment?.method || '').trim().toLowerCase();
  return method === 'a_cuenta' || /a\s*cuenta/i.test(String(payment?.methodLabel || payment?.concept || ''));
}

/**
 * Destino acreditado (solo alias / caja).
 * Nunca el nombre del banco (“Banco Macro”): eso no es la cuenta del recibo.
 */
export function accountLabel(payment) {
  if (payment?.method === 'mercadopago') {
    return MERCADO_PAGO.alias ? `Alias ${MERCADO_PAGO.alias}` : null;
  }
  if (payment?.method === 'transferencia' || payment?.method === 'debito') {
    const bank = CLUB_BANK_ACCOUNTS.find((b) => b.id === payment.bankId) || CLUB_BANK_ACCOUNTS[0];
    return bank?.alias ? `Alias ${bank.alias}` : null;
  }
  if (
    payment?.method === 'efectivo'
    || payment?.method === 'caja'
    || payment?.method === 'tarjeta'
    || payment?.method === 'a_cuenta'
  ) {
    return 'Caja General';
  }
  return null;
}

/** Arma el PDF del recibo (compartido por descarga y envío por mensajería). */
async function buildPaymentReceiptDoc({ member, payment, kind = 'recibo' }) {
  if (!payment) throw new Error('Pago no encontrado.');
  const isBoleto = kind === 'boleto';
  const docLabel = isBoleto ? 'Boleto de pago' : 'Recibo de pago';
  const [{ jsPDF }, autoTableMod, logoDataUrl] = await Promise.all([
    loadJsPdf(),
    loadAutoTable(),
    loadClubLogoDataUrl(),
  ]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const receiptNo = payment.receiptNumber || payment.receipt || payment.id;
  const category = receiptCategoryLabel(member);
  const isBooking = payment.kind === 'reserva' || payment.bookingScope === 'deposit' || payment.bookingScope === 'total';
  const corresponds = paymentCorrespondsTo(payment, { isBooking });
  const methodText = receiptMethodLabel(payment);

  const startY = drawReportHeader(doc, {
    title: `${docLabel} #${receiptNo}`,
    subtitle: `Socio ${member?.memberId || '—'} · ${member?.name || '—'} · ${category}`,
    metaLine: `Emitido el ${new Date().toLocaleString('es-AR')}`,
    logoDataUrl,
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(30, 30, 30);
  doc.text(`${docLabel.toUpperCase()} #${receiptNo}`, 105, startY + 6, { align: 'center' });
  doc.setDrawColor(...BRAND.green);
  doc.setLineWidth(0.3);
  doc.line(14, startY + 10, 196, startY + 10);

  let y = startY + 14;
  const methodPill = drawLabelPastilla(doc, methodText, {
    x: 14,
    y,
    fill: [255, 255, 255],
    textColor: BRAND.green,
    border: BRAND.green,
  });
  let pillX = 14 + (methodPill.width || 0) + (methodPill.width ? 4 : 0);
  let pillH = methodPill.height || 0;
  if (!isBooking && paymentIsTennisAbonoOnly(payment)) {
    const kindPill = drawLabelPastilla(doc, 'Abono tenis', {
      x: pillX,
      y,
      fill: [255, 255, 255],
      textColor: BRAND.green,
      border: BRAND.green,
    });
    pillH = Math.max(pillH, kindPill.height || 0);
  }
  y += pillH + 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  const balanceRemaining = Number(payment.balanceRemaining);
  const creditLeftover = Number(payment.creditLeftover);
  const creditApplied = Number(payment.creditApplied);
  const onAccount = !isBooking && isOnAccountPayment(payment);
  const totalPrice = Number(payment.totalPrice);
  const infoRows = [
    ['SOCIO', String(member?.name || '—').toUpperCase()],
    ['N° SOCIO', String(member?.memberId || '—')],
    ['CATEGORÍA', category],
    isBooking
      ? ['ESPACIO', String(payment.facilityName || '—').toUpperCase()]
      : ['PERÍODO', String(paymentPeriodLabel(payment)).toUpperCase()],
    ['CORRESPONDE A', String(corresponds).toUpperCase()],
    isBooking
      ? ['EVENTO', String(paymentPeriodLabel(payment)).toUpperCase()]
      : ['FECHA', formatLongDateAr(payment.date)],
    ['FECHA PAGO', formatLongDateAr(payment.date)],
    ['COMPROBANTE', String(receiptNo)],
    ...(onAccount ? [['ENTREGADO', formatCurrency(payment.amount)]] : []),
    ...(Number.isFinite(creditApplied) && creditApplied > 0.01
      ? [['SALDO A FAVOR IMPUTADO', formatCurrency(creditApplied)]]
      : []),
    ...(onAccount && Number.isFinite(balanceRemaining)
      ? [['DEUDA RESTANTE', formatCurrency(Math.max(0, balanceRemaining))]]
      : []),
    ...(Number.isFinite(creditLeftover) && creditLeftover > 0.01
      ? [['SALDO A FAVOR', formatCurrency(creditLeftover)]]
      : []),
  ];
  infoRows.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold');
    doc.text(`${label}:`, 16, y);
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(value, 140);
    doc.text(lines, 58, y);
    y += Math.max(6, lines.length * 5);
  });

  const quota = Number(payment.quota);
  const surcharge = Number(payment.surcharge);
  const hasSplit = Number.isFinite(quota) && quota > 0;
  const period = paymentPeriodLabel(payment);
  const tennis = !isBooking && paymentIsTennisAbonoOnly(payment);
  const chargeNoun = tennis ? 'Abono tenis' : 'Cuota social';
  const chargeLines = isBooking ? [] : receiptChargeLines(payment);
  const bodyRows = chargeLines.length
    ? chargeLines.map((line, index) => [
      index === 0 ? formatShortDateAr(payment.date) : '',
      line.detail,
      formatCurrency(line.payable),
      formatCurrency(line.payable),
    ])
    : hasSplit
    ? [
      [
        formatShortDateAr(payment.date),
        period && period !== '—' ? `${chargeNoun} · ${period}` : chargeNoun,
        formatCurrency(quota),
        formatCurrency(quota),
      ],
      ...(Number.isFinite(surcharge) && surcharge > 0
        ? [[
          '',
          period && period !== '—' ? `Recargo · ${period}` : 'Recargo',
          formatCurrency(surcharge),
          formatCurrency(surcharge),
        ]]
        : []),
    ]
    : [[
      formatShortDateAr(payment.date),
      corresponds,
      formatCurrency(payment.amount),
      formatCurrency(payment.amount),
    ]];
  const discountLine = isBooking ? null : receiptDiscountLine(payment);
  if (discountLine) {
    bodyRows.push(['', discountLine.detail, formatCurrency(-discountLine.amount), formatCurrency(-discountLine.amount)]);
  }

  if (isBooking && Number.isFinite(totalPrice) && totalPrice > 0) {
    bodyRows.push(['', 'Precio total alquiler', formatCurrency(totalPrice), '']);
    if (Number.isFinite(balanceRemaining) && balanceRemaining > 0) {
      bodyRows.push(['', 'Saldo pendiente', formatCurrency(balanceRemaining), '']);
    } else if (payment.bookingScope === 'total' || balanceRemaining === 0) {
      bodyRows.push(['', 'Saldo pendiente', formatCurrency(0), 'Saldado']);
    }
  }
  if (Number.isFinite(creditApplied) && creditApplied > 0.01 && !onAccount) {
    bodyRows.push(['', 'Saldo a favor imputado', formatCurrency(creditApplied), formatCurrency(creditApplied)]);
  }
  if (onAccount) {
    bodyRows.push(['', 'Entregado a cuenta', formatCurrency(payment.amount), formatCurrency(payment.amount)]);
    if (Number.isFinite(creditApplied) && creditApplied > 0.01) {
      bodyRows.push(['', 'Saldo a favor imputado', formatCurrency(creditApplied), formatCurrency(creditApplied)]);
    }
    if (Number.isFinite(balanceRemaining)) {
      bodyRows.push([
        '',
        balanceRemaining > 0.01 ? 'Deuda restante' : 'Deuda restante',
        formatCurrency(Math.max(0, balanceRemaining)),
        balanceRemaining > 0.01 ? '' : 'Saldado',
      ]);
    }
    if (Number.isFinite(creditLeftover) && creditLeftover > 0.01) {
      bodyRows.push(['', 'Saldo a favor', formatCurrency(creditLeftover), '']);
    }
  }

  autoTable(doc, {
    startY: y + 4,
    head: [['FECHA', 'CORRESPONDE A', 'MONTO', 'ABONADO']],
    body: bodyRows,
    foot: [
      ['', '', onAccount ? 'ENTREGADO' : 'TOTAL PAGO', formatCurrency(payment.amount)],
    ],
    styles: { fontSize: 9, cellPadding: 2.4 },
    headStyles: { fillColor: BRAND.green, textColor: BRAND.cream, fontStyle: 'bold' },
    footStyles: { fillColor: [235, 235, 230], textColor: [30, 30, 30], fontStyle: 'bold' },
    columnStyles: {
      2: { halign: 'right' },
      3: { halign: 'right' },
    },
    margin: { left: 14, right: 14 },
  });

  let footY = (doc.lastAutoTable?.finalY || y + 30) + 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  doc.text(`${(member?.name || '—').toUpperCase()} (${member?.memberId || '—'}) · ${category}`, 14, footY);
  footY += 6;

  const duesBalanceExtra = onAccount
    ? (6 + (Number.isFinite(balanceRemaining) ? 6 : 0) + (Number.isFinite(creditLeftover) && creditLeftover > 0.01 ? 6 : 0))
    : 0;
  const bookingExtra = isBooking && Number.isFinite(balanceRemaining) && balanceRemaining > 0 ? 10 : 0;
  doc.setDrawColor(...BRAND.muted);
  doc.setLineWidth(0.2);
  doc.rect(14, footY, 182, 22 + bookingExtra + duesBalanceExtra);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  const credited = accountLabel(payment);
  const footRows = [
    ['TIPO', methodText],
    ...(credited ? [['DESTINO', credited]] : []),
    [onAccount ? 'ENTREGADO' : 'MONTO', formatCurrency(payment.amount)],
  ];
  if (isBooking && Number.isFinite(balanceRemaining) && balanceRemaining > 0) {
    footRows.push(['SALDO', formatCurrency(balanceRemaining)]);
  }
  if (onAccount && Number.isFinite(balanceRemaining)) {
    footRows.push(['DEUDA RESTANTE', formatCurrency(Math.max(0, balanceRemaining))]);
  }
  if (onAccount && Number.isFinite(creditLeftover) && creditLeftover > 0.01) {
    footRows.push(['A FAVOR', formatCurrency(creditLeftover)]);
  }
  let fy = footY + 6;
  footRows.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold');
    doc.text(`${label}:`, 18, fy);
    doc.setFont('helvetica', 'normal');
    doc.text(String(value), 55, fy, { maxWidth: 135 });
    fy += 6;
  });

  doc.setFontSize(8);
  doc.setTextColor(...BRAND.muted);
  const closing = isBoleto
    ? 'Boleto emitido por el Portal del Socio para el pago con Mercado Pago. Tambien queda en Cuotas.'
    : isBooking && Number.isFinite(balanceRemaining) && balanceRemaining > 0
      ? 'Comprobante de seña. El saldo del alquiler queda pendiente en la cuenta del socio.'
      : isBooking
        ? 'Comprobante de alquiler. El espacio queda saldado.'
        : onAccount
          ? (Number.isFinite(balanceRemaining) && balanceRemaining > 0.01
            ? 'Comprobante de pago a cuenta. La deuda restante queda en la ficha del socio.'
            : 'Comprobante de pago a cuenta. La deuda de cuota quedó saldada.')
          : 'Comprobante emitido por el Portal del Socio. Conservelo como constancia de pago.';
  doc.text(closing, 14, fy + 6, { maxWidth: 180 });

  drawReportFooter(doc);
  return doc;
}

/** Recibo PDF de un pago de socio. */
export async function downloadPaymentReceiptPdf({ member, payment }) {
  const doc = await buildPaymentReceiptDoc({ member, payment });
  const file = `recibo-${payment.receipt || payment.id}.pdf`;
  doc.save(file);
  return file;
}

/** Mismo recibo, como archivo en memoria (para adjuntar a un mensaje). */
export async function paymentReceiptPdfFile({ member, payment }) {
  const doc = await buildPaymentReceiptDoc({ member, payment });
  const name = `recibo-${payment.receipt || payment.id}.pdf`;
  const blob = doc.output('blob');
  return new File([blob], name, { type: 'application/pdf' });
}

/** Boleto de Mercado Pago, como archivo para mail, mensaje y descarga. */
export async function paymentBoletoPdfFile({ member, boleto }) {
  const doc = await buildPaymentReceiptDoc({ member, payment: boleto, kind: 'boleto' });
  const name = `boleto-${boleto.receipt || boleto.id}.pdf`;
  const blob = doc.output('blob');
  return new File([blob], name, { type: 'application/pdf' });
}

export async function downloadPaymentBoletoPdf({ member, boleto }) {
  const doc = await buildPaymentReceiptDoc({ member, payment: boleto, kind: 'boleto' });
  const file = `boleto-${boleto.receipt || boleto.id}.pdf`;
  doc.save(file);
  return file;
}
