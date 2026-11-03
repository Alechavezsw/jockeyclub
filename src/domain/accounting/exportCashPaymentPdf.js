import { loadAutoTable, loadJsPdf } from '../../lib/office.js';
import {
  BRAND,
  CLUB_NAME,
  drawReportFooter,
  drawReportHeader,
  loadClubLogoDataUrl,
} from '../reports/pdfBrand';

function money(n) {
  return `$ ${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortDate(iso) {
  const raw = String(iso || '').slice(0, 10);
  const match = raw.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}/${match[2]}` : raw || '—';
}

function cashPaymentFileName(detail) {
  const nro = String(detail?.memberNumber || 'socio').replace(/\D/g, '') || 'socio';
  return `pago_${nro}_${detail?.paymentNumber || detail?.accessinId || 'recibo'}.pdf`;
}

/** Arma el PDF del recibo de caja (sin descargar). */
export async function buildCashPaymentPdfDoc(detail) {
  if (!detail) throw new Error('No hay pago para exportar.');
  const [{ jsPDF }, autoTableMod, logoDataUrl] = await Promise.all([
    loadJsPdf(),
    loadAutoTable(),
    loadClubLogoDataUrl(),
  ]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const applied = Array.isArray(detail.applied) ? detail.applied : [];
  const methods = Array.isArray(detail.paymentMethods) ? detail.paymentMethods : [];

  let y = drawReportHeader(doc, {
    title: detail.title || `Pago #${detail.paymentNumber || detail.accessinId || ''}`,
    subtitle: CLUB_NAME,
    metaLine: detail.memberName || (detail.memberNumber ? `Socio ${detail.memberNumber}` : ''),
    logoDataUrl,
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...BRAND.green);
  doc.text('Información del pago', 14, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 40);
  const info = [
    `Fecha: ${detail.dateLabel || '—'}`,
    `Descripción: ${detail.description || '—'}`,
    `Comprobante: ${detail.voucher || '—'}`,
  ];
  info.forEach((line) => {
    doc.text(line, 14, y, { maxWidth: 182 });
    y += 6;
  });
  y += 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...BRAND.green);
  doc.text('Entradas imputadas', 14, y);
  y += 2;

  autoTable(doc, {
    startY: y,
    head: [['Fecha', 'Tipo', 'Descripción', 'Monto', 'Cancelado']],
    body: applied.length
      ? applied.map((row) => [
        shortDate(row.date),
        row.type || '—',
        row.description || '—',
        money(row.amount),
        money(row.cancelled),
      ])
      : [['—', '—', 'Sin imputaciones vinculadas a este movimiento.', '', '']],
    foot: [
      ['', '', '', 'Saldo a favor imputado', money(detail.creditApplied)],
      ['', '', '', 'Excedente', money(detail.surplus)],
      ['', '', '', 'Total pago', money(detail.paymentTotal)],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: BRAND.green, textColor: BRAND.cream },
    footStyles: { fillColor: [245, 245, 245], textColor: [30, 30, 30], fontStyle: 'bold' },
    columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  });

  y = (doc.lastAutoTable?.finalY || y) + 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...BRAND.green);
  doc.text('Formas de pago', 14, y);
  y += 2;

  autoTable(doc, {
    startY: y,
    head: [['Forma de pago', 'Referencia', 'Monto']],
    body: methods.length
      ? methods.map((row) => [
        row.label || '—',
        row.reference ? `# ${row.reference}` : '—',
        money(row.amount),
      ])
      : [['—', 'Sin formas de pago', '']],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: BRAND.green, textColor: BRAND.cream },
    columnStyles: { 2: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  });

  drawReportFooter(doc);
  return doc;
}

/** Recibo del movimiento de caja, con imputaciones y forma de pago. */
export async function exportCashPaymentPdf(detail) {
  const doc = await buildCashPaymentPdfDoc(detail);
  const file = cashPaymentFileName(detail);
  doc.save(file);
  return file;
}

/** Mismo recibo, como archivo en memoria (mail / mensajería). */
export async function cashPaymentPdfFile(detail) {
  const doc = await buildCashPaymentPdfDoc(detail);
  const name = cashPaymentFileName(detail);
  const blob = doc.output('blob');
  return new File([blob], name, { type: 'application/pdf' });
}
