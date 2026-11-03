/** PDF de la revisión IA de cuotas (altas, bajas, fichas y liquidación). */

import { loadAutoTable, loadJsPdf } from '../../lib/office.js';
import {
  BRAND,
  CLUB_NAME,
  CLUB_SEDE,
  drawReportFooter,
  drawReportHeader,
  loadClubLogoDataUrl,
} from '../reports/pdfBrand';
import { REVIEW_TIERS } from './buildClubReview';
import { todayAR } from '../../lib/arDate';


const TIER_LABEL = Object.fromEntries(REVIEW_TIERS.map((tier) => [tier.id, tier.label]));

function sampleLabel(sample) {
  if (!sample) return '—';
  if (typeof sample === 'string') return sample;
  return String(sample.label || sample.href || '—');
}

export async function exportCuotasReviewPdf(review) {
  if (!review) throw new Error('No hay revisión para exportar.');
  const [{ jsPDF }, autoTableMod, logoDataUrl] = await Promise.all([
    loadJsPdf(),
    loadAutoTable(),
    loadClubLogoDataUrl(),
  ]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const stamp = todayAR();
  const counts = review.counts || {};
  const periodBit = review.periodLabel ? ` · ${review.periodLabel}` : '';
  let y = drawReportHeader(doc, {
    title: 'Revisión IA · Cuotas',
    subtitle: `${CLUB_NAME} · ${CLUB_SEDE}${periodBit}`,
    metaLine: counts.ready === false
      ? 'Padrón aún cargando'
      : `${Number(counts.bien || 0).toLocaleString('es-AR')} fichas bien · ${Number(counts.fichas || 0).toLocaleString('es-AR')} a corregir · ${Number(counts.activos || 0).toLocaleString('es-AR')} activos`,
    logoDataUrl,
  });

  const kpiBody = [
    ['Titulares', Number(counts.titulares || 0).toLocaleString('es-AR')],
    ['Grupos', Number(counts.grupos || 0).toLocaleString('es-AR')],
    ['Integrantes', Number(counts.integrantes || 0).toLocaleString('es-AR')],
    ['Fichas a corregir', Number(counts.fichas || 0).toLocaleString('es-AR')],
  ];
  autoTable(doc, {
    startY: y,
    head: [['Indicador', 'Valor']],
    body: kpiBody,
    styles: { fontSize: 9, cellPadding: 1.6 },
    headStyles: { fillColor: BRAND.green, textColor: BRAND.cream },
    columnStyles: { 1: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  });
  y = doc.lastAutoTable.finalY + 8;

  const items = review.items || [];
  if (!items.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    doc.text(
      counts.ready === false
        ? 'Cuando termine de cargar el padrón, aparece lo que haya que mirar.'
        : 'Nada para revisar en altas, bajas, fichas ni liquidación de este período.',
      14,
      y,
    );
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(20, 20, 20);
    doc.text('Hallazgos', 14, y);
    y += 3;

    const body = items.map((item, index) => [
      String(index + 1),
      TIER_LABEL[item.tier] || item.tier || '',
      item.title || '',
      item.detail || '',
      Number(item.count || 0).toLocaleString('es-AR'),
    ]);
    autoTable(doc, {
      startY: y,
      head: [['#', 'Cola', 'Hallazgo', 'Detalle', 'Cant.']],
      body,
      styles: { fontSize: 8, cellPadding: 1.4 },
      headStyles: { fillColor: BRAND.green, textColor: BRAND.cream },
      columnStyles: {
        0: { cellWidth: 8 },
        1: { cellWidth: 28 },
        4: { cellWidth: 14, halign: 'right' },
      },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 8;

    for (const item of items) {
      const samples = (item.samples || []).slice(0, 40);
      if (!samples.length) continue;
      if (y > 250) {
        doc.addPage();
        y = 18;
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(20, 20, 20);
      doc.text(item.title || 'Lista', 14, y);
      y += 2;
      autoTable(doc, {
        startY: y,
        head: [['#', 'Detalle']],
        body: samples.map((sample, index) => [String(index + 1), sampleLabel(sample)]),
        styles: { fontSize: 8, cellPadding: 1.2 },
        headStyles: { fillColor: BRAND.gold, textColor: [255, 255, 255] },
        columnStyles: { 0: { cellWidth: 10 } },
        margin: { left: 14, right: 14 },
      });
      y = doc.lastAutoTable.finalY + 6;
      if ((item.samples || []).length > samples.length) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...BRAND.muted);
        doc.text(`… y ${(item.samples.length - samples.length).toLocaleString('es-AR')} más en pantalla`, 14, y);
        y += 5;
      }
    }
  }

  drawReportFooter(doc);
  const slug = String(review.periodId || review.periodLabel || 'cuotas')
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 40);
  const fileName = `jockey_club_revision_ia_cuotas_${slug}_${stamp}.pdf`;
  doc.save(fileName);
  return fileName;
}
