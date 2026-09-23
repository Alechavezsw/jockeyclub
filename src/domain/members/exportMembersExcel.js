import { quotaHeadline } from './dues';
import { buildPadronPdfModel } from './exportMembersPdf';
import { getTierDisplayName } from './tiers';

function statusLabel(status) {
  if (status === 'inactive') return 'Baja del padrón';
  if (status === 'suspended') return 'Suspendido';
  if (status === 'pending') return 'Pendiente';
  return 'Habilitado';
}

function formatCredential(id = '') {
  const digits = String(id).replace(/\D/g, '');
  if (digits.length < 8) return String(id);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

function documentLabel(member) {
  const tipo = member?.documentType || 'DNI';
  const nro = String(member?.documentNumber || '').trim();
  return nro ? `${tipo} ${nro}` : tipo;
}

function saldoValue(member) {
  const amount = Number(member?.outstandingBalance) || 0;
  return amount > 0 ? amount : 0;
}

export const PADRON_EXCEL_HEADERS = [
  '#',
  'Socio',
  'Rol',
  'Credencial',
  'Documento',
  'Categoría',
  'Teléfono',
  'Email',
  'Estado',
  'Cuota',
  'Saldo',
  'Ingreso',
  'Domicilio',
  'Ciudad',
];

const COL_WIDTHS = [6, 32, 16, 14, 20, 28, 16, 32, 16, 16, 12, 14, 28, 22];

/**
 * Filas del padrón para Excel: una por socio único, misma base que el PDF.
 */
export function buildPadronExcelAoA(members = [], { tierCatalog } = {}) {
  const model = buildPadronPdfModel(members);
  const dataRows = model.rows.map((row, index) => {
    const m = row.member;
    const quota = quotaHeadline(m);
    const saldo = saldoValue(m);
    return [
      index + 1,
      m.name || '',
      row.role,
      formatCredential(m.memberId),
      documentLabel(m),
      getTierDisplayName(m.tier, tierCatalog),
      m.phone || '',
      m.email || '',
      statusLabel(m.status),
      saldo > 0 ? 'Con deuda' : quota.title,
      saldo,
      m.joinDate || '',
      m.address || '',
      [m.city, m.province].filter(Boolean).join(', '),
    ];
  });

  return {
    aoa: [PADRON_EXCEL_HEADERS, ...dataRows],
    total: model.total,
    titulares: model.titulares,
    integrantes: model.integrantes,
  };
}

/**
 * Genera y descarga un Excel del padrón completo (titulares + grupo familiar).
 */
export async function exportMembersExcel(members = [], {
  filterLabel = 'Padrón completo',
  fileName,
  tierCatalog,
} = {}) {
  const XLSX = await import('xlsx');
  const built = buildPadronExcelAoA(members, { tierCatalog });
  const stamp = new Date().toISOString().slice(0, 10);
  const downloadName = fileName || `jockey_club_padron_socios_${stamp}.xlsx`;
  const generatedAt = new Date().toLocaleString('es-AR');

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(built.aoa);
  ws['!cols'] = COL_WIDTHS.map((wch) => ({ wch }));
  if (built.aoa.length > 1) {
    ws['!autofilter'] = { ref: `A1:N${built.aoa.length}` };
  }
  XLSX.utils.book_append_sheet(wb, ws, 'Padrón');

  const resumen = [
    ['Padrón de socios — Jockey Club San Juan'],
    [filterLabel],
    [`Generado ${generatedAt}`],
    [],
    ['Socios', built.total],
    ['Titulares', built.titulares],
    ['Grupo familiar', built.integrantes],
  ];
  const wsResumen = XLSX.utils.aoa_to_sheet(resumen);
  wsResumen['!cols'] = [{ wch: 36 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

  XLSX.writeFile(wb, downloadName);
  return {
    fileName: downloadName,
    total: built.total,
    titulares: built.titulares,
    integrantes: built.integrantes,
  };
}
