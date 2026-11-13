/** Recibo PDF de una rendición de portería / estacionamiento. */

import { loadJsPdf } from '../../lib/office.js';
import { AR_TZ, arParts } from '../../lib/arDate';
import { formatCurrency } from './journal';
import { OTHER_INCOME_PAYMENT_METHODS } from './otherIncomes';
import {
  BRAND,
  CLUB_NAME,
  CLUB_SEDE,
  drawLabelPastilla,
  drawReportFooter,
  drawReportHeader,
  loadClubLogoDataUrl,
} from '../reports/pdfBrand.js';

function money(amount) {
  return formatCurrency(Number(amount) || 0);
}

export function porteriaReceiptKindLabel(item) {
  return /estacionamiento/i.test(String(item?.concept || ''))
    ? 'Rendición estacionamiento'
    : 'Rendición portería';
}

export function porteriaReceiptMethodLabel(item) {
  const key = String(item?.paymentMethod || '').trim();
  return item?.paymentMethodLabel
    || OTHER_INCOME_PAYMENT_METHODS[key]
    || 'Efectivo';
}

export function porteriaReceiptDateLabel(item) {
  const raw = String(item?.date || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    const local = new Date(y, m - 1, d);
    return local.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  }
  const created = item?.createdAt ? new Date(item.createdAt) : null;
  if (created && !Number.isNaN(created.getTime())) {
    return created.toLocaleDateString('es-AR', {
      timeZone: AR_TZ,
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  }
  return '—';
}

export function porteriaReceiptTimeLabel(item) {
  const created = item?.createdAt ? new Date(item.createdAt) : null;
  if (!created || Number.isNaN(created.getTime())) return '—';
  const parts = arParts(created);
  return `${parts.hour}:${parts.minute} hs`;
}

export function porteriaReceiptFileName(item) {
  const day = String(item?.date || '').slice(0, 10).replace(/-/g, '') || 'sin-fecha';
  const book = String(item?.bookNumber || '').trim().replace(/\W+/g, '') || 's-t';
  const tail = String(item?.id || '').replace(/\W+/g, '').slice(-6) || 'recibo';
  return `recibo-porteria-${book}-${day}-${tail}.pdf`;
}

/** Filas del detalle para el PDF y tests. */
export function porteriaReceiptDetailRows(item) {
  const whoRendered = String(item?.renderedBy || item?.payerName || '').trim() || '—';
  const whoReceived = String(item?.receivedBy || '').trim() || '—';
  return [
    ['Concepto', porteriaReceiptKindLabel(item)],
    ['Fecha', porteriaReceiptDateLabel(item)],
    ['Hora', porteriaReceiptTimeLabel(item)],
    ['Importe', money(item?.amount)],
    ['Medio de pago', porteriaReceiptMethodLabel(item)],
    ['Nº de talonario', String(item?.bookNumber || '').trim() || '—'],
    ['Descripción', String(item?.notes || '').trim() || '—'],
    ['Rindió', whoRendered],
    ['Recibió', whoReceived],
  ];
}

async function buildPorteriaIncomeReceiptDoc(item) {
  if (!item) throw new Error('Rendición no encontrada.');
  const [{ jsPDF }, logoDataUrl] = await Promise.all([
    loadJsPdf(),
    loadClubLogoDataUrl(),
  ]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const kind = porteriaReceiptKindLabel(item);
  const method = porteriaReceiptMethodLabel(item);
  const amount = money(item.amount);
  const book = String(item.bookNumber || '').trim();
  const receiptRef = book
    ? `Talonario ${book}`
    : `Ref. ${String(item.id || '').slice(0, 12)}`;

  const startY = drawReportHeader(doc, {
    title: 'Recibo de rendición',
    subtitle: `${CLUB_NAME} · ${CLUB_SEDE}`,
    metaLine: `${kind} · ${receiptRef}`,
    logoDataUrl,
  });

  let y = startY + 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(30, 30, 30);
  doc.text('COMPROBANTE RENDICIÓN DE PORTERÍA', 105, y, { align: 'center' });
  y += 8;

  const pill = drawLabelPastilla(doc, method, {
    x: 14,
    y,
    fill: [255, 255, 255],
    textColor: BRAND.green,
    border: BRAND.green,
  });
  y += pill.height + 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...BRAND.green);
  doc.text(amount, 14, y);
  y += 10;

  doc.setDrawColor(...BRAND.green);
  doc.setLineWidth(0.3);
  doc.line(14, y, 196, y);
  y += 8;

  for (const [label, value] of porteriaReceiptDetailRows(item)) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.text(`${label.toUpperCase()}:`, 16, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 30, 30);
    const lines = doc.splitTextToSize(String(value), 130);
    doc.text(lines, 62, y);
    y += Math.max(6.5, lines.length * 5);
  }

  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...BRAND.muted);
  doc.text(
    'Constancia de la rendición registrada en Ingresos de portería. Conservala como respaldo.',
    14,
    y,
    { maxWidth: 180 },
  );

  drawReportFooter(doc);
  return doc;
}

/** Descarga el PDF del recibo de portería. */
export async function downloadPorteriaIncomeReceiptPdf(item) {
  const doc = await buildPorteriaIncomeReceiptDoc(item);
  const file = porteriaReceiptFileName(item);
  doc.save(file);
  return file;
}

/** Archivo en memoria para compartir / adjuntar. */
export async function porteriaIncomeReceiptPdfFile(item) {
  const doc = await buildPorteriaIncomeReceiptDoc(item);
  const name = porteriaReceiptFileName(item);
  const blob = doc.output('blob');
  return new File([blob], name, { type: 'application/pdf' });
}
