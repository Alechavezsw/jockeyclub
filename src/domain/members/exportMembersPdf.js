import {
  BRAND,
  drawReportFooter,
  drawReportHeader,
  loadClubLogoDataUrl,
} from '../reports/pdfBrand';

const TIER_LABEL = {
  royal: 'Royal',
  platinum: 'Platinum',
  gold: 'Gold',
};

function formatMoney(amount) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(Number(amount) || 0);
}

function formatCredential(id = '') {
  const digits = String(id).replace(/\D/g, '');
  if (digits.length < 8) return String(id);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

/**
 * Genera y descarga un PDF del padrón de socios (lista filtrada actual).
 */
export async function exportMembersPdf(members = [], {
  formatCurrency = formatMoney,
  filterLabel = 'Todos',
  fileName,
} = {}) {
  const [{ jsPDF }, autoTableMod, logoDataUrl] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadClubLogoDataUrl(),
  ]);
  const autoTable = autoTableMod.default;
  const list = Array.isArray(members) ? members : [];
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const generatedAt = new Date().toLocaleString('es-AR');
  const stamp = new Date().toISOString().slice(0, 10);
  const downloadName = fileName || `jockey_club_padron_socios_${stamp}.pdf`;

  const startY = drawReportHeader(doc, {
    title: 'Padrón de socios',
    subtitle: 'Listado institucional de titulares y adherentes',
    metaLine: `Filtro: ${filterLabel}  ·  ${list.length} registro${list.length === 1 ? '' : 's'}  ·  Generado: ${generatedAt}`,
    logoDataUrl,
  });

  const body = list.map((m, index) => [
    String(index + 1),
    m.name || '—',
    formatCredential(m.memberId),
    (m.documentType || 'DNI') + (m.documentNumber ? ` ${m.documentNumber}` : ''),
    TIER_LABEL[m.tier] || String(m.tier || '').toUpperCase(),
    m.phone || '—',
    m.email || '—',
    m.status === 'active' ? 'Habilitado' : 'Suspendido',
    Number(m.outstandingBalance) > 0 ? formatCurrency(m.outstandingBalance) : 'Al día',
    String(m.adherents?.length || 0),
  ]);

  autoTable(doc, {
    startY,
    head: [[
      '#',
      'Socio titular',
      'Credencial',
      'Documento',
      'Categoría',
      'Teléfono',
      'Email',
      'Estado',
      'Saldo',
      'Adher.',
    ]],
    body: body.length
      ? body
      : [['—', 'Sin socios para exportar', '', '', '', '', '', '', '', '']],
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
    alternateRowStyles: {
      fillColor: [245, 247, 245],
    },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 42 },
      2: { cellWidth: 34 },
      3: { cellWidth: 28 },
      4: { cellWidth: 20 },
      5: { cellWidth: 28 },
      6: { cellWidth: 40 },
      7: { cellWidth: 22 },
      8: { cellWidth: 24 },
      9: { cellWidth: 14 },
    },
    margin: { left: 14, right: 14, bottom: 16 },
  });

  drawReportFooter(doc);
  doc.save(downloadName);
  return downloadName;
}
