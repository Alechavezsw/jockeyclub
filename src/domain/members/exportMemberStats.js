import { loadAutoTable, loadJsPdf, loadXlsx } from '../../lib/office.js';
import {
  drawReportFooter,
  drawReportHeader,
  loadClubLogoDataUrl,
} from '../reports/pdfBrand';
import { todayAR } from '../../lib/arDate';
import { buildMemberStatsBundle } from './memberStats';

function money(n) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(Number(n) || 0);
}

function num(n) {
  return Number(n || 0).toLocaleString('es-AR');
}

/**
 * Excel multi-hoja: resumen, edades, horarios, pagos, categorías.
 */
export async function exportMemberStatsExcel(bundle, { fileName } = {}) {
  const stamp = todayAR();
  const name = fileName || `jockey_club_estadisticas_socios_${stamp}.xlsx`;
  const ages = bundle?.ages || {};
  const entries = bundle?.entries || {};
  const payments = bundle?.payments || {};

  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();

  const summary = [
    ['Indicador', 'Valor'],
    ['Corte', ages.asOf || stamp],
    ['Activos', ages.activos || 0],
    ['Titulares', ages.titulares || 0],
    ['Grupo familiar', ages.familiares || 0],
    ['Con edad', ages.withAge || 0],
    ['Sin edad', ages.sinEdad || 0],
    ['Menores de 4', ages.under4 || 0],
    ['4 años o más', ages.census4plus || 0],
    ['Edad media', ages.averageAge ?? ''],
    ['Edad mediana', ages.medianAge ?? ''],
    ['Ingresos (ventana días)', entries.days || 0],
    ['Lecturas ingreso', entries.total || 0],
    ['Ingresos OK', entries.granted || 0],
    ['Denegados', entries.denied || 0],
    ['Hora pico', entries.peakHour?.label || ''],
    ['Cobros en historial', payments.payments || 0],
    ['Monto cobrado', payments.amount || 0],
    ['Al día', payments.alDia || 0],
    ['Con deuda', payments.withDebt || 0],
    ['Deuda capital', payments.debtAmount || 0],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Resumen');

  const ageRows = [
    ['Rango', 'Cantidad'],
    ...(ages.buckets || []).map((b) => [b.label, b.count]),
    ['Sin edad', ages.sinEdad || 0],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ageRows), 'Edades');

  const hourRows = [
    ['Hora', 'Ingresos'],
    ...(entries.hours || []).map((h) => [h.label, h.count]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hourRows), 'Horarios');

  const payRows = [
    ['Mes', 'Cobros', 'Monto'],
    ...(payments.monthSeries || []).map((m) => [m.label, m.count, m.amount]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(payRows), 'Pagos');

  const catRows = [
    ['Categoría', 'Cantidad', 'Con edad', 'Sin edad'],
    ...(bundle?.categories || []).map((c) => [c.label, c.count, c.withAge, c.sinEdad]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(catRows), 'Categorias');

  XLSX.writeFile(wb, name);
  return { fileName: name };
}

/**
 * PDF institucional con tablas de edades, horarios y pagos.
 */
export async function exportMemberStatsPdf(bundle, { fileName } = {}) {
  const [{ jsPDF }, autoTableMod, logoDataUrl] = await Promise.all([
    loadJsPdf(),
    loadAutoTable(),
    loadClubLogoDataUrl(),
  ]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const stamp = todayAR();
  const downloadName = fileName || `jockey_club_estadisticas_socios_${stamp}.pdf`;
  const ages = bundle?.ages || {};
  const entries = bundle?.entries || {};
  const payments = bundle?.payments || {};
  let y = drawReportHeader(doc, {
    title: 'Estadísticas de socios',
    subtitle: `Padrón en vivo · corte ${ages.asOf || stamp}`,
    metaLine: `Activos ${num(ages.activos)} · Con edad ${num(ages.withAge)} · Sin edad ${num(ages.sinEdad)} · Media ${ages.averageAge ?? '—'}`,
    logoDataUrl,
  });

  doc.setFontSize(9);
  doc.setTextColor(70);
  doc.text(
    `Ingresos ${entries.days || 30}d: ${num(entries.total)} · Pico ${entries.peakHour?.label || '—'} · Deuda ${money(payments.debtAmount)} (${num(payments.withDebt)} socios)`,
    14,
    y,
  );
  y += 8;

  autoTable(doc, {
    startY: y,
    head: [['Rango etario', 'Cantidad']],
    body: [
      ...(ages.buckets || []).map((b) => [b.label, num(b.count)]),
      ['Sin edad', num(ages.sinEdad)],
    ],
    styles: { fontSize: 8, cellPadding: 1.6 },
    headStyles: { fillColor: [9, 103, 85] },
    margin: { left: 14, right: 14 },
  });

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 6,
    head: [['Hora', 'Ingresos']],
    body: (entries.hours || [])
      .filter((h) => h.count > 0)
      .map((h) => [h.label, num(h.count)]),
    styles: { fontSize: 8, cellPadding: 1.4 },
    headStyles: { fillColor: [9, 103, 85] },
    margin: { left: 14, right: 14 },
  });

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 6,
    head: [['Mes', 'Cobros', 'Monto']],
    body: (payments.monthSeries || []).map((m) => [m.label, num(m.count), money(m.amount)]),
    styles: { fontSize: 8, cellPadding: 1.4 },
    headStyles: { fillColor: [9, 103, 85] },
    margin: { left: 14, right: 14 },
  });

  drawReportFooter(doc);
  doc.save(downloadName);
  return { fileName: downloadName };
}

/** Atajo: arma el bundle y exporta. */
export async function exportLiveMemberStats(members, entryLogs, { format = 'excel', ...opts } = {}) {
  const bundle = buildMemberStatsBundle(members, entryLogs, opts);
  if (format === 'pdf') return exportMemberStatsPdf(bundle, opts);
  return exportMemberStatsExcel(bundle, opts);
}
