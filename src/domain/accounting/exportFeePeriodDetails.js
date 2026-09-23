import { periodLabel, periodStatusLabel } from './feeBilling';
import {
  feeAccountDetailsForPeriod,
  feeAccountDetailsSummary,
  periodKeyFromPeriod,
} from './feeAccountDetails';
import {
  BRAND,
  CLUB_NAME,
  CLUB_SEDE,
  drawReportFooter,
  drawReportHeader,
  loadClubLogoDataUrl,
} from '../reports/pdfBrand';

export const FEE_PERIOD_EXCEL_HEADERS = [
  'Cuenta',
  'DNI',
  'N° socio',
  'Nombre',
  'Fecha de cobro',
  'Fecha cuota',
  'Tipo',
  'Descripción',
  'Cobrado',
];

function money(n) {
  return `$ ${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fileSlug(period) {
  return periodLabel(period)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || 'periodo';
}

export function buildFeePeriodExportModel(period, accounts = feeAccountDetailsForPeriod(period)) {
  const list = accounts || [];
  const summary = feeAccountDetailsSummary(list);
  const rows = list.flatMap((account) => (account.lines || []).map((line) => ({
    account: account.accountLabel || '',
    dni: line.dni || '',
    memberNumber: line.memberNumber || '',
    memberName: line.memberName || '',
    collectedAt: line.collectedAtLabel || line.collectedAt || '',
    feeDate: line.feeDateLabel || line.feeDate || '',
    type: line.type || '',
    description: line.description || '',
    amount: Number(line.amount) || 0,
  })));
  return {
    period,
    periodKey: periodKeyFromPeriod(period),
    label: periodLabel(period),
    status: periodStatusLabel(period?.status),
    accounts: list,
    summary,
    rows,
  };
}

export function buildFeePeriodExcelAoA(model) {
  return [
    FEE_PERIOD_EXCEL_HEADERS,
    ...model.rows.map((row) => [
      row.account,
      row.dni,
      row.memberNumber,
      row.memberName,
      row.collectedAt,
      row.feeDate,
      row.type,
      row.description,
      row.amount,
    ]),
  ];
}

export async function exportFeePeriodExcel(period, accounts) {
  const model = buildFeePeriodExportModel(period, accounts);
  const XLSX = await import('xlsx');
  const stamp = new Date().toISOString().slice(0, 10);
  const fileName = `jockey_club_cuotas_${fileSlug(period)}_${stamp}.xlsx`;
  const generatedAt = new Date().toLocaleString('es-AR');

  const wb = XLSX.utils.book_new();
  const aoa = buildFeePeriodExcelAoA(model);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [22, 12, 12, 32, 22, 22, 28, 22, 14].map((wch) => ({ wch }));
  if (aoa.length > 1) ws['!autofilter'] = { ref: `A1:I${aoa.length}` };
  XLSX.utils.book_append_sheet(wb, ws, 'Detalle');

  const resumen = [
    ['Detalle de cuentas contables — Jockey Club San Juan'],
    [model.label],
    [`Generado ${generatedAt}`],
    [],
    ['Estado', model.status],
    ['Liquidación', Number(period?.amount) || 0],
    ['Cuentas', model.summary.accountCount],
    ['Movimientos', model.summary.lineCount],
    ['Total cobrado', model.summary.totalAmount],
  ];
  const wsResumen = XLSX.utils.aoa_to_sheet(resumen);
  wsResumen['!cols'] = [{ wch: 36 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

  XLSX.writeFile(wb, fileName);
  return { fileName, lineCount: model.rows.length };
}

export async function exportFeePeriodPdf(period, accounts, { formatCurrency: formatCurrencyFn } = {}) {
  const model = buildFeePeriodExportModel(period, accounts);
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
      title: 'Detalle de cuentas · Cuotas',
      subtitle: `${CLUB_NAME} · ${CLUB_SEDE}`,
      metaLine: `${model.label} · ${model.status} · ${model.summary.lineCount} movimientos · ${fmt(model.summary.totalAmount || period?.amount || 0)}`,
      logoDataUrl,
    }),
    head: [FEE_PERIOD_EXCEL_HEADERS],
    body: model.rows.length
      ? model.rows.map((row) => [
        row.account,
        row.dni,
        row.memberNumber,
        row.memberName,
        row.collectedAt,
        row.feeDate,
        row.type,
        row.description,
        fmt(row.amount),
      ])
      : [['—', '—', '—', 'Sin líneas de cuenta para este período', '', '', '', '', '']],
    styles: { fontSize: 7.5, cellPadding: 1.5 },
    headStyles: { fillColor: BRAND.green, textColor: BRAND.cream },
    margin: { left: 10, right: 10 },
  });
  drawReportFooter(doc);
  const fileName = `jockey_club_cuotas_${fileSlug(period)}_${stamp}.pdf`;
  doc.save(fileName);
  return { fileName, lineCount: model.rows.length };
}
