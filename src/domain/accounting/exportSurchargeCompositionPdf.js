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

export async function exportSurchargeCompositionPdf(report) {
  const [{ jsPDF }, autoTableMod, logoDataUrl] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadClubLogoDataUrl(),
  ]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const generatedAt = new Date().toLocaleString('es-AR');
  const stamp = new Date().toISOString().slice(0, 10);

  const startY = drawReportHeader(doc, {
    title: 'Composición de recargos',
    subtitle: `${CLUB_NAME} · ${CLUB_SEDE}`,
    metaLine: [
      report.memberNumber ? `Socio ${report.memberNumber}` : 'Todos los socios',
      report.from ? `Desde ${report.from}` : null,
      report.to ? `Hasta ${report.to}` : null,
      `Generado: ${generatedAt}`,
    ].filter(Boolean).join('  ·  '),
    logoDataUrl,
  });

  autoTable(doc, {
    startY,
    head: [['Composición', 'Cantidad', 'Importe']],
    body: [
      ...(report.byKind || []).map((k) => [k.label, String(k.count), money(k.amount)]),
      ['Cobrado', '', money(report.collected)],
      ['Adeudado', '', money(report.owed)],
      ['Total', String((report.rows || []).length), money(report.total)],
    ],
    styles: { fontSize: 9, cellPadding: 2.2 },
    headStyles: { fillColor: BRAND.green, textColor: BRAND.cream },
    margin: { left: 14, right: 14 },
  });

  autoTable(doc, {
    startY: (doc.lastAutoTable?.finalY || startY) + 8,
    head: [['Fecha', 'Socio', 'Tipo', 'Descripción', 'Estado', 'Importe']],
    body: (report.rows || []).map((row) => [
      row.date || '—',
      `${row.memberNumber} ${row.memberName || ''}`.trim(),
      row.type,
      row.description || '—',
      row.status === 'cobrado' ? 'Cobrado' : 'Adeudado',
      money(row.amount),
    ]),
    styles: { fontSize: 8, cellPadding: 1.8 },
    headStyles: { fillColor: BRAND.green, textColor: BRAND.cream },
    margin: { left: 14, right: 14 },
  });

  drawReportFooter(doc);
  const nro = report.memberNumber || 'todos';
  const fileName = `jockey_club_composicion_recargos_${nro}_${stamp}.pdf`;
  doc.save(fileName);
  return fileName;
}
