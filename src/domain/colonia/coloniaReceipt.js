/**
 * Comprobante de inscripción a Colonia. No es factura ni cuota social.
 */

import { coloniaMethodLabel } from './coloniaConstants';
import { allocateColoniaPayments } from './coloniaLedger';
import {
  COLONIA_OFFICIAL_TARIFFS_2026_2027,
  inscriptionAmount,
  planAmountFor,
} from './coloniaTariffs';
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
  promo_2: '2 hermanos · temporada',
  promo_3: '3 hermanos · temporada',
  hermano_4: '4º hermano · temporada',
};

export function coloniaPlanLabel(planKey) {
  return PLAN_LABELS[planKey] || String(planKey || 'Plan');
}

export function coloniaPlanIsPromo(planKey) {
  return planKey === 'promo_2' || planKey === 'promo_3' || planKey === 'hermano_4';
}

export function coloniaReceiptMonthLabel(planKey, when = new Date()) {
  if (planKey === 'temporada' || coloniaPlanIsPromo(planKey)) return 'Temporada 2026/2027';
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
      detail: '15 % desde diciembre, cuota después del 10',
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
    /** Etiqueta de la persona a cargo: Socio solo si la ficha es de socio. */
    responsibleLabel: isSocio ? 'Socio' : 'Responsable',
    socioNumber: isSocio ? (String(socioNumber || '').replace(/\D/g, '').replace(/^0+/, '') || '—') : '',
    socioKind: isSocio ? 'Socio' : 'No socio',
    isSocio,
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

function enrollmentRowId(row) {
  return row?.enrollment_id || row?.enrollmentId || null;
}

function isConfirmedColoniaPayment(payment) {
  const status = String(payment?.status || '');
  return status === 'confirmed' || status === 'confirmado';
}

function isLiveColoniaCharge(charge) {
  return String(charge?.status || 'posted') !== 'void';
}

/**
 * Comprobante de pago acreditado: inscripción + mes/plan de esa ficha.
 * Usa cargos publicados y el último pago confirmado (método y fecha).
 */
export function buildColoniaPaidReceiptFromEnrollment({
  enrollment,
  charges = [],
  payments = [],
  tariffs = COLONIA_OFFICIAL_TARIFFS_2026_2027,
  socioName = '',
  socioNumber = '',
  when = new Date(),
} = {}) {
  if (!enrollment?.id) return null;
  const student = enrollment.student || {};
  const guardian = enrollment.guardian || {};
  const planKey = enrollment.plan_key || enrollment.planKey || 'cuota';
  const kind = student.member_kind || student.memberKind || 'socio';
  const ownCharges = (charges || []).filter(
    (charge) => enrollmentRowId(charge) === enrollment.id && isLiveColoniaCharge(charge),
  );
  const confirmed = (payments || []).filter(
    (payment) => enrollmentRowId(payment) === enrollment.id && isConfirmedColoniaPayment(payment),
  );
  if (!confirmed.length) return null;

  // Preferir lo efectivamente cobrado (inscripción y mes separables).
  const allocated = allocateColoniaPayments({ charges: ownCharges, payments: confirmed });
  let inscription = allocated
    .filter((row) => String(row.concept || '') === 'colonia_inscripcion')
    .reduce((sum, row) => sum + Math.round(Number(row.paid) || 0), 0);
  let plan = allocated
    .filter((row) => String(row.concept || '') !== 'colonia_inscripcion')
    .reduce((sum, row) => sum + Math.round(Number(row.paid) || 0), 0);
  if (!(inscription + plan > 0)) {
    inscription = ownCharges
      .filter((charge) => String(charge.concept || '') === 'colonia_inscripcion')
      .reduce((sum, charge) => sum + Math.round(Number(charge.amount) || 0), 0);
    plan = ownCharges
      .filter((charge) => String(charge.concept || '') !== 'colonia_inscripcion')
      .reduce((sum, charge) => sum + Math.round(Number(charge.amount) || 0), 0);
  }
  if (!(inscription + plan > 0)) {
    inscription = planKey === 'hermano_4' ? 0 : inscriptionAmount(tariffs);
    plan = Math.round(Number(planAmountFor(tariffs, kind, planKey)) || 0);
  }
  if (!(inscription + plan > 0)) return null;

  const latest = [...confirmed].toSorted((a, b) => String(
    b.confirmed_at || b.confirmedAt || b.created_at || b.createdAt || '',
  ).localeCompare(String(
    a.confirmed_at || a.confirmedAt || a.created_at || a.createdAt || '',
  )))[0];
  const paidAt = latest?.confirmed_at || latest?.confirmedAt || latest?.created_at || latest?.createdAt;

  return buildColoniaEnrollmentReceipt({
    pupils: [{ fullName: student.full_name || student.fullName }],
    planKey,
    memberKind: kind,
    inscriptionAmount: inscription,
    planAmount: plan,
    socioName: socioName
      || guardian.full_name
      || guardian.fullName
      || '',
    socioNumber: socioNumber
      || student.member_number
      || student.memberNumber
      || '',
    method: latest?.method || 'efectivo',
    paymentStatus: 'confirmed',
    when: paidAt ? new Date(paidAt) : when,
  });
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
    [receipt.responsibleLabel || (receipt.isSocio === false ? 'Responsable' : 'Socio'), receipt.socioName],
    ...(receipt.isSocio === false || !String(receipt.socioNumber || '').trim()
      ? []
      : [['Nº de socio', receipt.socioNumber]]),
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
