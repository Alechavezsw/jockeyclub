/** PDF del informe de cierre de un mes. */

import {
  BRAND,
  CLUB_NAME,
  CLUB_SEDE,
  drawReportFooter,
  drawReportHeader,
  loadClubLogoDataUrl,
} from '../reports/pdfBrand';

function money(n) {
  return `$ ${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function exportMonthClosePdf(report) {
  if (!report?.monthKey) throw new Error('No hay un mes para cerrar.');
  const [{ jsPDF }, autoTableMod, logoDataUrl] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadClubLogoDataUrl(),
  ]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const stamp = new Date().toISOString().slice(0, 10);
  let y = drawReportHeader(doc, {
    title: 'Informe de cierre',
    subtitle: `${CLUB_NAME} · ${CLUB_SEDE}`,
    metaLine: `${report.label}  ·  ${report.statusLabel}  ·  ${report.entryCount} asientos`,
    logoDataUrl,
  });

  const section = (title, body, head = ['Concepto', 'Importe']) => {
    doc.setFont('times', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(20, 20, 20);
    if (y > 250) {
      doc.addPage();
      y = 18;
    }
    doc.text(title, 14, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      head: [head],
      body,
      styles: { fontSize: 9, cellPadding: 1.6 },
      headStyles: { fillColor: BRAND.green, textColor: BRAND.cream },
      columnStyles: { 1: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 8;
  };

  for (const step of report.steps || []) {
    const body = [
      [{ content: step.detail, colSpan: 2 }],
      ...step.lines.map((line) => [
        line.bank ? `${line.label} · extracto` : line.label,
        money(line.amount),
      ]),
    ];
    if (step.id === 'cash') body.push(['Total caja y bancos', money(report.cashTotal)]);
    if (step.id === 'accounts') {
      body.push(['Total recaudado', money(report.collected.recaudado)]);
      body.push(['Portería y estacionamiento, aparte', money(report.collected.porteria)]);
      body.push(['Total del paquete', money(report.liquidation.packTotal)]);
    }
    if (step.id === 'summary') body.push(['Resultado', money(report.result)]);
    if (step.id === 'carry') body.push(['Total que abre el mes siguiente', money(report.cashTotal)]);
    section(`${step.order}. ${step.title}`, body);
  }

  if (y > 240) {
    doc.addPage();
    y = 22;
  }
  doc.setFont('times', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(20, 20, 20);
  doc.text('Firmas', 14, y);
  y += 16;
  const slots = ['Tesorería', 'Contador', 'Administración'];
  const colW = 58;
  slots.forEach((label, index) => {
    const x = 14 + index * (colW + 6);
    doc.setDrawColor(...BRAND.gold);
    doc.setLineWidth(0.3);
    doc.line(x, y, x + colW, y);
    doc.setFont('times', 'bold');
    doc.setFontSize(9);
    doc.text(label, x, y + 5);
    doc.setFont('times', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...BRAND.muted);
    doc.text('Firma y sello', x, y + 9);
    doc.setTextColor(20, 20, 20);
  });

  drawReportFooter(doc);
  const fileName = `jockey_club_cierre_${report.monthKey}_${stamp}.pdf`;
  doc.save(fileName);
  return fileName;
}
