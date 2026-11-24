/**
 * Corrección asistida de vínculos familiares (solo lógica de preview/validación).
 * No escribe el padrón: la persistencia va por RPC apply_family_link_change.
 *
 * Fuente de verdad: members.meta.familyPrincipalNumber (+ familyGroupName).
 * No modifica saldos, cuotas, pagos ni responsabilidad de cobro.
 */

import {
  familyPrincipalOf,
  isFamilyDependent,
  isLiveMember,
  memberNumberOf,
} from './households';

export const FAMILY_LINK_MIN_REASON = 8;

export function normalizeClubNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits || null;
}

export function currentFamilyPrincipal(member) {
  if (!member) return null;
  return familyPrincipalOf(member) || memberNumberOf(member);
}

/**
 * Detecta ciclo simple: el titular propuesto ya apunta (directo) al socio,
 * o el socio sería su propio titular.
 */
export function detectFamilyLinkCycle(memberNumber, proposedPrincipal, proposedMember) {
  const self = normalizeClubNumber(memberNumber);
  const proposed = normalizeClubNumber(proposedPrincipal);
  if (!self || !proposed) return null;
  if (self === proposed) {
    return {
      code: 'self_principal',
      severity: 'error',
      message: 'Un socio no puede quedar como titular de sí mismo por esta vía.',
    };
  }
  const proposedPointsTo = familyPrincipalOf(proposedMember);
  if (proposedPointsTo && proposedPointsTo === self) {
    return {
      code: 'circular_link',
      severity: 'error',
      message: `El titular Nº ${proposed} ya apunta a Nº ${self}. Eso formaría un ciclo.`,
    };
  }
  return null;
}

/**
 * Arma la previsualización administrativa (sin side-effects).
 */
export function buildFamilyLinkPreview({
  member,
  expectedPrincipal,
  proposedPrincipal,
  proposedMember = null,
  originHousehold = [],
  destinationHousehold = [],
  reason = '',
  ackInactiveTitular = false,
} = {}) {
  const memberId = memberNumberOf(member);
  const expected = normalizeClubNumber(expectedPrincipal)
    ?? currentFamilyPrincipal(member);
  const proposed = normalizeClubNumber(proposedPrincipal);
  const reasonText = String(reason || '').trim();
  const errors = [];
  const warnings = [];

  if (!memberId) {
    errors.push({ code: 'missing_member', message: 'Falta el socio a corregir.' });
  }
  if (!proposed) {
    errors.push({ code: 'missing_proposed', message: 'Indicá el Nº del nuevo titular.' });
  }
  if (reasonText.length < FAMILY_LINK_MIN_REASON) {
    errors.push({
      code: 'reason_too_short',
      message: `El motivo es obligatorio (mínimo ${FAMILY_LINK_MIN_REASON} caracteres).`,
    });
  }

  if (proposed && !proposedMember) {
    errors.push({
      code: 'proposed_missing',
      message: `No existe el titular Nº ${proposed} en el padrón.`,
    });
  }

  const cycle = detectFamilyLinkCycle(memberId, proposed, proposedMember);
  if (cycle) errors.push(cycle);

  if (proposedMember && !isLiveMember(proposedMember)) {
    warnings.push({
      code: 'proposed_inactive',
      message: `El titular Nº ${proposed} no está operativo. No se reactiva solo: confirmá si igual querés vincular.`,
    });
    if (!ackInactiveTitular) {
      errors.push({
        code: 'ack_inactive_required',
        message: 'Confirmá expresamente que aceptás un titular inactivo.',
      });
    }
  }

  if (expected && proposed && expected === proposed) {
    errors.push({
      code: 'no_change',
      message: 'El titular propuesto es el mismo que el actual.',
    });
  }

  const originPeople = (originHousehold || []).map((row) => ({
    memberId: memberNumberOf(row),
    name: row.name || row.full_name || '',
    status: row.status || 'active',
    role: memberNumberOf(row) === expected ? 'Titular' : 'Integrante',
  }));
  const destinationPeople = (destinationHousehold || []).map((row) => ({
    memberId: memberNumberOf(row),
    name: row.name || row.full_name || '',
    status: row.status || 'active',
    role: memberNumberOf(row) === proposed ? 'Titular' : 'Integrante',
  }));

  const wouldChange = [{
    field: 'meta.familyPrincipalNumber',
    from: expected,
    to: proposed,
  }, {
    field: 'meta.familyGroupName',
    from: member?.familyGroupName || member?.meta?.familyGroupName || null,
    to: proposedMember?.familyGroupName || proposedMember?.meta?.familyGroupName || proposedMember?.name || null,
  }];

  warnings.push({
    code: 'admin_link_only',
    message: 'Este cambio modifica el vínculo administrativo del hogar. No altera saldos, cuotas, pagos ni la responsabilidad de cobro por sí solo.',
  });

  if (!isFamilyDependent(member) && proposed && proposed !== memberId) {
    warnings.push({
      code: 'titular_becomes_dependent',
      message: 'Este socio hoy figura como titular. Al confirmar pasaría a integrante del nuevo hogar.',
    });
  }

  return {
    memberId,
    memberName: member?.name || member?.full_name || '',
    expectedPrincipal: expected,
    proposedPrincipal: proposed,
    proposedName: proposedMember?.name || proposedMember?.full_name || '',
    proposedStatus: proposedMember?.status || null,
    originHousehold: originPeople,
    destinationHousehold: destinationPeople,
    wouldChange,
    reason: reasonText,
    ackInactiveTitular: Boolean(ackInactiveTitular),
    errors,
    warnings,
    ok: errors.length === 0,
    financialNote: 'Sin impacto financiero directo: no se tocan saldos, cuotas, asientos ni reservas.',
  };
}

/** Texto corto para UI de confirmación doble. */
export function familyLinkConfirmPhrase(preview) {
  if (!preview?.proposedPrincipal) return '';
  return `Confirmo pasar a Nº ${preview.memberId} bajo el titular Nº ${preview.proposedPrincipal}`;
}

export function familyLinkMatchesConfirm(preview, typed) {
  const want = familyLinkConfirmPhrase(preview).toLowerCase().replace(/\s+/g, ' ').trim();
  const got = String(typed || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return Boolean(want) && want === got;
}
