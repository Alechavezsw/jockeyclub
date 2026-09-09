import {
  BRAND,
  drawReportFooter,
  drawReportHeader,
  loadClubLogoDataUrl,
} from '../reports/pdfBrand';
import { getTierDisplayName } from './tiers';
import { isFamilyDependent } from './households';

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

function memberKey(member, fallbackIndex) {
  const id = String(member?.memberId || member?.id || '').trim();
  if (id) return id;
  return `row-${fallbackIndex}-${member?.name || ''}`;
}

function statusLabel(status) {
  if (status === 'inactive') return 'Inactivo';
  if (status === 'suspended') return 'Suspendido';
  return 'Habilitado';
}

/**
 * Arma el padrón a exportar: una fila por socio único del sistema.
 */
export function buildPadronPdfModel(members = []) {
  const seen = new Set();
  const unique = [];
  for (const member of Array.isArray(members) ? members : []) {
    if (!member) continue;
    const key = memberKey(member, unique.length);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(member);
  }

  let titulares = 0;
  let integrantes = 0;
  const rows = unique.map((member) => {
    const familiar = isFamilyDependent(member);
    if (familiar) integrantes += 1;
    else titulares += 1;
    return { member, role: familiar ? 'Grupo familiar' : 'Titular' };
  }).toSorted((a, b) => {
    if (a.role !== b.role) return a.role === 'Titular' ? -1 : 1;
    return String(a.member.name || '').localeCompare(b.member.name || '', 'es');
  });

  return {
    rows,
    total: unique.length,
    titulares,
    integrantes,
  };
}

/**
 * Genera y descarga un PDF del padrón completo (titulares + grupo familiar).
 */
export async function exportMembersPdf(members = [], {
  formatCurrency = formatMoney,
  filterLabel = 'Padrón completo',
  fileName,
  tierCatalog,
} = {}) {
  const [{ jsPDF }, autoTableMod, logoDataUrl] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadClubLogoDataUrl(),
  ]);
  const autoTable = autoTableMod.default;
  const model = buildPadronPdfModel(members);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const generatedAt = new Date().toLocaleString('es-AR');
  const stamp = new Date().toISOString().slice(0, 10);
  const downloadName = fileName || `jockey_club_padron_socios_${stamp}.pdf`;

  const startY = drawReportHeader(doc, {
    title: 'Padrón de socios',
    subtitle: 'Listado institucional: una fila por socio del sistema',
    metaLine: `${filterLabel}  ·  ${model.total.toLocaleString('es-AR')} socio${model.total === 1 ? '' : 's'}  ·  ${model.titulares.toLocaleString('es-AR')} titulares  ·  ${model.integrantes.toLocaleString('es-AR')} grupo familiar  ·  ${generatedAt}`,
    logoDataUrl,
  });

  const body = model.rows.map((row, index) => {
    const m = row.member;
    return [
      String(index + 1),
      m.name || '—',
      row.role,
      formatCredential(m.memberId),
      (m.documentType || 'DNI') + (m.documentNumber ? ` ${m.documentNumber}` : ''),
      getTierDisplayName(m.tier, tierCatalog),
      m.phone || '—',
      m.email || '—',
      statusLabel(m.status),
      Number(m.outstandingBalance) > 0 ? formatCurrency(m.outstandingBalance) : 'Al día',
    ];
  });

  autoTable(doc, {
    startY,
    head: [[
      '#',
      'Socio',
      'Rol',
      'Credencial',
      'Documento',
      'Categoría',
      'Teléfono',
      'Email',
      'Estado',
      'Saldo',
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
      1: { cellWidth: 40 },
      2: { cellWidth: 24 },
      3: { cellWidth: 32 },
      4: { cellWidth: 28 },
      5: { cellWidth: 28 },
      6: { cellWidth: 26 },
      7: { cellWidth: 38 },
      8: { cellWidth: 20 },
      9: { cellWidth: 22 },
    },
    margin: { left: 14, right: 14, bottom: 16 },
  });

  drawReportFooter(doc);
  doc.save(downloadName);
  return { fileName: downloadName, total: model.total, titulares: model.titulares, integrantes: model.integrantes };
}
