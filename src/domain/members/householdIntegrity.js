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

/** Categoría de integrante del hogar. No incluye al socio familiar que abona. */
function isIntegranteCategory(member) {
  const tier = String(member?.tier || '').trim().toLowerCase();
  return tier.startsWith('grupo_familiar') || tier.includes('grupo_familiar');
}

function canonicalMemberId(member) {
  return canonicalNumber(memberNumberOf(member));
}

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

function canonicalNumber(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? String(n) : null;
}

function findByNumber(rows, number) {
  const key = canonicalNumber(number);
  if (!key) return null;
  return (rows || []).find((row) => canonicalMemberId(row) === key) || null;
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
    } else if (titularInHousehold && isFamilyDependent(titularInHousehold)) {
      warnings.push({
        code: 'dependent_points_to_dependent',
        severity: 'error',
        message: `El Nº ${principal} no es titular: también es integrante de otro grupo.`,
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
  } else if (isIntegranteCategory(member)) {
    warnings.push(dependents.length ? {
      code: 'integrante_como_titular',
      severity: 'warn',
      message: `La categoría es de integrante y esta ficha figura como titular de ${dependents.length} persona${dependents.length === 1 ? '' : 's'}.`,
      memberId: selfId,
      principalNumber: principal,
    } : {
      code: 'integrante_sin_vinculo',
      severity: 'error',
      message: 'La categoría es de integrante y la ficha no tiene titular.',
      memberId: selfId,
      principalNumber: principal,
    });
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
 * Escaneo del padrón recibido.
 * En cloud hay que pasarle activos e inactivos: si falta el titular,
 * un integrante activo se leería como vínculo inexistente.
 * No muta ni inventa relaciones: solo reporta.
 */
export function scanPadronHouseholdIssues(members = []) {
  const list = Array.isArray(members) ? members : [];
  const byNumber = new Map();
  const dependentsByPrincipal = new Map();
  for (const row of list) {
    const id = canonicalMemberId(row);
    if (id) byNumber.set(id, row);
    if (!isFamilyDependent(row)) continue;
    const principal = familyPrincipalOf(row);
    if (!principal) continue;
    const bucket = dependentsByPrincipal.get(principal);
    if (bucket) bucket.push(row);
    else dependentsByPrincipal.set(principal, [row]);
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
    const id = canonicalMemberId(row);
    if (!id) continue;
    const memberName = row.name || row.full_name || '';

    if (isFamilyDependent(row)) {
      const principal = familyPrincipalOf(row);
      if (!principal) continue;
      const titular = byNumber.get(principal);
      if (!titular) {
        push({
          code: 'dependent_missing_titular',
          severity: 'error',
          message: `Nº ${id} apunta al Nº ${principal}, que no está en el padrón.`,
          memberId: id,
          memberName,
          principalNumber: principal,
        });
      } else if (isFamilyDependent(titular)) {
        push({
          code: 'dependent_points_to_dependent',
          severity: 'error',
          message: `Nº ${id} apunta al Nº ${principal}, que también es integrante de otro grupo.`,
          memberId: id,
          memberName,
          principalNumber: principal,
          principalName: titular.name || titular.full_name || '',
        });
      } else if (!isLiveMember(titular) && isLiveMember(row)) {
        push({
          code: 'inactive_titular_active_dependent',
          severity: 'warn',
          message: `Nº ${id} sigue activo y el titular Nº ${principal} no está operativo.`,
          memberId: id,
          memberName,
          principalNumber: principal,
          principalName: titular.name || titular.full_name || '',
        });
      }
    } else {
      const dependents = dependentsByPrincipal.get(id) || [];
      if (!isLiveMember(row) && dependents.some((d) => isLiveMember(d))) {
        const activeCount = dependents.filter((d) => isLiveMember(d)).length;
        push({
          code: 'inactive_titular_active_dependents',
          severity: 'warn',
          message: `Titular Nº ${id} no está operativo y tiene ${activeCount} integrante${activeCount === 1 ? '' : 's'} activo${activeCount === 1 ? '' : 's'}.`,
          memberId: id,
          memberName,
          principalNumber: id,
        });
      }
      if (isIntegranteCategory(row)) {
        push(dependents.length ? {
          code: 'integrante_como_titular',
          severity: 'warn',
          message: `Nº ${id} tiene categoría de integrante y figura como titular de ${dependents.length} persona${dependents.length === 1 ? '' : 's'}.`,
          memberId: id,
          memberName,
          principalNumber: id,
        } : {
          code: 'integrante_sin_vinculo',
          severity: 'error',
          message: `Nº ${id} tiene categoría de integrante y no tiene titular.`,
          memberId: id,
          memberName,
          principalNumber: id,
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
      group.map((row) => familyPrincipalOf(row) || canonicalMemberId(row)).filter(Boolean),
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
  dependent_points_to_dependent: 'El vínculo no es un titular',
  inactive_titular_active_dependent: 'Titular no operativo / integrante activo',
  inactive_titular_active_dependents: 'Titular no operativo con familia activa',
  integrante_sin_vinculo: 'Categoría de integrante sin titular',
  integrante_como_titular: 'Categoría de integrante y figura como titular',
  mixed_principals_in_household: 'Titulares mezclados en el hogar',
  same_document_multiple_households: 'Mismo DNI en varias familias',
  duplicate_document: 'Documento duplicado',
  ficha_incomplete: 'Ficha incompleta',
};
