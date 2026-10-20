/** Hijos del grupo familiar: 19–25 salen si no hay certificado de regularidad. */

export const FAMILY_CHILD_OWN_TIER_FROM_AGE = 19;
export const FAMILY_CHILD_MAX_AGE = 25;

function parseDay(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function personAgeOn(birthDate, today = new Date()) {
  const born = parseDay(birthDate);
  if (!born) return null;
  const now = today instanceof Date ? today : parseDay(today) || new Date();
  let age = now.getFullYear() - born.getFullYear();
  if (
    now.getMonth() < born.getMonth()
    || (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())
  ) {
    age -= 1;
  }
  return Math.max(0, age);
}

export function regularidadCertificatesOf(person) {
  const raw = person?.regularidadCertificates
    || person?.meta?.regularidadCertificates
    || [];
  return Array.isArray(raw) ? raw.filter(Boolean) : [];
}

export function regularidadOf(person, year) {
  const y = Number(year);
  const certs = regularidadCertificatesOf(person);
  const start = certs.some((row) => Number(row.year) === y && row.term === 'start');
  const end = certs.some((row) => Number(row.year) === y && row.term === 'end');
  return { year: y, start, end, complete: start && end };
}

export function upsertRegularidad(person, { year, term, present } = {}) {
  const y = Number(year);
  const kind = term === 'end' ? 'end' : 'start';
  const rest = regularidadCertificatesOf(person).filter(
    (row) => !(Number(row.year) === y && row.term === kind),
  );
  const next = present
    ? [...rest, { year: y, term: kind, recordedAt: new Date().toISOString() }]
    : rest;
  return {
    ...person,
    regularidadCertificates: next,
  };
}

/**
 * Alumno regular: en el primer semestre alcanza el certificado de inicio;
 * desde julio hacen falta inicio y fin de año.
 */
export function hasRegularidadForYear(person, today = new Date()) {
  const now = today instanceof Date ? today : parseDay(today) || new Date();
  const cert = regularidadOf(person, now.getFullYear());
  if (now.getMonth() + 1 <= 6) return cert.start;
  return cert.complete;
}

/**
 * ok: queda en el grupo.
 * student: 19–25 con regularidad.
 * leave: hay que sacarlo (25+ o 19–25 sin certificado).
 * unknown: falta nacimiento.
 */
export function familyChildStanding(person, today = new Date()) {
  const age = personAgeOn(person?.birthDate || person?.birth_date, today);
  if (age == null) {
    return { kind: 'unknown', age: null, label: 'Sin fecha de nacimiento' };
  }
  if (age > FAMILY_CHILD_MAX_AGE) {
    return {
      kind: 'leave',
      age,
      reason: 'age26',
      label: `Cumplió ${age}: sale del grupo familiar`,
    };
  }
  if (age >= FAMILY_CHILD_OWN_TIER_FROM_AGE) {
    if (hasRegularidadForYear(person, today)) {
      return {
        kind: 'student',
        age,
        reason: 'regularidad',
        label: `Alumno regular · ${age} años`,
      };
    }
    return {
      kind: 'leave',
      age,
      reason: 'regularidad',
      label: `${age} años: falta certificado de regularidad`,
    };
  }
  return { kind: 'ok', age, label: null };
}

export function familyDependentShouldLeave(person, today = new Date()) {
  return familyChildStanding(person, today).kind === 'leave';
}
