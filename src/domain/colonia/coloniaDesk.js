/**
 * Cortes de administración de Colonia: búsqueda, hojas de cuenta y hojas de reportes.
 * No toca cuota social.
 */

import { clubMailMemberHits, clubMailMemberQuery } from '../messaging/clubMailSearch';
import { familyPrincipalOf, memberNumberOf } from '../members/households';
import { ageYearsOn } from './coloniaAge';
import { COLONIA_PLAN_KEYS } from './coloniaConstants';

export function planChildSlots(planKey) {
  if (planKey === COLONIA_PLAN_KEYS.promo_2) return 2;
  if (planKey === COLONIA_PLAN_KEYS.promo_3) return 3;
  return 1;
}

export function memberKey(row) {
  return String(row?.memberId || row?.memberNumber || row?.id || '');
}

export function isoBirth(row) {
  const birth = String(row?.birthDate || row?.birth_date || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(birth) ? birth : '';
}

export function foldColoniaText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Padrón: número exacto (con ceros) o DNI entero. El texto no se parte para adivinar un número. */
export function coloniaSocioHits(rows, query) {
  const parsed = clubMailMemberQuery(query);
  const list = Array.isArray(rows) ? rows : [];
  const exact = clubMailMemberHits(list, query);
  if (parsed.kind !== 'number') return exact;
  const seen = new Set(exact.map((row) => String(row?.id || row?.memberId || '')));
  const byDni = list.filter((row) => {
    const key = String(row?.id || row?.memberId || '');
    if (!key || seen.has(key)) return false;
    const dni = String(row?.documentNumber || row?.dni || '').replace(/\D/g, '');
    return dni !== '' && (dni.replace(/^0+/, '') || '0') === parsed.canonical;
  });
  return [...exact, ...byDni];
}

export function enrollmentMatchesRoster(row, query) {
  const parsed = clubMailMemberQuery(query);
  if (parsed.kind === 'empty') return true;
  const student = row?.student || {};
  const guardian = row?.guardian || {};
  const memberNumber = String(student.member_number || student.memberNumber || '').trim();
  const dni = String(student.document_number || student.documentNumber || '').replace(/\D/g, '');
  if (parsed.kind === 'number') {
    const stored = /^\d+$/.test(memberNumber) ? (memberNumber.replace(/^0+/, '') || '0') : '';
    const dniCanon = dni ? (dni.replace(/^0+/, '') || '0') : '';
    return stored === parsed.canonical || dniCanon === parsed.canonical;
  }
  const needle = foldColoniaText(parsed.text);
  if (needle.length < 2) return false;
  const name = foldColoniaText(student.full_name || student.fullName);
  const guard = foldColoniaText(guardian.full_name || guardian.fullName);
  return name.includes(needle) || guard.includes(needle) || foldColoniaText(memberNumber) === needle;
}

export const COLONIA_ACCOUNT_SHEETS = Object.freeze([
  { key: 'falta', label: 'Falta pagar' },
  { key: 'proximo', label: 'Próximo mes' },
  { key: 'pagaron', label: 'Pagaron' },
  { key: 'todos', label: 'Todos' },
]);

export function coloniaAccountStatus(row) {
  if (row.status === 'falta') return 'Falta pagar';
  if (row.status === 'pendiente') return 'Pago por confirmar';
  if (row.status === 'proximo') return 'Próximo mes';
  return 'Pagó';
}

export function coloniaAccountOnSheet(row, sheet) {
  if (sheet === 'todos') return true;
  if (sheet === 'falta') return row.status === 'falta' || row.status === 'pendiente';
  if (sheet === 'pagaron') return row.status === 'pago';
  return row.status === sheet;
}

export function coloniaAccountCells(row) {
  const student = row.enrollment?.student || {};
  const guardian = row.enrollment?.guardian || {};
  return [
    student.full_name || '',
    student.member_kind === 'no_socio' ? 'No socio' : 'Socio',
    student.member_number || '',
    student.document_number || '',
    row.plan || '',
    guardian.full_name || '',
    guardian.phone || '',
    guardian.email || '',
    row.summary?.totalContracted ?? 0,
    row.summary?.totalCollected ?? 0,
    row.owed ?? 0,
    row.nextAmount > 0 ? row.nextLabel : '',
    row.nextAmount || 0,
    coloniaAccountStatus(row),
  ];
}

export const COLONIA_ACCOUNT_HEADERS = Object.freeze([
  'Alumno', 'Condición', 'Nº', 'DNI', 'Plan', 'Responsable', 'Teléfono', 'Mail',
  'Contratado', 'Cobrado', 'Falta', 'Próximo mes', 'Importe próximo', 'Estado',
]);

export const COLONIA_REPORT_SHEETS = Object.freeze([
  { key: 'resumen', label: 'Resumen' },
  { key: 'inscriptos', label: 'Inscriptos' },
  { key: 'admin', label: 'Administración' },
  { key: 'portal', label: 'Portal' },
  { key: 'externas', label: 'Externas' },
  { key: 'pendientes', label: 'Pendientes' },
  { key: 'confirmadas', label: 'Confirmadas' },
  { key: 'canceladas', label: 'Canceladas' },
  { key: 'socios', label: 'Socios' },
  { key: 'no_socios', label: 'No socios' },
]);

export const COLONIA_REPORT_HEADERS = Object.freeze([
  'Alumno', 'Condición', 'Nº', 'DNI', 'Plan', 'Estado', 'Origen', 'Responsable', 'Teléfono',
]);

export function coloniaReportRows(enrollments, sheet) {
  const rows = enrollments || [];
  if (sheet === 'admin') return rows.filter((row) => (row.source || 'admin') === 'admin');
  if (sheet === 'portal') return rows.filter((row) => row.source === 'portal');
  if (sheet === 'externas') return rows.filter((row) => row.source === 'external');
  if (sheet === 'pendientes') return rows.filter((row) => ['pendiente', 'pendiente_pago', 'observada'].includes(row.status));
  if (sheet === 'confirmadas') return rows.filter((row) => row.status === 'confirmada');
  if (sheet === 'canceladas') return rows.filter((row) => row.status === 'cancelada');
  if (sheet === 'socios') return rows.filter((row) => row.student?.member_kind !== 'no_socio');
  if (sheet === 'no_socios') return rows.filter((row) => row.student?.member_kind === 'no_socio');
  return rows;
}

export function coloniaReportCells(row) {
  const student = row.student || {};
  const guardian = row.guardian || {};
  return [
    student.full_name || '',
    student.member_kind === 'no_socio' ? 'No socio' : 'Socio',
    student.member_number || '',
    student.document_number || '',
    row.plan_key || '',
    row.status || '',
    row.source || 'admin',
    guardian.full_name || '',
    guardian.phone || '',
  ];
}

/** Hijos del grupo del socio ya elegido. No busca en el resto del padrón. */
export function householdSearchPool(household, anchor, startOn) {
  const principal = String(familyPrincipalOf(anchor) || memberNumberOf(anchor) || '');
  const sameGroup = (household || []).filter((row) => {
    const self = String(memberNumberOf(row) || '');
    const group = String(familyPrincipalOf(row) || '');
    return principal && (self === principal || group === principal);
  });
  const source = sameGroup.length ? sameGroup : (household || []);
  const kids = householdKids(source, anchor, startOn);
  if (kids.length) return kids;
  const anchorKey = memberKey(anchor);
  return source.filter((row) => {
    const key = memberKey(row);
    return key && key !== anchorKey;
  });
}

export function householdKids(list, anchor, startOn) {
  const principal = String(familyPrincipalOf(anchor) || memberNumberOf(anchor) || '');
  const others = (list || []).filter((row) => {
    const self = String(memberNumberOf(row) || '');
    return self && self !== principal;
  });
  const aged = others.filter((row) => {
    const birth = isoBirth(row);
    if (!birth || !startOn) return true;
    const age = ageYearsOn(birth, startOn);
    return age == null || (age >= 3 && age <= 15);
  });
  return aged.length ? aged : others;
}

export function coloniaReminderCopy({ name, amountLabel, nextLabel, status }) {
  const who = name || 'familia';
  if (status === 'proximo') {
    return `Hola, te saludamos del Jockey Club San Juan. En ${nextLabel} corresponde la cuota de Colonia de ${who} por ${amountLabel}. La cuenta de Colonia es aparte de la cuota social.`;
  }
  return `Hola, te saludamos del Jockey Club San Juan. Queda pendiente la cuenta de Colonia de ${who} por ${amountLabel}. Podés regularizarla en el club. La cuenta de Colonia es aparte de la cuota social.`;
}
