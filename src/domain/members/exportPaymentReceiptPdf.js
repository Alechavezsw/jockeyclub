import { loadAutoTable, loadJsPdf } from '../../lib/office.js';
import { BRAND, drawReportFooter, drawReportHeader } from '../reports/pdfBrand';
import { CLUB_BANK_ACCOUNTS, MERCADO_PAGO } from './clubBanks';

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
  const iso = String(dueOn || '').slice(0, 10);
  const match = iso.match(/^(\d{4})-(\d{2})/);
  if (!match) return iso || '';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  const label = date.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Período cubierto por el cobro (meses marcados o texto guardado). */
function paymentPeriodLabel(payment) {
  const stored = String(payment?.period || '').trim();
  if (stored) return stored;
  const dueOns = Array.isArray(payment?.periodDueOns) ? payment.periodDueOns.filter(Boolean) : [];
  if (!dueOns.length) return '—';
  if (dueOns.length === 1) return periodLabelFromDueOn(dueOns[0]);
  return `${periodLabelFromDueOn(dueOns[0])} · ${periodLabelFromDueOn(dueOns[dueOns.length - 1])}`;
}

const METHOD = {
  transferencia: 'Transferencia bancaria',
  efectivo: 'Efectivo',
  debito: 'Débito automático',
  tarjeta: 'Tarjeta',
  caja: 'Caja / Secretaría',
  mercadopago: 'Mercado Pago',
};

/** Cuenta acreditada según el medio de pago, para el recuadro final del recibo. */
function accountLabel(payment) {
  if (payment.method === 'mercadopago') return `Mercado Pago - ${MERCADO_PAGO.alias}`;
  if (payment.method === 'transferencia') {
    const bank = CLUB_BANK_ACCOUNTS.find((b) => b.id === payment.bankId);
    return bank?.alias ? `Alias ${bank.alias}` : '—';
  }
  return 'Caja General';
}

/** Arma el PDF del recibo (compartido por descarga y envío por mensajería). */
async function buildPaymentReceiptDoc({ member, payment, kind = 'recibo' }) {
  if (!payment) throw new Error('Pago no encontrado.');
  const isBoleto = kind === 'boleto';
  const docLabel = isBoleto ? 'Boleto de pago' : 'Recibo de pago';
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    loadJsPdf(),
    loadAutoTable(),
  ]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const receiptNo = payment.receiptNumber || payment.receipt || payment.id;

  // Sin logo: el PNG institucional pesa ~4MB embebido sin re-escalar y este
  // recibo va adjunto a un mensaje (bucket con tope de 5MB); el resto del
  // branding (barra verde, dorado) alcanza para que se vea institucional.
  const startY = drawReportHeader(doc, {
    title: `${docLabel} #${receiptNo}`,
    subtitle: `Socio ${member?.memberId || '—'} · ${member?.name || '—'}`,
    metaLine: `Emitido el ${new Date().toLocaleString('es-AR')}`,
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(30, 30, 30);
  doc.text(`${docLabel.toUpperCase()} #${receiptNo}`, 105, startY + 6, { align: 'center' });
  doc.setDrawColor(...BRAND.gold);
  doc.setLineWidth(0.3);
  doc.line(14, startY + 10, 196, startY + 10);

  let y = startY + 18;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  const isBooking = payment.kind === 'reserva' || payment.bookingScope === 'deposit' || payment.bookingScope === 'total';
  const balanceRemaining = Number(payment.balanceRemaining);
  const totalPrice = Number(payment.totalPrice);
  const infoRows = [
    ['SOCIO', String(member?.name || '—').toUpperCase()],
    ['N° SOCIO', String(member?.memberId || '—')],
    isBooking
      ? ['ESPACIO', String(payment.facilityName || '—').toUpperCase()]
      : ['PERÍODO', paymentPeriodLabel(payment)],
    isBooking
      ? ['EVENTO', paymentPeriodLabel(payment)]
      : ['FECHA', formatLongDateAr(payment.date)],
    ['FECHA PAGO', formatLongDateAr(payment.date)],
    ['DESCRIPCIÓN', String(payment.concept || (isBooking ? 'Reserva' : 'Cuota social')).toUpperCase()],
    ['COMPROBANTE', String(receiptNo)],
  ];
  infoRows.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold');
    doc.text(`${label}:`, 16, y);
    doc.setFont('helvetica', 'normal');
    doc.text(value, 55, y, { maxWidth: 140 });
    y += 6;
  });

  const quota = Number(payment.quota);
  const surcharge = Number(payment.surcharge);
  const hasSplit = Number.isFinite(quota) && quota > 0;
  const bodyRows = hasSplit
    ? [
      [formatShortDateAr(payment.date), 'Cuota social', formatCurrency(quota), formatCurrency(quota)],
      ...(Number.isFinite(surcharge) && surcharge > 0
        ? [['', 'Interés', formatCurrency(surcharge), formatCurrency(surcharge)]]
        : []),
    ]
    : [[
      formatShortDateAr(payment.date),
      payment.concept || (isBooking ? 'Reserva' : 'Cuota social'),
      formatCurrency(payment.amount),
      formatCurrency(payment.amount),
    ]];

  if (isBooking && Number.isFinite(totalPrice) && totalPrice > 0) {
    bodyRows.push(['', 'Precio total alquiler', formatCurrency(totalPrice), '']);
    if (Number.isFinite(balanceRemaining) && balanceRemaining > 0) {
      bodyRows.push(['', 'Saldo pendiente', formatCurrency(balanceRemaining), '']);
    } else if (payment.bookingScope === 'total' || balanceRemaining === 0) {
      bodyRows.push(['', 'Saldo pendiente', formatCurrency(0), 'Saldado']);
    }
  }

  autoTable(doc, {
    startY: y + 4,
    head: [['FECHA', 'ENTRADA', 'MONTO', 'ABONADO']],
    body: bodyRows,
    foot: [
      ['', '', 'TOTAL PAGO', formatCurrency(payment.amount)],
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
  doc.text(`${(member?.name || '—').toUpperCase()} (${member?.memberId || '—'})`, 14, footY);
  footY += 6;

  const bookingExtra = isBooking && Number.isFinite(balanceRemaining) && balanceRemaining > 0 ? 10 : 0;
  doc.setDrawColor(...BRAND.muted);
  doc.setLineWidth(0.2);
  doc.rect(14, footY, 182, 22 + bookingExtra);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  const footRows = [
    ['TIPO', METHOD[payment.method] || payment.method || '—'],
    ['CUENTA', accountLabel(payment)],
    ['MONTO', formatCurrency(payment.amount)],
  ];
  if (isBooking && Number.isFinite(balanceRemaining) && balanceRemaining > 0) {
    footRows.push(['SALDO', formatCurrency(balanceRemaining)]);
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
