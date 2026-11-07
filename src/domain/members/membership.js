/** Etiqueta y antigüedad de la categoría de socio (padrón, no Gold/Platinum). */

import { isDuesExemptMember, isMemberBillingActive, isVitalicioMember } from './dues';
import { isTitularMember } from './households';

/** Años en el club para avisar el paso a socio vitalicio. */
export const VITALICIO_YEARS_ON_CLUB = 25;

/** Fallback de import / NOT NULL en joined_at: no es un alta real. */
export const PLACEHOLDER_JOIN_DATE = '1900-01-01';

export function prettyMembershipName(raw) {
  const name = String(raw || '').replace(/_/g, ' ').trim();
  if (!name) return 'Socio';
  return name.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseDay(iso) {
  const day = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function ageOn(birthIso, today = new Date()) {
  const birth = parseDay(birthIso);
  if (!birth) return null;
  const now = today instanceof Date ? today : parseDay(today) || new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now < new Date(now.getFullYear(), birth.getMonth(), birth.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

/** Alta usable para mostrar / calcular antigüedad (no el placeholder 1900 ni previa al nacimiento). */
export function isUsableJoinDate(joinDate, { birthDate } = {}) {
  const join = String(joinDate || '').slice(0, 10);
  if (!join || join <= PLACEHOLDER_JOIN_DATE) return false;
  if (!parseDay(join)) return false;
  const birth = String(birthDate || '').slice(0, 10);
  if (birth && /^\d{4}-\d{2}-\d{2}$/.test(birth) && join < birth) return false;
  return true;
}

export function effectiveJoinDate(member) {
  const join = String(member?.joinDate || '').slice(0, 10);
  if (!isUsableJoinDate(join, { birthDate: member?.birthDate })) return null;
  return join;
}

export function yearsOnClub(member, today = new Date()) {
  const now = today instanceof Date ? today : new Date(`${String(today).slice(0, 10)}T12:00:00`);
  const join = effectiveJoinDate(member);
  const rawJoin = String(member?.joinDate || '').slice(0, 10);
  let years = 0;
  if (join) {
    const started = parseDay(join);
    years = now.getFullYear() - started.getFullYear();
    if (now < new Date(now.getFullYear(), started.getMonth(), started.getDate())) years -= 1;
    years = Math.max(0, years);
  } else if (rawJoin && rawJoin <= PLACEHOLDER_JOIN_DATE) {
    // joined_at = 1900-01-01 es relleno de import: no hay alta real ni antigüedad.
    years = 0;
  } else {
    years = Math.max(0, Number(member?.yearsActive) || 0);
  }
  const age = ageOn(member?.birthDate, now);
  // No puede haber más antigüedad que edad.
  if (age != null) years = Math.min(years, age);
  return years;
}

export function formatJoinYear(joinDate, { birthDate } = {}) {
  if (!isUsableJoinDate(joinDate, { birthDate })) return null;
  const started = parseDay(joinDate);
  return started ? String(started.getFullYear()) : null;
}

/** Texto corto bajo “Ingreso al club” (años / meses / null si no hay dato). */
export function membershipTenureLabel(member, today = new Date()) {
  const now = today instanceof Date ? today : new Date(`${String(today).slice(0, 10)}T12:00:00`);
  const join = effectiveJoinDate(member);
  if (join) {
    const started = parseDay(join);
    let years = now.getFullYear() - started.getFullYear();
    const m = now.getMonth() - started.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < started.getDate())) years -= 1;
    const age = ageOn(member?.birthDate, now);
    if (age != null) years = Math.min(years, age);
    if (years <= 0) {
      let months = (now.getFullYear() - started.getFullYear()) * 12 + (now.getMonth() - started.getMonth());
      if (now.getDate() < started.getDate()) months -= 1;
      if (months <= 0) return 'Recién ingresado';
      return months === 1 ? '1 mes en el club' : `${months} meses en el club`;
    }
    return years === 1 ? '1 año de antigüedad' : `${years} años de antigüedad`;
  }
  const years = yearsOnClub(member, now);
  if (!(years > 0)) return null;
  return years === 1 ? '1 año de antigüedad' : `${years} años de antigüedad`;
}

export function membershipCaption(member, today = new Date()) {
  const years = yearsOnClub(member, today);
  if (years > 0) return `${years} año${years === 1 ? '' : 's'} en el club`;
  const since = formatJoinYear(member?.joinDate, { birthDate: member?.birthDate });
  if (since) return `Desde ${since}`;
  return 'Categoría de socio';
}

/** Titular activo que ya cumplió los años para pasar a vitalicio. */
export function shouldOfferVitalicio(member, today = new Date()) {
  const when = today instanceof Date
    ? today
    : new Date(`${String(today).slice(0, 10)}T12:00:00`);
  if (!member || !isTitularMember(member) || !isMemberBillingActive(member, when)) return false;
  if (isVitalicioMember(member) || isDuesExemptMember(member)) return false;
  return yearsOnClub(member, when) >= VITALICIO_YEARS_ON_CLUB;
}
