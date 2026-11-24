/**
 * Responsables externos (no socios): autenticados y verificados, sin ficha en members.
 */

import { validateColoniaAge } from './coloniaAge';
import { enrollmentIdentityKey, isWithinEnrollmentWindow } from './coloniaEnrollment';
import { COLONIA_SEASON_2026_2027 } from './coloniaConstants';
import { normalizeMemberKind } from './coloniaTariffs';

export function assertExternalGuardianDraft({
  fullName,
  email,
  phone,
  documentNumber,
} = {}) {
  const errors = [];
  if (!String(fullName || '').trim()) {
    errors.push({ code: 'name', message: 'Indicá el nombre del responsable.' });
  }
  const mail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
    errors.push({ code: 'email', message: 'Indicá un correo válido para verificar.' });
  }
  if (!String(phone || '').trim() && !String(documentNumber || '').trim()) {
    errors.push({ code: 'contact', message: 'Indicá teléfono o documento.' });
  }
  return {
    ok: errors.length === 0,
    errors,
    draft: {
      fullName: String(fullName || '').trim(),
      email: mail,
      phone: String(phone || '').trim() || null,
      documentNumber: String(documentNumber || '').trim() || null,
      createsMember: false,
      memberId: null,
    },
  };
}

export function canExternalGuardianOperate({ guardian, emailVerified = false } = {}) {
  if (!guardian?.id && !guardian?.profile_id && !guardian?.profileId) return false;
  const status = String(guardian.status || '').toLowerCase();
  if (status === 'suspended' || status === 'cancelled') return false;
  const verified = Boolean(
    emailVerified
    || guardian.email_verified_at
    || guardian.emailVerifiedAt
    || status === 'active',
  );
  return verified;
}

export function validateExternalEnrollmentDraft({
  student,
  guardian,
  planKey,
  season = COLONIA_SEASON_2026_2027,
  todayIso,
  existingKeys = [],
  emailVerified = false,
} = {}) {
  const errors = [];
  if (!canExternalGuardianOperate({ guardian, emailVerified })) {
    errors.push({
      code: 'email_unverified',
      message: 'Verificá el correo antes de inscribir alumnos.',
    });
  }
  if (!student?.fullName?.trim()) {
    errors.push({ code: 'student_name', message: 'Falta el nombre del alumno.' });
  }
  const age = validateColoniaAge(student?.birthDate, {
    activitiesStartOn: season?.activitiesStartOn || season?.activities_start_on,
    ageMin: season?.ageMin ?? season?.age_min ?? 3,
    ageMax: season?.ageMax ?? season?.age_max ?? 15,
  });
  if (!age.ok) errors.push(...age.errors);

  const kind = normalizeMemberKind(student?.memberKind || 'no_socio') || 'no_socio';
  if (kind !== 'no_socio') {
    errors.push({
      code: 'member_kind',
      message: 'El acceso externo solo admite tarifas de no socio. Los socios deben usar Mi cuenta.',
    });
  }
  if (!['cuota', 'temporada', 'hermano_4'].includes(String(planKey || ''))) {
    errors.push({ code: 'plan', message: 'Elegí una modalidad habilitada.' });
  }
  if (todayIso && !isWithinEnrollmentWindow(todayIso, {
    enrollmentOpensOn: season?.enrollmentOpensOn || season?.enrollment_opens_on || COLONIA_SEASON_2026_2027.enrollmentOpensOn,
    enrollmentClosesOn: season?.enrollmentClosesOn || season?.enrollment_closes_on || COLONIA_SEASON_2026_2027.enrollmentClosesOn,
  })) {
    errors.push({ code: 'window', message: 'Fuera del período de inscripción publicado.' });
  }
  const key = enrollmentIdentityKey(student);
  if (key && existingKeys.includes(key)) {
    errors.push({ code: 'duplicate', message: 'Este alumno ya tiene inscripción en la temporada.' });
  }
  return { ok: errors.length === 0, errors, identityKey: key, memberKind: 'no_socio' };
}
