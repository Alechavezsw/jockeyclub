import { periodStatusLabel } from './feeBilling';
import { periodKeyFromPeriod } from './feeAccountDetails';
import { buildFeePeriodLiquidation } from './feePeriodLiquidation';
import {
  BRAND,
  CLUB_NAME,
  drawReportFooter,
  drawReportHeader,
  loadClubLogoDataUrl,
} from '../reports/pdfBrand';

export const FEE_PERIOD_EXCEL_HEADERS = [
  '#',
  'IDENTIFICADOR',
  'SOCIOS TITULARES ACTIVOS',
  'VALOR',
  'TOTAL',
];

function money(n) {
  return `$ ${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fileSlug(label) {
  return String(label || 'periodo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || 'periodo';
}

export function isFeePeriodLiquidationModel(value) {
  return Boolean(value && Array.isArray(value.rows) && value.title);
}

export function buildFeePeriodExportModel(period, source = {}) {
  if (isFeePeriodLiquidationModel(period)) return period;
  const liquidation = buildFeePeriodLiquidation(period, {
    members: source?.members || [],
    tierCatalog: source?.tierCatalog || [],
    feeAccounts: source?.feeAccounts || [],
  });
  return {
    ...liquidation,
    periodKey: periodKeyFromPeriod(period),
    status: periodStatusLabel(period?.status),
  };
}

export function buildFeePeriodExcelAoA(model, { formatCurrency: formatCurrencyFn } = {}) {
  const fmt = formatCurrencyFn || money;
  return [
    [model.title],
    [`Detalle de gastos · total ${fmt(model.total)}`],
    [],
    FEE_PERIOD_EXCEL_HEADERS,
    ...model.rows.map((row) => [
      row.identifier || '',
      row.name,
      row.holders,
      fmt(row.unit),
      fmt(row.total),
    ]),
  ];
}

export async function exportFeePeriodExcel(model, _unused, { formatCurrency: formatCurrencyFn } = {}) {
  const liquidation = buildFeePeriodExportModel(model);
  const fmt = formatCurrencyFn || money;
  const XLSX = await import('xlsx');
  const stamp = new Date().toISOString().slice(0, 10);
  const fileName = `jockey_club_liquidacion_${fileSlug(liquidation.label)}_${stamp}.xlsx`;

  const wb = XLSX.utils.book_new();
  const aoa = buildFeePeriodExcelAoA(liquidation, { formatCurrency: fmt });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [12, 42, 28, 16, 16].map((wch) => ({ wch }));
  if (liquidation.rows.length) ws['!autofilter'] = { ref: `A4:E${aoa.length}` };
  XLSX.utils.book_append_sheet(wb, ws, 'Detalle de gastos');
  XLSX.writeFile(wb, fileName);
  return { fileName, lineCount: liquidation.rows.length };
}

export async function exportFeePeriodPdf(model, _unused, { formatCurrency: formatCurrencyFn } = {}) {
  const liquidation = buildFeePeriodExportModel(model);
  const fmt = formatCurrencyFn || money;
  const [{ jsPDF }, autoTableMod, logoDataUrl] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadClubLogoDataUrl(),
  ]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const stamp = new Date().toISOString().slice(0, 10);

  autoTable(doc, {
    startY: drawReportHeader(doc, {
      title: liquidation.title,
      subtitle: `Detalle de gastos · total ${fmt(liquidation.total)}`,
      metaLine: CLUB_NAME,
      logoDataUrl,
    }),
    head: [FEE_PERIOD_EXCEL_HEADERS],
    body: liquidation.rows.length
      ? liquidation.rows.map((row) => [
        row.identifier || '—',
        row.name,
        String(row.holders),
        fmt(row.unit),
        fmt(row.total),
      ])
      : [['—', 'Sin categorías de cuota para este período', '', '', '']],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: BRAND.green, textColor: BRAND.cream },
    columnStyles: {
      0: { cellWidth: 28 },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
    },
    margin: { left: 10, right: 10 },
  });
  drawReportFooter(doc);
  const fileName = `jockey_club_liquidacion_${fileSlug(liquidation.label)}_${stamp}.pdf`;
  doc.save(fileName);
  return { fileName, lineCount: liquidation.rows.length };
}
