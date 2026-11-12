import { loadJsPdf } from '../../lib/office.js';
import {
  BRAND,
  CLUB_NAME,
  CLUB_SEDE,
  drawReportFooter,
  drawReportHeader,
  loadClubLogoDataUrl,
} from '../reports/pdfBrand.js';

function formatCurrency(amount) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(Number(amount) || 0);
}

const METHOD = {
  transfer: 'Transferencia',
  transferencia: 'Transferencia',
  cash: 'Efectivo',
  efectivo: 'Efectivo',
  debito: 'Débito',
  cheque: 'Cheque',
  mercadopago: 'Mercado Pago',
};

/** Boleto PDF de cobro de canon (para el concesionario). Sin trazabilidad interna. */
export async function downloadCanonReceiptPdf({ concession, payment }) {
  if (!payment) throw new Error('Pago no encontrado.');
  const [{ jsPDF }, logoDataUrl] = await Promise.all([
    loadJsPdf(),
    loadClubLogoDataUrl(),
  ]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const receiptNo = payment.receipt || payment.id;

  let y = drawReportHeader(doc, {
    title: 'Boleto de canon de concesión',
    subtitle: `${CLUB_NAME} · ${CLUB_SEDE}`,
    metaLine: `N° ${receiptNo}`,
    logoDataUrl,
  });

  y += 4;
  doc.setTextColor(...BRAND.green);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Concesión', 14, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  const concessionLines = [
    `Nombre: ${concession?.name || '—'}`,
    `Concesionario: ${concession?.concessionaire || '—'}`,
    concession?.cuit ? `CUIT: ${concession.cuit}` : null,
    concession?.location ? `Ubicación: ${concession.location}` : null,
  ].filter(Boolean);
  for (const line of concessionLines) {
    doc.text(line, 14, y);
    y += 6;
  }

  y += 4;
  doc.setTextColor(...BRAND.green);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Detalle del cobro', 14, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  const payLines = [
    `Período: ${payment.period || '—'}`,
    `Fecha: ${payment.date || '—'}`,
    `Medio: ${METHOD[payment.method] || payment.method || '—'}`,
    `Importe: ${formatCurrency(payment.amount)}`,
    payment.note ? `Nota: ${payment.note}` : null,
  ].filter(Boolean);
  for (const line of payLines) {
    doc.text(line, 14, y);
    y += 6;
  }

  y += 6;
  doc.setDrawColor(...BRAND.green);
  doc.setLineWidth(0.45);
  doc.line(14, y, 196, y);
  y += 8;
  doc.setFontSize(9);
  doc.setTextColor(...BRAND.muted);
  doc.text(
    'Comprobante de pago de canon. Conservalo como constancia del cobro.',
    14,
    y,
    { maxWidth: 180 },
  );
  y += 6;
  doc.text(`Emitido: ${new Date().toLocaleString('es-AR')}`, 14, y);

  drawReportFooter(doc);
  const file = `canon-${receiptNo}.pdf`;
  doc.save(file);
  return file;
}
