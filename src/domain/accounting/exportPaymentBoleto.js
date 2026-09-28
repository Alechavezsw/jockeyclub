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

function slug(boleto) {
  const nro = String(boleto?.memberNumber || 'socio').replace(/\D/g, '') || 'socio';
  const num = String(boleto?.number || '').replace(/\W/g, '').slice(-10);
  return `boleto_${nro}${num ? `_${num}` : ''}`;
}

export async function exportPaymentBoletoPdf(boleto) {
  if (!boleto) throw new Error('No hay boleto para exportar.');
  const [{ jsPDF }, autoTableMod, logoDataUrl] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadClubLogoDataUrl(),
  ]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const lines = boleto.lines || [];

  let y = drawReportHeader(doc, {
    title: `Boleto de pago #${boleto.number || ''}`,
    subtitle: CLUB_NAME,
    metaLine: `${boleto.memberName || 'Socio'} · Nº ${boleto.memberNumber || '—'} · ${boleto.periodLabel || ''}`,
    logoDataUrl,
  });

  autoTable(doc, {
    startY: y,
    head: [['#', 'Socio', 'Identificador', 'Monto']],
    body: lines.length
      ? [
        ...lines.map((line) => [line.id, line.memberName, line.identifier, money(line.amount)]),
        ['', '', `Total ${boleto.periodLabel || ''}`, money(boleto.total)],
      ]
      : [['—', '—', 'Sin líneas', '']],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: BRAND.green, textColor: BRAND.cream },
    columnStyles: { 3: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  });

  y = (doc.lastAutoTable?.finalY || y) + 8;
  autoTable(doc, {
    startY: y,
    head: [['Fecha', 'Entrada', 'Monto', 'Cancelado']],
    body: lines.length
      ? lines.map((line) => [line.date || '—', line.description || 'Cuota', money(line.amount), money(line.cancelled)])
      : [['—', 'Sin conceptos', '', '']],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: BRAND.green, textColor: BRAND.cream },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  });

  y = (doc.lastAutoTable?.finalY || y) + 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(30, 30, 30);
  doc.text(`Total a pagar: ${money(boleto.totalToPay)}`, 14, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  if (boleto.dueDate1) {
    doc.text(`1° vencimiento: ${money(boleto.dueAmount1)} hasta ${boleto.dueDate1}`, 14, y);
    y += 5;
  }
  if (boleto.dueDate2) {
    doc.text(`2° vencimiento: ${money(boleto.dueAmount2)} hasta ${boleto.dueDate2}`, 14, y);
    y += 5;
  }
  if (boleto.surchargeNote) {
    doc.setTextColor(...BRAND.muted);
    doc.text(String(boleto.surchargeNote), 14, y, { maxWidth: 180 });
  }

  drawReportFooter(doc);
  const fileName = `jockey_club_${slug(boleto)}.pdf`;
  doc.save(fileName);
  return { fileName };
}
