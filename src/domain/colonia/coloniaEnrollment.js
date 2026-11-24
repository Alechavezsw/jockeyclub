/**
 * Validación de inscripción Colonia (sin side-effects).
 */

import { validateColoniaAge } from './coloniaAge';
import { COLONIA_SEASON_2026_2027 } from './coloniaConstants';
import {
  evaluatePromotionCharge,
  normalizeMemberKind,
} from './coloniaTariffs';

export function normalizeDni(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits || null;
}

export function enrollmentIdentityKey({ documentNumber, fullName, birthDate } = {}) {
  const dni = normalizeDni(documentNumber);
  if (dni) return `dni:${dni}`;
  const name = String(fullName || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const birth = String(birthDate || '').trim();
  if (name && birth) return `nb:${name}|${birth}`;
  if (name) return `n:${name}`;
  return null;
}

export function isWithinEnrollmentWindow(todayIso, season = COLONIA_SEASON_2026_2027) {
  const today = String(todayIso || '').slice(0, 10);
  const open = season?.enrollmentOpensOn;
  const close = season?.enrollmentClosesOn;
  if (!today || !open || !close) return false;
  return today >= open && today <= close;
}

export function validateEnrollmentDraft({
  student,
  guardian,
  season = COLONIA_SEASON_2026_2027,
  planKey,
  memberKind,
  siblingCount = 1,
  memberKinds = [],
  stackWithTemporada = false,
  existingKeys = [],
  todayIso,
} = {}) {
  const errors = [];
  const warnings = [];

  if (!student?.fullName?.trim()) {
    errors.push({ code: 'student_name', message: 'Falta el nombre del alumno.' });
  }
  const age = validateColoniaAge(student?.birthDate, {
    activitiesStartOn: season?.activitiesStartOn,
    ageMin: season?.ageMin ?? 3,
    ageMax: season?.ageMax ?? 15,
  });
  if (!age.ok) errors.push(...age.errors);

  const kind = normalizeMemberKind(memberKind ?? student?.memberKind);
  if (!kind) {
    errors.push({ code: 'member_kind', message: 'Indicá si el alumno es socio o no socio.' });
  }
  if (kind === 'socio' && !String(student?.memberNumber || '').replace(/\D/g, '')) {
    warnings.push({
      code: 'member_number_missing',
      message: 'Socio sin número de padrón: vincularlo ayuda a evitar duplicados, no modifica el padrón.',
    });
  }

  if (!guardian?.fullName?.trim()) {
    errors.push({ code: 'guardian_name', message: 'Falta el responsable.' });
  }
  if (!guardian?.phone?.trim() && !guardian?.email?.trim()) {
    errors.push({ code: 'guardian_contact', message: 'El responsable necesita teléfono o correo.' });
  }

  if (!planKey) {
    errors.push({ code: 'plan_required', message: 'Definí el plan contratado.' });
  } else {
    const promo = evaluatePromotionCharge({
      planKey,
      season,
      siblingCount,
      memberKinds: memberKinds.length ? memberKinds : [kind].filter(Boolean),
      stackWithTemporada,
    });
    errors.push(...promo.errors);
    warnings.push(...promo.warnings);
  }

  if (todayIso && season && !isWithinEnrollmentWindow(todayIso, season)) {
    errors.push({
      code: 'outside_enrollment_window',
      message: 'La fecha está fuera del período de inscripción publicado (incluye el cierre).',
    });
  }

  const key = enrollmentIdentityKey(student);
  if (key && (existingKeys || []).includes(key)) {
    errors.push({
      code: 'duplicate_enrollment',
      message: 'Ya hay una inscripción para este alumno en la temporada.',
    });
  }
  if (!key) {
    errors.push({
      code: 'identity_weak',
      message: 'Faltan datos para identificar al alumno (DNI o nombre + fecha de nacimiento).',
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    age: age.age,
    memberKind: kind,
    identityKey: key,
  };
}
