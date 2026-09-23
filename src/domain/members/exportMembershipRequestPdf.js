import {
  BRAND,
  CLUB_NAME,
  CLUB_SEDE,
  drawReportFooter,
  drawReportHeader,
  loadClubLogoDataUrl,
} from '../reports/pdfBrand';
import { requestPdfFileName } from './selfService';

/** PDF de una solicitud pública (ingreso o acceso). */
export async function exportMembershipRequestPdf(detail) {
  const [{ jsPDF }, logoDataUrl] = await Promise.all([
    import('jspdf'),
    loadClubLogoDataUrl(),
  ]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const generatedAt = new Date().toLocaleString('es-AR');

  let y = drawReportHeader(doc, {
    title: detail.title || 'Solicitud',
    subtitle: `${CLUB_NAME} · ${CLUB_SEDE}`,
    metaLine: `Secretaría  ·  Emitido: ${generatedAt}`,
    logoDataUrl,
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...BRAND.green);
  doc.text(detail.subtitle || 'Solicitante', 18, y + 6);
  y += 16;

  doc.setFontSize(10);
  (detail.rows || []).forEach(([label, value]) => {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BRAND.muted);
    doc.text(String(label).toUpperCase(), 18, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 30, 30);
    const lines = doc.splitTextToSize(String(value || '—'), pageW - 70);
    doc.text(lines, 62, y);
    y += Math.max(8, lines.length * 5.2);
  });

  drawReportFooter(doc);
  doc.save(requestPdfFileName(detail));
}
