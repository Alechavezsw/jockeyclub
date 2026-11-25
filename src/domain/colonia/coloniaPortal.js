/**
 * Portal del socio / responsables — Colonia independiente de cuota social.
 */

import { COLONIA_SEASON_2026_2027 } from './coloniaConstants';
import { validateColoniaAge } from './coloniaAge';
import {
  COLONIA_OFFICIAL_TARIFFS_2026_2027,
  evaluatePromotionCharge,
  normalizeMemberKind,
  planAmountFor,
} from './coloniaTariffs';
import { coloniaNextMonthLabel } from './coloniaLedger';
import { enrollmentIdentityKey, isWithinEnrollmentWindow } from './coloniaEnrollment';

/** Estados UI ↔ CHECK de colonia_enrollments (tras migración 170000). */
export const COLONIA_PORTAL_STATUS_LABELS = Object.freeze({
  borrador: 'Borrador',
  pendiente: 'Pendiente de validación',
  pendiente_pago: 'Pendiente de pago',
  confirmada: 'Confirmada',
  observada: 'Observada',
  cancelada: 'Cancelada',
});

export const COLONIA_SOURCE_LABELS = Object.freeze({
  admin: 'Administración',
  portal: 'Portal del socio',
  external: 'Solicitud externa',
});

/** Planes comerciales claros para portal (sin promo_2/promo_3 hasta periodicidad). */
export const COLONIA_PORTAL_PLAN_KEYS = Object.freeze(['cuota', 'temporada', 'hermano_4']);

export function coloniaStatusLabel(status) {
  const key = String(status || '').toLowerCase();
  return COLONIA_PORTAL_STATUS_LABELS[key] || key || '—';
}

/**
 * Estado operativo para listados: si el saldo ya está cubierto,
 * no seguir mostrando «Pendiente de pago».
 */
export function coloniaOperationalStatus(enrollment, summary = null) {
  const status = String(enrollment?.status || '').toLowerCase();
  if (status === 'cancelada') return 'cancelada';
  const settled = Boolean(
    summary?.isSettled
    || (
      summary
      && Number(summary.balanceDue) <= 0
      && Number(summary.pendingConfirmation || 0) <= 0
    ),
  );
  if (
    settled
    && ['borrador', 'pendiente', 'pendiente_pago', 'observada'].includes(status)
  ) {
    return 'confirmada';
  }
  return status || '—';
}

export function coloniaSourceLabel(source) {
  const key = String(source || 'admin').toLowerCase();
  return COLONIA_SOURCE_LABELS[key] || key;
}

export function coloniaEnrollmentBalance(row = {}) {
  const charges = Number(row.charges_total ?? row.chargesTotal ?? 0) || 0;
  const paid = Number(row.payments_confirmed ?? row.paymentsConfirmed ?? 0) || 0;
  const pending = Number(row.payments_pending ?? row.paymentsPending ?? 0) || 0;
  const balance = Math.round((charges - paid) * 100) / 100;
  return {
    charges,
    paid,
    pending,
    balance,
    paymentLabel: balance <= 0 && pending <= 0
      ? 'Al día'
      : pending > 0
        ? 'Pago en verificación'
        : 'Saldo pendiente',
  };
}

/**
 * Planes habilitados en portal: solo con regla completa (sin promo hermanos ambigua).
 */
export function portalEnabledPlans(season = COLONIA_SEASON_2026_2027) {
  const periodicity = season?.promotionPeriodicity ?? season?.promotion_periodicity ?? null;
  if (periodicity) {
    return ['cuota', 'temporada', 'promo_2', 'promo_3', 'hermano_4'];
  }
  return [...COLONIA_PORTAL_PLAN_KEYS];
}

function canonicalMemberNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.replace(/^0+/, '') || '0';
}

export function matchHouseholdToEnrollment(householdMember, enrollments = []) {
  const mid = householdMember?.id || householdMember?.memberId;
  const number = canonicalMemberNumber(householdMember?.memberId || householdMember?.member_number);
  const name = String(householdMember?.name || householdMember?.full_name || '').trim().toLowerCase();
  for (const row of enrollments) {
    const sid = row.student_member_id || row.studentMemberId || row.student?.member_id;
    const snum = canonicalMemberNumber(row.student_member_number || row.student?.member_number);
    const sname = String(row.student_name || row.student?.full_name || '').trim().toLowerCase();
    if (mid && sid && String(mid) === String(sid)) return row;
    if (number && snum && number === snum) return row;
    if (name && sname && name === sname) return row;
  }
  return null;
}

export function coloniaBadgeForHouseholdMember(householdMember, enrollments = [], season = COLONIA_SEASON_2026_2027) {
  const age = validateColoniaAge(householdMember?.birthDate || householdMember?.birth_date, {
    activitiesStartOn: season?.activitiesStartOn || season?.activities_start_on || COLONIA_SEASON_2026_2027.activitiesStartOn,
    ageMin: season?.ageMin ?? season?.age_min ?? 3,
    ageMax: season?.ageMax ?? season?.age_max ?? 15,
  });
  const enrollment = matchHouseholdToEnrollment(householdMember, enrollments);
  if (enrollment) {
    return {
      key: 'enrolled',
      label: coloniaStatusLabel(enrollment.status),
      tone: enrollment.status === 'confirmada' ? 'ok' : enrollment.status === 'cancelada' ? 'muted' : 'warn',
      enrollment,
      eligible: age.ok,
    };
  }
  if (!age.ok) {
    return { key: 'out_of_age', label: 'Fuera de edad Colonia', tone: 'muted', enrollment: null, eligible: false };
  }
  return { key: 'none', label: 'Sin inscripción', tone: 'muted', enrollment: null, eligible: true };
}

/**
 * Validación del wizard portal (pasos 1–10). No persiste.
 */
export function validatePortalEnrollmentWizard({
  step,
  student,
  guardian,
  planKey,
  season = COLONIA_SEASON_2026_2027,
  todayIso,
  authorized = true,
  existingKeys = [],
} = {}) {
  const errors = [];
  const kind = normalizeMemberKind(student?.memberKind || student?.member_kind || 'socio');

  if (step >= 1) {
    if (!student?.fullName?.trim()) errors.push({ code: 'student_name', message: 'Seleccioná o cargá el alumno.' });
  }
  if (step >= 2) {
    const age = validateColoniaAge(student?.birthDate, {
      activitiesStartOn: season?.activitiesStartOn || season?.activities_start_on,
      ageMin: season?.ageMin ?? season?.age_min ?? 3,
      ageMax: season?.ageMax ?? season?.age_max ?? 15,
    });
    if (!age.ok) errors.push(...age.errors);
  }
  if (step >= 3) {
    if (!authorized) {
      errors.push({ code: 'not_authorized', message: 'No tenés autorización para inscribir a este menor.' });
    }
    if (!guardian?.fullName?.trim()) {
      errors.push({ code: 'guardian_name', message: 'Confirmá el responsable legal.' });
    }
  }
  if (step >= 4 && !String(guardian?.emergencyContact || guardian?.emergency_contact || '').trim()) {
    errors.push({ code: 'emergency', message: 'Indicá un contacto de emergencia.' });
  }
  if (step >= 5 && !String(guardian?.authorizedPickup || guardian?.authorized_pickup || '').trim()) {
    errors.push({ code: 'pickup', message: 'Indicá quiénes pueden retirar al alumno.' });
  }
  if (step >= 6 && !String(student?.shirtSize || student?.shirt_size || '').trim()) {
    errors.push({ code: 'shirt', message: 'Indicá el talle de remera.' });
  }
  if (step >= 8) {
    const plans = portalEnabledPlans(season);
    if (!plans.includes(String(planKey || ''))) {
      errors.push({ code: 'plan', message: 'Elegí una modalidad comercial habilitada.' });
    } else {
      const promo = evaluatePromotionCharge({
        planKey,
        season: {
          ...COLONIA_SEASON_2026_2027,
          promotionPeriodicity: season?.promotionPeriodicity ?? season?.promotion_periodicity ?? null,
        },
        siblingCount: 1,
        memberKinds: [kind],
      });
      errors.push(...promo.errors);
    }
  }
  if (step >= 9 && todayIso && !isWithinEnrollmentWindow(todayIso, {
    enrollmentOpensOn: season?.enrollmentOpensOn || season?.enrollment_opens_on || COLONIA_SEASON_2026_2027.enrollmentOpensOn,
    enrollmentClosesOn: season?.enrollmentClosesOn || season?.enrollment_closes_on || COLONIA_SEASON_2026_2027.enrollmentClosesOn,
  })) {
    errors.push({ code: 'window', message: 'Fuera del período de inscripción publicado.' });
  }
  const key = enrollmentIdentityKey(student);
  if (key && existingKeys.includes(key)) {
    errors.push({ code: 'duplicate', message: 'Este alumno ya tiene una inscripción en la temporada.' });
  }
  return { ok: errors.length === 0, errors, identityKey: key };
}

/** Copy pública de la temporada (sin hardcodear montos: se pasan desde tarifas). */
export function coloniaPortalHeroCopy(season = COLONIA_SEASON_2026_2027, tariffs = []) {
  const inscription = tariffs.find((t) => t.concept === 'colonia_inscripcion' || t.plan_key === 'inscripcion');
  return {
    title: season?.name || COLONIA_SEASON_2026_2027.name,
    enrollmentWindow: `Inscripciones del ${formatIsoDate(season?.enrollmentOpensOn || season?.enrollment_opens_on)} al ${formatIsoDate(season?.enrollmentClosesOn || season?.enrollment_closes_on)}.`,
    start: `Inicio: ${formatIsoDate(season?.activitiesStartOn || season?.activities_start_on)}.`,
    ages: `Edades: ${season?.ageMin ?? season?.age_min ?? 3} a ${season?.ageMax ?? season?.age_max ?? 15} años.`,
    schedule: 'Lunes a viernes · 09:00 a 13:00.',
    activities: 'Natación, recreación, excursiones y campamentos.',
    inscriptionNote: inscription
      ? `Inscripción individual de $${Number(inscription.amount).toLocaleString('es-AR')}, con remera.`
      : 'Consultá la inscripción vigente (incluye remera).',
  };
}

function formatIsoDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  if (!y || !m || !d) return String(iso);
  return `${d}/${m}/${y}`;
}

/** Lo que el socio ve en la app: su saldo, lo pagado y la cuota del mes que viene. */
export function buildMemberColoniaHome(enrollments = [], tariffs = COLONIA_OFFICIAL_TARIFFS_2026_2027) {
  const mine = (enrollments || []).map((row) => {
    const bal = coloniaEnrollmentBalance(row);
    const monthly = row.plan_key === 'cuota' || row.planKey === 'cuota';
    const kind = row.student?.member_kind || row.student?.memberKind || 'socio';
    const nextAmount = monthly && bal.balance <= 0
      ? (Number(planAmountFor(tariffs, kind, 'cuota')) || 0)
      : 0;
    return { row, bal, nextAmount };
  });
  return {
    dueTotal: mine.reduce((sum, item) => sum + Math.max(0, item.bal.balance), 0),
    paidTotal: mine.reduce((sum, item) => sum + item.bal.paid, 0),
    nextLabel: coloniaNextMonthLabel(),
    mine,
    statusParts: [
      { label: 'Confirmadas', value: (enrollments || []).filter((row) => row.status === 'confirmada').length },
      { label: 'Pendientes', value: (enrollments || []).filter((row) => ['pendiente', 'pendiente_pago', 'observada'].includes(row.status)).length },
      { label: 'Canceladas', value: (enrollments || []).filter((row) => row.status === 'cancelada').length },
    ],
  };
}

export function buildPortalEnrollmentPayload({
  seasonId,
  student,
  guardian,
  planKey,
  memberId,
  idempotencyKey,
}) {
  return {
    seasonId,
    planKey,
    memberId,
    idempotencyKey: idempotencyKey || null,
    student: {
      full_name: String(student.fullName || '').trim(),
      document_number: String(student.documentNumber || '').trim() || null,
      birth_date: student.birthDate || null,
      member_kind: normalizeMemberKind(student.memberKind) || 'socio',
      member_id: student.memberUuid || student.id || null,
      member_number: canonicalMemberNumber(student.memberNumber || student.memberId) || null,
      shirt_size: String(student.shirtSize || '').trim() || null,
      identity_key: enrollmentIdentityKey(student),
    },
    guardian: {
      full_name: String(guardian.fullName || '').trim(),
      document_number: String(guardian.documentNumber || '').trim() || null,
      relationship: String(guardian.relationship || 'Responsable').trim(),
      phone: String(guardian.phone || '').trim() || null,
      email: String(guardian.email || '').trim() || null,
      emergency_contact: String(guardian.emergencyContact || '').trim() || null,
      authorized_pickup: String(guardian.authorizedPickup || '').trim() || null,
    },
  };
}
