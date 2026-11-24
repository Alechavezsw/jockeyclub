/**
 * Edad de Colonia: 3 a 15 inclusive respecto del inicio de actividades.
 */

export function parseIsoDate(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

/** Edad en años cumplidos a la fecha de referencia (inicio de actividades). */
export function ageYearsOn(birthDate, referenceDate) {
  const birth = parseIsoDate(birthDate);
  const ref = parseIsoDate(referenceDate);
  if (!birth || !ref) return null;
  let age = ref.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = ref.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && ref.getUTCDate() < birth.getUTCDate())) {
    age -= 1;
  }
  return age;
}

export function validateColoniaAge(birthDate, {
  activitiesStartOn,
  ageMin = 3,
  ageMax = 15,
} = {}) {
  const age = ageYearsOn(birthDate, activitiesStartOn);
  if (age == null) {
    return { ok: false, age: null, errors: [{ code: 'birth_date_invalid', message: 'Indicá una fecha de nacimiento válida.' }] };
  }
  if (age < ageMin || age > ageMax) {
    return {
      ok: false,
      age,
      errors: [{
        code: 'age_out_of_range',
        message: `La edad debe ser de ${ageMin} a ${ageMax} años inclusive al inicio de actividades (calculada: ${age}).`,
      }],
    };
  }
  return { ok: true, age, errors: [] };
}
