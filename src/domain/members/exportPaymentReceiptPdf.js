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
    return (payment.bankName || bank?.name) ? `${payment.bankName || bank.name} - ${bank?.cbu || ''}`.trim() : '—';
  }
  return 'Caja General';
}

/** Arma el PDF del recibo (compartido por descarga y envío por mensajería). */
async function buildPaymentReceiptDoc({ member, payment }) {
  if (!payment) throw new Error('Pago no encontrado.');
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const receiptNo = payment.receiptNumber || payment.receipt || payment.id;

  // Sin logo: el PNG institucional pesa ~4MB embebido sin re-escalar y este
  // recibo va adjunto a un mensaje (bucket con tope de 5MB); el resto del
  // branding (barra verde, dorado) alcanza para que se vea institucional.
  const startY = drawReportHeader(doc, {
    title: `Recibo de pago #${receiptNo}`,
    subtitle: `Socio ${member?.memberId || '—'} · ${member?.name || '—'}`,
    metaLine: `Emitido el ${new Date().toLocaleString('es-AR')}`,
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(30, 30, 30);
  doc.text(`RECIBO DE PAGO #${receiptNo}`, 105, startY + 6, { align: 'center' });
  doc.setDrawColor(...BRAND.gold);
  doc.setLineWidth(0.3);
  doc.line(14, startY + 10, 196, startY + 10);

  let y = startY + 18;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  const infoRows = [
    ['SOCIO', String(member?.memberId || '—')],
    ['FECHA', formatLongDateAr(payment.date)],
    ['DESCRIPCIÓN', String(payment.concept || 'Cuota social').toUpperCase()],
    ['COMPROBANTE', String(receiptNo)],
  ];
  infoRows.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold');
    doc.text(`${label}:`, 16, y);
    doc.setFont('helvetica', 'normal');
    doc.text(value, 55, y, { maxWidth: 140 });
    y += 6;
  });

  autoTable(doc, {
    startY: y + 4,
    head: [['FECHA', 'ENTRADA', 'MONTO', 'ABONADO']],
    body: [[
      formatShortDateAr(payment.date),
      payment.concept || 'Cuota social',
      formatCurrency(payment.amount),
      formatCurrency(payment.amount),
    ]],
    foot: [
      ['', '', 'EXCEDENTE', formatCurrency(0)],
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

  doc.setDrawColor(...BRAND.muted);
  doc.setLineWidth(0.2);
  doc.rect(14, footY, 182, 22);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  const footRows = [
    ['TIPO', METHOD[payment.method] || payment.method || '—'],
    ['CUENTA', accountLabel(payment)],
    ['MONTO', formatCurrency(payment.amount)],
  ];
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
  doc.text(
    'Comprobante emitido por el Portal del Socio. Conservelo como constancia de pago.',
    14,
    fy + 6,
    { maxWidth: 180 }
  );

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
