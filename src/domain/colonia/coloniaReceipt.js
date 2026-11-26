/**
 * Comprobante de inscripción a Colonia. No es factura ni cuota social.
 */

import { coloniaMethodLabel } from './coloniaConstants';
import { loadJsPdf } from '../../lib/office';
import {
  CLUB_NAME,
  CLUB_SEDE,
  drawReportFooter,
  drawReportHeader,
  loadClubLogoDataUrl,
} from '../reports/pdfBrand';

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const PLAN_LABELS = {
  cuota: 'Mes a mes',
  temporada: 'Temporada',
  promo_2: '2 hermanos',
  promo_3: '3 hermanos',
  hermano_4: '4º hermano',
};

export function coloniaPlanLabel(planKey) {
  return PLAN_LABELS[planKey] || String(planKey || 'Plan');
}

export function coloniaPlanIsPromo(planKey) {
  return planKey === 'promo_2' || planKey === 'promo_3' || planKey === 'hermano_4';
}

export function coloniaReceiptMonthLabel(planKey, when = new Date()) {
  if (planKey === 'temporada') return 'Temporada 2026/2027';
  const date = when instanceof Date ? when : new Date(when);
  const month = MONTHS[date.getMonth()] || '';
  const titled = month ? month.charAt(0).toUpperCase() + month.slice(1) : '—';
  return `${titled} de ${date.getFullYear()}`;
}

function money(n) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

function pupilName(pupil) {
  return String(pupil?.fullName || pupil?.full_name || '').trim() || 'Alumno';
}

/** Detalle imprimible de una inscripción ya cobrada. */
export function buildColoniaEnrollmentReceipt({
  pupils = [],
  planKey = 'cuota',
  memberKind = 'socio',
  inscriptionAmount = 0,
  planAmount = 0,
  interestAmount = 0,
  socioName = '',
  socioNumber = '',
  method = 'efectivo',
  paymentStatus = 'confirmed',
  when = new Date(),
} = {}) {
  const month = coloniaReceiptMonthLabel(planKey, when);
  const promo = coloniaPlanIsPromo(planKey);
  const planLabel = coloniaPlanLabel(planKey);
  const names = (pupils || []).map(pupilName).filter(Boolean);
  const inscription = planKey === 'hermano_4' ? 0 : Math.round(Number(inscriptionAmount) || 0);
  const plan = Math.round(Number(planAmount) || 0);
  const interest = Math.round(Number(interestAmount) || 0);
  const lines = [];
  for (const name of names) {
    if (inscription > 0) {
      lines.push({
        concept: 'Inscripción',
        detail: 'Incluye remera',
        alumno: name,
        mes: month,
        amount: inscription,
      });
    }
  }
  if (plan > 0) {
    lines.push({
      concept: promo ? 'Promoción' : (planKey === 'temporada' ? 'Temporada' : 'Cuota Colonia'),
      detail: planLabel,
      alumno: names.join(', ') || '—',
      mes: month,
      amount: plan,
    });
  }
  if (interest > 0) {
    lines.push({
      concept: 'Interés',
      detail: '15 % por pago de la cuota después del 10',
      alumno: names.join(', ') || '—',
      mes: month,
      amount: interest,
    });
  }
  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  const isSocio = memberKind !== 'no_socio';
  return {
    club: CLUB_NAME,
    concept: 'Colonia de Verano',
    fiscalNote: 'Recibo interno de Colonia. No es la cuota social ni una factura.',
    alumnos: names,
    socioName: String(socioName || '').trim() || '—',
    socioNumber: isSocio ? (String(socioNumber || '').replace(/\D/g, '').replace(/^0+/, '') || '—') : '—',
    socioKind: isSocio ? 'Socio' : 'No socio',
    month,
    planKey,
    planLabel,
    promo,
    promoLabel: promo ? `Sí · ${planLabel}` : 'No',
    method: coloniaMethodLabel(method),
    methodKey: method,
    paymentStatus,
    paymentLabel: paymentStatus === 'confirmed' ? 'Acreditado' : 'Pendiente de confirmar',
    lines,
    total,
    when,
  };
}

function fileSlug(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export function coloniaEnrollmentReceiptFileName(receipt) {
  const who = fileSlug(receipt?.alumnos?.[0] || 'alumno');
  const number = fileSlug(receipt?.socioNumber || 's-n');
  const day = receipt?.when instanceof Date
    ? `${receipt.when.getFullYear()}${String(receipt.when.getMonth() + 1).padStart(2, '0')}${String(receipt.when.getDate()).padStart(2, '0')}`
    : 'hoy';
  return `comprobante-colonia-${number}-${who}-${day}.pdf`;
}

export async function downloadColoniaEnrollmentReceipt(receipt) {
  if (!receipt?.lines?.length) throw new Error('No hay detalle para el comprobante.');
  const [{ jsPDF }, logoDataUrl] = await Promise.all([
    loadJsPdf(),
    loadClubLogoDataUrl(),
  ]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const startY = drawReportHeader(doc, {
    title: 'Comprobante de Colonia',
    subtitle: `${CLUB_NAME} · ${CLUB_SEDE}`,
    metaLine: `${receipt.concept} · ${receipt.month}`,
    logoDataUrl,
  });

  let y = startY + 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(9, 103, 85);
  doc.text(money(receipt.total), 14, y);
  y += 8;

  const facts = [
    ['Colonia', receipt.concept],
    ['Mes', receipt.month],
    ['Alumno', receipt.alumnos.join(', ') || '—'],
    ['Socio', receipt.socioName],
    ['Nº de socio', receipt.socioNumber],
    ['Condición', receipt.socioKind],
    ['Promoción', receipt.promoLabel],
    ['Plan', receipt.planLabel],
    ['Método de pago', receipt.method],
    ['Estado del pago', receipt.paymentLabel],
    ['Importe', money(receipt.total)],
  ];

  for (const [label, value] of facts) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.text(`${label.toUpperCase()}:`, 16, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 30, 30);
    const lines = doc.splitTextToSize(String(value || '—'), 120);
    doc.text(lines, 62, y);
    y += Math.max(6.2, lines.length * 4.6);
  }

  y += 3;
  doc.setDrawColor(9, 103, 85);
  doc.setLineWidth(0.3);
  doc.line(14, y, 196, y);
  y += 7;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(9, 103, 85);
  doc.text('Detalle', 14, y);
  y += 6;

  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  doc.text('CONCEPTO', 16, y);
  doc.text('ALUMNO', 62, y);
  doc.text('MES', 120, y);
  doc.text('IMPORTE', 196, y, { align: 'right' });
  y += 4;
  doc.line(14, y, 196, y);
  y += 5;

  for (const line of receipt.lines) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(30, 30, 30);
    doc.text(line.concept, 16, y);
    doc.setFont('helvetica', 'normal');
    const alumno = doc.splitTextToSize(line.alumno, 54);
    doc.text(alumno, 62, y);
    doc.text(line.mes, 120, y);
    doc.text(money(line.amount), 196, y, { align: 'right' });
    if (line.detail) {
      y += 4.2;
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(line.detail, 16, y);
    }
    y += Math.max(6.5, alumno.length * 4.4);
  }

  y += 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(9, 103, 85);
  doc.text(`Total ${money(receipt.total)}`, 196, y, { align: 'right' });
  y += 10;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text(receipt.fiscalNote, 14, y, { maxWidth: 180 });

  drawReportFooter(doc);
  doc.save(coloniaEnrollmentReceiptFileName(receipt));
  return receipt;
}
