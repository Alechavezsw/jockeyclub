import {
  BRAND,
  drawReportFooter,
  drawReportHeader,
  loadClubLogoDataUrl,
} from '../reports/pdfBrand';

function formatMoney(amount) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
  }).format(Number(amount) || 0);
}

function lineAmounts(line) {
  if (line.debit != null || line.credit != null) {
    return {
      debe: Number(line.debit) || 0,
      haber: Number(line.credit) || 0,
    };
  }
  const amount = Number(line.amount) || 0;
  return {
    debe: line.type === 'debit' ? amount : 0,
    haber: line.type === 'credit' ? amount : 0,
  };
}

function lineAccount(line) {
  return line.account || line.accountName || line.accountId || '—';
}

/**
 * Genera y descarga el Libro Diario Legal en PDF con logo institucional.
 */
export async function exportJournalPdf(journalEntries = [], {
  formatCurrency = formatMoney,
  fileName,
} = {}) {
  const [{ jsPDF }, autoTableMod, logoDataUrl] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadClubLogoDataUrl(),
  ]);
  const autoTable = autoTableMod.default;
  const entries = Array.isArray(journalEntries) ? journalEntries : [];
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const generatedAt = new Date().toLocaleString('es-AR');
  const stamp = new Date().toISOString().slice(0, 10);
  const downloadName = fileName || `jockey_club_libro_diario_${stamp}.pdf`;

  let totalDebe = 0;
  let totalHaber = 0;
  const body = [];

  entries.forEach((entry) => {
    const lines = Array.isArray(entry.lines) ? entry.lines : [];
    lines.forEach((line, idx) => {
      const { debe, haber } = lineAmounts(line);
      totalDebe += debe;
      totalHaber += haber;
      body.push([
        idx === 0 ? String(entry.id ?? '—') : '',
        idx === 0 ? (entry.date || '—') : '',
        idx === 0 ? (entry.description || '—') : '',
        lineAccount(line),
        debe > 0 ? formatCurrency(debe) : '',
        haber > 0 ? formatCurrency(haber) : '',
      ]);
    });
  });

  const startY = drawReportHeader(doc, {
    title: 'Libro Diario Legal',
    subtitle: 'Registro cronológico de asientos contables — partida doble',
    metaLine: `${entries.length} asiento${entries.length === 1 ? '' : 's'}  ·  ${body.length} línea${body.length === 1 ? '' : 's'}  ·  Generado: ${generatedAt}`,
    logoDataUrl,
  });

  autoTable(doc, {
    startY,
    head: [['Asiento', 'Fecha', 'Glosa', 'Cuenta', 'Debe', 'Haber']],
    body: body.length
      ? body
      : [['—', '—', 'Sin asientos para exportar', '', '', '']],
    foot: [[
      '',
      '',
      '',
      'Totales',
      formatCurrency(totalDebe),
      formatCurrency(totalHaber),
    ]],
    showFoot: 'lastPage',
    styles: {
      fontSize: 8,
      cellPadding: 2.2,
      overflow: 'linebreak',
      valign: 'middle',
    },
    headStyles: {
      fillColor: BRAND.green,
      textColor: BRAND.cream,
      fontStyle: 'bold',
    },
    footStyles: {
      fillColor: [245, 240, 225],
      textColor: BRAND.green,
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [245, 247, 245],
    },
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 24 },
      2: { cellWidth: 70 },
      3: { cellWidth: 70 },
      4: { cellWidth: 32, halign: 'right' },
      5: { cellWidth: 32, halign: 'right' },
    },
    margin: { left: 14, right: 14, bottom: 16 },
  });

  drawReportFooter(doc);
  doc.save(downloadName);
  return downloadName;
}
