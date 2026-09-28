import {
  BRAND,
  CLUB_NAME,
  drawReportFooter,
  drawReportHeader,
  loadClubLogoDataUrl,
} from '../reports/pdfBrand';
import { formatSpanishLongDate } from './memberBalances';

function money(n) {
  return `$ ${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortDate(iso) {
  const raw = String(iso || '').slice(0, 10);
  const m = raw.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[1]}` : raw || '—';
}

export async function exportAccountPaymentPdf(entry, { memberName = '' } = {}) {
  if (!entry) throw new Error('No hay pago para exportar.');
  const [{ jsPDF }, autoTableMod, logoDataUrl] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadClubLogoDataUrl(),
  ]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const receipt = entry.accessinId || entry.id || 'pago';
  const alloc = Array.isArray(entry.allocations) ? entry.allocations : [];
  const methods = Array.isArray(entry.paymentMethods) ? entry.paymentMethods : [];
  const total = Math.abs(Number(entry.value) || 0);

  let y = drawReportHeader(doc, {
    title: `Pago #${receipt}`,
    subtitle: CLUB_NAME,
    metaLine: `${memberName || 'Socio'} · Nº ${entry.memberNumber || '—'} · ${formatSpanishLongDate(entry.date)}`,
    logoDataUrl,
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 40);
  doc.text(`Fecha: ${formatSpanishLongDate(entry.date)}`, 14, y);
  y += 6;
  doc.text(`Descripción: ${entry.description || '—'}`, 14, y, { maxWidth: 182 });
  y += 10;

  autoTable(doc, {
    startY: y,
    head: [['Fecha', 'Tipo', 'Descripción', 'Monto', 'Cancelado']],
    body: alloc.length
      ? alloc.map((row) => [
        shortDate(row.date),
        row.type || '—',
        row.description || '—',
        money(row.amount),
        money(row.cancelled),
      ])
      : [['—', '—', 'Sin detalle de imputación', '', '']],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: BRAND.green, textColor: BRAND.cream },
    columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  });

  y = (doc.lastAutoTable?.finalY || y) + 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(30, 30, 30);
  doc.text(`Total pago: ${money(total)}`, 14, y);
  y += 8;

  autoTable(doc, {
    startY: y,
    head: [['Forma de pago', 'Referencia', 'Monto']],
    body: methods.length
      ? methods.map((row) => [row.method || '—', row.reference || '—', money(row.amount)])
      : [['—', 'Sin formas de pago', '']],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: BRAND.green, textColor: BRAND.cream },
    columnStyles: { 2: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  });

  drawReportFooter(doc);
  const nro = String(entry.memberNumber || 'socio').replace(/\D/g, '') || 'socio';
  const file = `pago_${nro}_${receipt}.pdf`;
  doc.save(file);
  return file;
}
