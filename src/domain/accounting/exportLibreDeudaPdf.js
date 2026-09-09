import {
  BRAND,
  CLUB_NAME,
  CLUB_SEDE,
  drawReportFooter,
  drawReportHeader,
  loadClubLogoDataUrl,
} from '../reports/pdfBrand';

function money(n) {
  return `$ ${Math.abs(Number(n) || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** PDF institucional del certificado de libre deuda. */
export async function exportLibreDeudaPdf(certificate) {
  const [{ jsPDF }, logoDataUrl] = await Promise.all([
    import('jspdf'),
    loadClubLogoDataUrl(),
  ]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const generatedAt = new Date().toLocaleString('es-AR');
  const stamp = certificate.asOf || new Date().toISOString().slice(0, 10);
  const nro = certificate.memberNumber || 'socio';

  const startY = drawReportHeader(doc, {
    title: 'Libre deuda',
    subtitle: `${CLUB_NAME} · ${CLUB_SEDE}`,
    metaLine: `Contabilidad  ·  Emitido: ${generatedAt}`,
    logoDataUrl,
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...BRAND.green);
  doc.text('CERTIFICADO DE LIBRE DEUDA', pageW / 2, startY + 8, { align: 'center' });

  const badge = certificate.isClear ? 'LIBRE DE DEUDA' : 'CON SALDO DEUDOR';
  doc.setFontSize(10);
  doc.setTextColor(...(certificate.isClear ? [16, 122, 86] : [176, 42, 42]));
  doc.text(badge, pageW / 2, startY + 16, { align: 'center' });

  let y = startY + 26;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(40, 40, 40);
  const body = doc.splitTextToSize(certificate.constancia, pageW - 36);
  doc.text(body, 18, y);
  y += body.length * 6 + 8;

  doc.setDrawColor(...BRAND.gold);
  doc.setLineWidth(0.3);
  doc.line(18, y, pageW - 18, y);
  y += 8;

  const rows = [
    ['Socio', `${certificate.memberNumber} · ${certificate.memberName}`],
    ['DNI', certificate.dni || '—'],
    ['Categoría', certificate.tierLabel || '—'],
    ['Fecha de corte', certificate.asOfLabel || certificate.asOf],
    ['Saldo individual', money(certificate.individualBalance)],
  ];
  if (certificate.isTitular && certificate.familyAmount != null) {
    rows.push(['Balance familiar', money(certificate.familyAmount)]);
  }
  if (certificate.extraInfo) {
    rows.push(['Información extra', certificate.extraInfo]);
  }

  doc.setFontSize(9);
  rows.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BRAND.muted);
    doc.text(label.toUpperCase(), 18, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 30, 30);
    const lines = doc.splitTextToSize(String(value), pageW - 70);
    doc.text(lines, 62, y);
    y += Math.max(7, lines.length * 5);
  });

  y += 16;
  doc.setDrawColor(80, 80, 80);
  doc.line(28, y, 88, y);
  doc.line(pageW - 88, y, pageW - 28, y);
  doc.setFontSize(8);
  doc.setTextColor(...BRAND.muted);
  doc.text('Administración', 58, y + 5, { align: 'center' });
  doc.text('Tesorería / Contabilidad', pageW - 58, y + 5, { align: 'center' });

  drawReportFooter(doc);
  doc.save(`jockey_club_libre_deuda_${nro}_${stamp}.pdf`);
}
