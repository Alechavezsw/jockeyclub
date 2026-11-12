/** PDF detallado de deuda de cuota social (capital + intereses). */

import { loadJsPdf } from '../../lib/office.js';
import {
  BRAND,
  CLUB_NAME,
  CLUB_SEDE,
  drawReportFooter,
  drawReportHeader,
  loadClubLogoDataUrl,
} from '../reports/pdfBrand.js';

function formatMoney(amount) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(amount) || 0);
}

function formatAsOf(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value || '—');
  return d.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * @param {{ member: object, debt: object|null, asOf?: Date|string }} args
 * debt: resultado de appMonthlyDebtForMember (o null si está al día / exento).
 */
export async function downloadDuesDebtPdf({ member, debt, asOf = new Date() }) {
  const [{ jsPDF }, logoDataUrl] = await Promise.all([
    loadJsPdf(),
    loadClubLogoDataUrl(),
  ]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const nro = String(debt?.memberNumber || member?.memberId || member?.memberNumber || '—');
  const name = String(debt?.memberName || member?.name || 'Socio').trim();
  const asOfLabel = formatAsOf(asOf);

  let y = drawReportHeader(doc, {
    title: 'Consulta de deuda · Cuota social',
    subtitle: `${CLUB_NAME} · ${CLUB_SEDE}`,
    metaLine: `Al ${asOfLabel}`,
    logoDataUrl,
  });

  y += 2;
  doc.setTextColor(...BRAND.green);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Socio', 14, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  const socioLines = [
    `Nº ${nro} · ${name}`,
    debt?.dni || member?.documentNumber ? `Documento: ${debt?.dni || member.documentNumber}` : null,
    `Categoría: ${debt?.socialFee || member?.tier || '—'}`,
    `Estado: ${debt?.standing || (Number(member?.outstandingBalance) > 0 ? 'Con saldo' : 'Al día')}`,
  ].filter(Boolean);
  for (const line of socioLines) {
    doc.text(line, 14, y);
    y += 5.5;
  }

  y += 3;
  doc.setDrawColor(...BRAND.green);
  doc.setLineWidth(0.35);
  doc.line(14, y, pageW - 14, y);
  y += 8;

  const months = Array.isArray(debt?.months) ? debt.months : [];
  const capital = money(debt?.capital);
  const interest = money(debt?.interest);
  const unallocated = money(debt?.unallocated);
  const total = money(debt?.totalDebt ?? (capital + interest + unallocated));

  if (!debt || total <= 0.009) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...BRAND.green);
    doc.text('Sin deuda de cuota social', 14, y);
    y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    doc.text('Al corte indicado el socio no registra capital ni intereses de cuota social.', 14, y, {
      maxWidth: pageW - 28,
    });
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...BRAND.green);
    doc.text('Detalle por mes', 14, y);
    y += 7;

    const colPeriod = 14;
    const colCapital = 95;
    const colInterest = 135;
    const colSub = 175;

    doc.setFillColor(...BRAND.green);
    doc.roundedRect(14, y - 4.2, pageW - 28, 7, 1.5, 1.5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('Período', colPeriod + 1.5, y);
    doc.text('Capital', colCapital, y, { align: 'right' });
    doc.text('Intereses', colInterest, y, { align: 'right' });
    doc.text('Subtotal', colSub, y, { align: 'right' });
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(25, 25, 25);

    if (!months.length) {
      doc.text('Sin períodos imputados: el saldo queda sin desglose mes a mes.', 14, y);
      y += 7;
    } else {
      for (const row of months) {
        if (y > 270) {
          drawReportFooter(doc);
          doc.addPage();
          y = drawReportHeader(doc, {
            title: 'Consulta de deuda · Cuota social (cont.)',
            subtitle: `${name} · Nº ${nro}`,
            metaLine: `Al ${asOfLabel}`,
            logoDataUrl,
          }) + 4;
        }
        const cap = money(row.capital);
        const int = money(row.interest);
        const sub = money(cap + int);
        doc.text(String(row.periodLabel || row.periodKey || '—'), colPeriod, y);
        doc.text(formatMoney(cap), colCapital, y, { align: 'right' });
        doc.text(formatMoney(int), colInterest, y, { align: 'right' });
        doc.setFont('helvetica', 'bold');
        doc.text(formatMoney(sub), colSub, y, { align: 'right' });
        doc.setFont('helvetica', 'normal');
        y += 5.6;
      }
    }

    y += 3;
    doc.setDrawColor(...BRAND.gold);
    doc.setLineWidth(0.4);
    doc.line(14, y, pageW - 14, y);
    y += 8;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...BRAND.green);
    doc.text('Totales', 14, y);
    y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);

    const totals = [
      ['Capital de cuota social', capital],
      ['Intereses / recargo 10 %', interest],
    ];
    if (unallocated > 0.009) totals.push(['Saldo sin imputar', unallocated]);
    for (const [label, amount] of totals) {
      doc.text(label, 14, y);
      doc.text(formatMoney(amount), colSub, y, { align: 'right' });
      y += 6;
    }

    y += 2;
    doc.setFillColor(255, 245, 240);
    doc.roundedRect(14, y - 5, pageW - 28, 12, 2, 2, 'F');
    doc.setDrawColor(...BRAND.gold);
    doc.setLineWidth(0.45);
    doc.roundedRect(14, y - 5, pageW - 28, 12, 2, 2, 'S');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...BRAND.gold);
    doc.text('Total adeudado', 18, y + 2.5);
    doc.text(formatMoney(total), colSub, y + 2.5, { align: 'right' });
    y += 14;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...BRAND.muted);
    doc.text(
      'Los intereses son el recargo del 10 % de cada mes de cuota social vencido (desde el día 11). No incluyen otros cargos de cuenta.',
      14,
      y,
      { maxWidth: pageW - 28 },
    );
  }

  drawReportFooter(doc);
  const safeNro = nro.replace(/[^\w.-]+/g, '_');
  const file = `deuda-cuota-${safeNro}.pdf`;
  doc.save(file);
  return file;
}
