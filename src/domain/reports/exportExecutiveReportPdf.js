import {
  BRAND,
  CLUB_NAME,
  CLUB_SEDE,
  drawReportFooter,
  drawReportHeader,
  loadClubLogoDataUrl,
} from './pdfBrand';

function money(n, formatCurrency) {
  if (typeof formatCurrency === 'function') return formatCurrency(n);
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(Number(n) || 0);
}

/** Informe ejecutivo PDF: resumen económico + operativo del club. */
export async function exportExecutiveReportPdf(stats, { formatCurrency } = {}) {
  const [{ jsPDF }, autoTableMod, logoDataUrl] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadClubLogoDataUrl(),
  ]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const generatedAt = new Date().toLocaleString('es-AR');
  const stamp = new Date().toISOString().slice(0, 10);
  const m = stats.members;
  const e = stats.economic;
  const o = stats.operations;

  const startY = drawReportHeader(doc, {
    title: 'Informe ejecutivo',
    subtitle: `${CLUB_NAME} · ${CLUB_SEDE}`,
    metaLine: `Generado: ${generatedAt}`,
    logoDataUrl,
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...BRAND.green);
  doc.text('Indicadores económicos', 14, startY + 2);

  autoTable(doc, {
    startY: startY + 5,
    head: [['Concepto', 'Importe / Valor']],
    body: [
      ['Ingresos operativos', money(e.totalIngresos, formatCurrency)],
      ['Gastos operativos', money(e.totalGastos, formatCurrency)],
      ['Utilidad neta', money(e.utilidadNeta, formatCurrency)],
      ['Activos totales', money(e.totalActivos, formatCurrency)],
      ['Pasivos totales', money(e.totalPasivos, formatCurrency)],
      ['Patrimonio neto', money(e.totalPatrimonioNetoTotal, formatCurrency)],
      ['Deuda de socios', money(m.debtTotal, formatCurrency)],
      ['Socios deudores', String(m.debtors)],
      ['Gastos ERP pagados', money(e.expensePaidTotal, formatCurrency)],
      ['Gastos ERP pendientes', money(e.expensePendingTotal, formatCurrency)],
      ['Canon cobrado', money(e.canonCollected, formatCurrency)],
      ['Saldo en cajas', money(e.cashBalance, formatCurrency)],
      ['Asientos del diario', String(e.journalEntries)],
    ],
    styles: { fontSize: 9, cellPadding: 2.4 },
    headStyles: { fillColor: BRAND.green, textColor: BRAND.cream },
    columnStyles: { 0: { cellWidth: 110 }, 1: { cellWidth: 70, halign: 'right' } },
    margin: { left: 14, right: 14 },
  });

  const y2 = (doc.lastAutoTable?.finalY || startY + 80) + 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...BRAND.green);
  doc.text('Indicadores operativos y padrón', 14, y2);

  autoTable(doc, {
    startY: y2 + 3,
    head: [['Indicador', 'Valor']],
    body: [
      ['Socios totales', String(m.total)],
      ['Habilitados / Suspendidos', `${m.active} / ${m.suspended}`],
      ['Al día / Con deuda', `${m.alDia} / ${m.debtors}`],
      ['Categorías (top)', Object.entries(m.byTier || {}).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}:${v}`).join(' · ') || '—'],
      ['Adherentes', String(m.adherents)],
      ['Reservas (conf/pend/canc)', `${o.confirmed} / ${o.pending} / ${o.cancelled}`],
      ['Reclamos abiertos', `${o.openClaims} de ${o.claimsTotal}`],
      ['Personal', String(o.staff)],
      ['Concesiones vigentes', `${o.concessionsActive} de ${o.concessionsTotal}`],
      ['Eventos próximos', `${o.eventsUpcoming} de ${o.eventsTotal}`],
      ['Encuestas activas', `${o.activeSurveys} de ${o.surveysTotal}`],
      ['Accesos hoy / total', `${o.accessToday} / ${o.accessTotal}`],
      ['Alertas abiertas', String(o.alertsOpen)],
      ['Mensajes sin leer', `${o.unreadMessages} de ${o.messagesTotal}`],
      ['Noticias publicadas', String(o.news)],
    ],
    styles: { fontSize: 9, cellPadding: 2.4 },
    headStyles: { fillColor: BRAND.green, textColor: BRAND.cream },
    columnStyles: { 0: { cellWidth: 110 }, 1: { cellWidth: 70, halign: 'right' } },
    margin: { left: 14, right: 14, bottom: 16 },
  });

  drawReportFooter(doc);
  const name = `jockey_club_informe_ejecutivo_${stamp}.pdf`;
  doc.save(name);
  return name;
}
