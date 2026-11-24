/**
 * Diagnóstico de ficha y grupo familiar (solo lectura).
 * No reasigna vínculos ni inventa relaciones: detecta inconsistencias
 * para que Administración las revise a mano.
 */

import {
  familyPrincipalOf,
  isFamilyDependent,
  isFamilyGroupVisibleMember,
  isLiveMember,
  memberNumberOf,
} from './households';

/** Campos mínimos de una ficha usable en administración / portal. */
export const FICHA_REQUIRED_FIELDS = [
  { key: 'documentNumber', label: 'Documento', severity: 'warn' },
  { key: 'email', label: 'Email', severity: 'warn' },
  { key: 'phone', label: 'Teléfono', severity: 'info' },
  { key: 'joinDate', label: 'Fecha de ingreso', severity: 'info' },
  { key: 'birthDate', label: 'Fecha de nacimiento', severity: 'info' },
];

function fieldValue(member, key) {
  if (!member) return '';
  if (key === 'documentNumber') {
    return String(member.documentNumber || member.document_number || '').replace(/\D/g, '');
  }
  if (key === 'joinDate') {
    return String(member.joinDate || member.joined_at || member.meta?.joinDate || '').trim();
  }
  if (key === 'birthDate') {
    return String(member.birthDate || member.birth_date || '').trim();
  }
  if (key === 'email') return String(member.email || '').trim();
  if (key === 'phone') {
    return String(member.phone || member.phoneAlt || '').replace(/\D/g, '');
  }
  return String(member[key] || '').trim();
}

/** Huecos de ficha del socio (sin inventar datos). */
export function memberFichaGaps(member) {
  if (!member) return [];
  return FICHA_REQUIRED_FIELDS
    .filter((field) => !fieldValue(member, field.key))
    .map((field) => ({
      code: `missing_${field.key}`,
      field: field.key,
      label: field.label,
      severity: field.severity,
      message: `Falta ${field.label.toLowerCase()}.`,
    }));
}

function findByNumber(rows, number) {
  const key = String(number || '').replace(/\D/g, '');
  if (!key) return null;
  return (rows || []).find((row) => memberNumberOf(row) === key) || null;
}

/**
 * Salud del hogar en la ficha abierta.
 * `householdRows` debe venir del RPC / listHouseholdByPrincipal (fuente de verdad).
 */
export function assessHouseholdIntegrity({ member, householdRows = [] } = {}) {
  const warnings = [];
  const gaps = memberFichaGaps(member);
  if (!member) {
    return { warnings, gaps, ok: true };
  }

  const selfId = memberNumberOf(member);
  const principal = familyPrincipalOf(member) || selfId;
  const rows = Array.isArray(householdRows) ? householdRows : [];
  const titularInHousehold = findByNumber(rows, principal);
  const dependents = rows.filter((row) => {
    const id = memberNumberOf(row);
    return id && id !== principal && isFamilyGroupVisibleMember(row);
  });

  if (isFamilyDependent(member)) {
    if (!titularInHousehold && principal) {
      warnings.push({
        code: 'dependent_missing_titular',
        severity: 'error',
        message: `Integrante sin titular en el padrón (Nº ${principal}). Revisar vínculo antes de cobrar o reservar.`,
        memberId: selfId,
        principalNumber: principal,
      });
    } else if (titularInHousehold && !isLiveMember(titularInHousehold) && isLiveMember(member)) {
      warnings.push({
        code: 'inactive_titular_active_dependent',
        severity: 'warn',
        message: `El titular Nº ${principal} no está operativo y este integrante sigue activo.`,
        memberId: selfId,
        principalNumber: principal,
      });
    }
  } else if (dependents.length) {
    if (!isLiveMember(member)) {
      const activeDeps = dependents.filter((row) => isLiveMember(row));
      if (activeDeps.length) {
        warnings.push({
          code: 'inactive_titular_active_dependents',
          severity: 'warn',
          message: `Titular inactivo con ${activeDeps.length} integrante${activeDeps.length === 1 ? '' : 's'} activo${activeDeps.length === 1 ? '' : 's'}.`,
          memberId: selfId,
          principalNumber: principal,
        });
      }
    }
  }

  const mismatchedPrincipal = rows.filter((row) => {
    if (!isFamilyDependent(row)) return false;
    const p = familyPrincipalOf(row);
    return p && p !== principal;
  });
  if (mismatchedPrincipal.length) {
    warnings.push({
      code: 'mixed_principals_in_household',
      severity: 'error',
      message: 'Hay integrantes con otro número de titular en el mismo hogar cargado. No reasignar sin evidencia.',
      memberId: selfId,
      principalNumber: principal,
    });
  }

  return {
    warnings,
    gaps,
    ok: !warnings.some((w) => w.severity === 'error') && !gaps.some((g) => g.severity === 'warn'),
  };
}

function documentKey(member) {
  return String(member?.documentNumber || member?.document_number || '').replace(/\D/g, '');
}

/**
 * Escaneo del padrón ya hidratado (lista en memoria / búsqueda).
 * No muta ni inventa relaciones: solo reporta.
 */
export function scanPadronHouseholdIssues(members = []) {
  const list = Array.isArray(members) ? members : [];
  const byNumber = new Map();
  for (const row of list) {
    const id = memberNumberOf(row);
    if (id) byNumber.set(id, row);
  }

  const issues = [];
  const seen = new Set();

  const push = (issue) => {
    const key = [
      issue.code,
      issue.memberId || '',
      issue.principalNumber || '',
      issue.documentNumber || '',
    ].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(issue);
  };

  for (const row of list) {
    const id = memberNumberOf(row);
    if (!id) continue;

    if (isFamilyDependent(row)) {
      const principal = familyPrincipalOf(row);
      if (!principal) continue;
      const titular = byNumber.get(principal);
      if (!titular) {
        push({
          code: 'dependent_missing_titular',
          severity: 'error',
          message: `Nº ${id} apunta a titular ${principal} que no está en el padrón cargado.`,
          memberId: id,
          memberName: row.name || row.full_name || '',
          principalNumber: principal,
        });
      } else if (!isLiveMember(titular) && isLiveMember(row)) {
        push({
          code: 'inactive_titular_active_dependent',
          severity: 'warn',
          message: `Nº ${id} activo bajo titular inactivo Nº ${principal}.`,
          memberId: id,
          memberName: row.name || row.full_name || '',
          principalNumber: principal,
          principalName: titular.name || titular.full_name || '',
        });
      }
    } else {
      const principal = familyPrincipalOf(row) || id;
      const dependents = list.filter(
        (other) => isFamilyDependent(other) && familyPrincipalOf(other) === principal,
      );
      if (!isLiveMember(row) && dependents.some((d) => isLiveMember(d))) {
        const activeCount = dependents.filter((d) => isLiveMember(d)).length;
        push({
          code: 'inactive_titular_active_dependents',
          severity: 'warn',
          message: `Titular Nº ${id} inactivo con ${activeCount} integrante${activeCount === 1 ? '' : 's'} activo${activeCount === 1 ? '' : 's'}.`,
          memberId: id,
          memberName: row.name || row.full_name || '',
          principalNumber: principal,
        });
      }
    }

    const gaps = memberFichaGaps(row).filter((g) => g.severity === 'warn');
    if (gaps.length) {
      push({
        code: 'ficha_incomplete',
        severity: 'warn',
        message: `Nº ${id}: falta ${gaps.map((g) => g.label.toLowerCase()).join(', ')}.`,
        memberId: id,
        memberName: row.name || row.full_name || '',
        gaps,
      });
    }
  }

  const byDni = new Map();
  for (const row of list) {
    const dni = documentKey(row);
    if (!dni || dni.length < 6) continue;
    if (!byDni.has(dni)) byDni.set(dni, []);
    byDni.get(dni).push(row);
  }
  for (const [dni, group] of byDni) {
    if (group.length < 2) continue;
    const principals = new Set(
      group.map((row) => familyPrincipalOf(row) || memberNumberOf(row)).filter(Boolean),
    );
    if (principals.size > 1) {
      push({
        code: 'same_document_multiple_households',
        severity: 'error',
        message: `DNI ${dni} aparece en ${group.length} fichas con titulares distintos (${[...principals].join(', ')}).`,
        documentNumber: dni,
        memberId: memberNumberOf(group[0]),
        memberName: group.map((r) => r.name || r.full_name || memberNumberOf(r)).join(' · '),
        principalNumber: [...principals][0],
      });
    } else {
      push({
        code: 'duplicate_document',
        severity: 'warn',
        message: `DNI ${dni} repetido en ${group.length} fichas.`,
        documentNumber: dni,
        memberId: memberNumberOf(group[0]),
        memberName: group.map((r) => r.name || r.full_name || memberNumberOf(r)).join(' · '),
      });
    }
  }

  const severityRank = { error: 0, warn: 1, info: 2 };
  return issues.toSorted((a, b) => {
    const sa = severityRank[a.severity] ?? 9;
    const sb = severityRank[b.severity] ?? 9;
    if (sa !== sb) return sa - sb;
    return String(a.memberId || '').localeCompare(String(b.memberId || ''), 'es');
  });
}

export function summarizeHouseholdIssues(issues = []) {
  const summary = {
    total: issues.length,
    errors: 0,
    warnings: 0,
    byCode: {},
  };
  for (const issue of issues) {
    if (issue.severity === 'error') summary.errors += 1;
    else summary.warnings += 1;
    summary.byCode[issue.code] = (summary.byCode[issue.code] || 0) + 1;
  }
  return summary;
}

/** Etiquetas cortas para la UI de administración. */
export const HOUSEHOLD_ISSUE_LABELS = {
  dependent_missing_titular: 'Integrante sin titular',
  inactive_titular_active_dependent: 'Titular inactivo / integrante activo',
  inactive_titular_active_dependents: 'Titular inactivo con familia activa',
  mixed_principals_in_household: 'Titulares mezclados en el hogar',
  same_document_multiple_households: 'Mismo DNI en varias familias',
  duplicate_document: 'Documento duplicado',
  ficha_incomplete: 'Ficha incompleta',
};
