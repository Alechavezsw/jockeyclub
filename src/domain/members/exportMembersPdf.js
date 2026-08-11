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
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = autoTableMod.default;
  const list = Array.isArray(members) ? members : [];
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const generatedAt = new Date().toLocaleString('es-AR');
  const stamp = new Date().toISOString().slice(0, 10);
  const downloadName = fileName || `jockey_club_padron_socios_${stamp}.pdf`;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Jockey Club San Juan', 14, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Padrón de socios / clientes', 14, 22);
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(`Filtro: ${filterLabel}  ·  ${list.length} registro${list.length === 1 ? '' : 's'}  ·  Generado: ${generatedAt}`, 14, 28);
  doc.setTextColor(0);

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
    startY: 32,
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
      fillColor: [30, 58, 40],
      textColor: [245, 230, 180],
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
    margin: { left: 14, right: 14 },
  });

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(
      `Sede Rivadavia · Página ${i} de ${pageCount}`,
      14,
      doc.internal.pageSize.getHeight() - 8,
    );
  }

  doc.save(downloadName);
  return downloadName;
}
