/**
 * Corrección asistida de vínculos familiares (solo lógica de preview/validación).
 * No escribe el padrón: la persistencia va por RPC apply_family_link_change.
 *
 * Fuente de verdad: members.meta.familyPrincipalNumber (+ familyGroupName).
 * No modifica saldos, cuotas, pagos ni responsabilidad de cobro en filas financieras.
 */

import {
  familyPrincipalOf,
  isFamilyDependent,
  isLiveMember,
  memberNumberOf,
} from './households';

export const FAMILY_LINK_MIN_REASON = 8;
/** Profundidad máxima al caminar la cadena de titulares (anti-ciclos / anti-loops). */
export const FAMILY_LINK_CYCLE_MAX_DEPTH = 16;

/**
 * Módulos que leen familyPrincipalNumber. El apply no mueve deudas/pagos/reservas;
 * los lookups futuros de “cuenta del titular” siguen el nuevo puntero (modelo de hogar).
 */
export const FAMILY_LINK_MODULE_IMPACT = Object.freeze({
  householdListing: {
    modules: ['list_household_members', 'listHouseholdByPrincipal', 'HouseholdIntegrityPanel', 'MemberProfilePanel'],
    effect: 'Reagrupa integrantes bajo el nuevo titular. Sin tocar saldos.',
    financialTransfer: false,
  },
  accountHolderLookup: {
    modules: ['billingAccountMember', 'accountHolderOf', 'memberPayments', 'seasonDuesGate', 'AccessControlView'],
    effect: 'Cobros y umbral de mora/acceso del integrante miran la ficha del titular apuntado. El saldo sigue en cada fila; no se transfieren deudas ni pagos históricos.',
    financialTransfer: false,
    futureLookupFollowsPrincipal: true,
  },
  bookings: {
    modules: ['reservations', 'MemberFacilitiesBooking', 'memberMayOperateAccount'],
    effect: 'Las reservas quedan en member_id. memberMayOperateAccount no reasigna reservas al cambiar el vínculo.',
    financialTransfer: false,
  },
  credentialsAccess: {
    modules: ['VirtualCard', 'exportCredentialPdf', 'AccessControlView'],
    effect: 'Credencial por socio. Acceso familiar puede consultar estado del titular apuntado.',
    financialTransfer: false,
  },
  debits: {
    modules: ['mpSubscribe', 'débitos automáticos'],
    effect: 'Suscripciones/débitos siguen atados al socio/cuenta ya configurada; el apply no los reescribe.',
    financialTransfer: false,
  },
  poolBenefits: {
    modules: ['poolSeasonBilling'],
    effect: 'El cupo de pileta por hogar se arma con el principal actual; no mueve cargos ya imputados.',
    financialTransfer: false,
  },
});

export function normalizeClubNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits || null;
}

export function currentFamilyPrincipal(member) {
  if (!member) return null;
  return familyPrincipalOf(member) || memberNumberOf(member);
}

/** Puntero al siguiente en la cadena; null si es raíz (sin principal o apunta a sí mismo). */
export function nextFamilyPrincipalPointer(member) {
  if (!member) return null;
  const self = memberNumberOf(member);
  const principal = familyPrincipalOf(member);
  if (!principal || !self || principal === self) return null;
  return principal;
}

/**
 * Construye un lookup número → siguiente principal a partir de una lista de fichas.
 * Devuelve undefined si el número no está en el padrón (referencia rota).
 */
export function buildPrincipalLookup(members = []) {
  const byNumber = new Map();
  for (const row of members || []) {
    const id = memberNumberOf(row);
    if (!id) continue;
    byNumber.set(id, row);
  }
  return (number) => {
    const key = normalizeClubNumber(number);
    if (!key) return null;
    if (!byNumber.has(key)) return undefined;
    return nextFamilyPrincipalPointer(byNumber.get(key));
  };
}

/**
 * Camina la cadena de titulares desde `start` con nodos visitados y tope de profundidad.
 * `lookup(number)` → next | null (raíz) | undefined (faltante).
 */
export function walkFamilyPrincipalChain(start, lookup, {
  maxDepth = FAMILY_LINK_CYCLE_MAX_DEPTH,
  seedVisited = [],
} = {}) {
  const visited = [];
  const seen = new Set();
  for (const item of seedVisited || []) {
    const key = normalizeClubNumber(item);
    if (key && !seen.has(key)) {
      seen.add(key);
      visited.push(key);
    }
  }

  let current = normalizeClubNumber(start);
  let depth = 0;
  let incomplete = false;
  let cycle = false;
  let cycleAt = null;

  while (current && depth < maxDepth) {
    if (seen.has(current)) {
      cycle = true;
      cycleAt = current;
      break;
    }
    seen.add(current);
    visited.push(current);

    if (typeof lookup !== 'function') break;
    const next = lookup(current);
    if (next === undefined) {
      incomplete = true;
      break;
    }
    if (next == null) break;
    const nextKey = normalizeClubNumber(next);
    if (!nextKey || nextKey === current) break;
    current = nextKey;
    depth += 1;
  }

  if (current && depth >= maxDepth) {
    cycle = true;
    cycleAt = current;
  }

  return {
    path: visited,
    cycle,
    cycleAt,
    incomplete,
    depth,
  };
}

/**
 * Detecta ciclo al asignar member → proposed (A→A, A↔B, A→B→C→A, …).
 * Tercer argumento: ficha del propuesto (compat). opts.lookup / opts.members para cadenas largas.
 */
export function detectFamilyLinkCycle(memberNumber, proposedPrincipal, proposedMember = null, opts = {}) {
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

  let lookup = typeof opts.lookup === 'function' ? opts.lookup : null;
  if (!lookup && Array.isArray(opts.members)) {
    lookup = buildPrincipalLookup(opts.members);
  }
  if (!lookup && proposedMember) {
    const proposedId = memberNumberOf(proposedMember) || proposed;
    const next = nextFamilyPrincipalPointer(proposedMember);
    lookup = (number) => {
      const key = normalizeClubNumber(number);
      if (key === proposedId) return next;
      return null;
    };
  }
  if (!lookup) {
    lookup = () => null;
  }

  // Tras el cambio, la cadena empieza en el propuesto y no puede volver al socio.
  const walk = walkFamilyPrincipalChain(proposed, lookup, {
    maxDepth: opts.maxDepth || FAMILY_LINK_CYCLE_MAX_DEPTH,
    seedVisited: [self],
  });

  if (walk.cycle) {
    const pathLabel = [...walk.path, walk.cycleAt].filter(Boolean).join(' → ');
    return {
      code: 'circular_link',
      severity: 'error',
      message: `Ese vínculo formaría un ciclo familiar (${pathLabel}).`,
      path: walk.path,
    };
  }

  if (walk.incomplete) {
    return {
      code: 'incomplete_chain',
      severity: 'warning',
      message: 'Hay una referencia histórica incompleta en la cadena del titular propuesto (Nº ausente en el padrón).',
      path: walk.path,
    };
  }

  return null;
}

/** El titular propuesto no puede ser integrante de otro hogar (evita cadenas A→B→C). */
export function detectProposedIsDependent(proposedMember) {
  if (!proposedMember) return null;
  if (!isFamilyDependent(proposedMember)) return null;
  const self = memberNumberOf(proposedMember);
  const principal = familyPrincipalOf(proposedMember);
  return {
    code: 'proposed_is_dependent',
    severity: 'error',
    message: `El Nº ${self} es integrante del hogar de Nº ${principal}. Indicá el titular real de ese hogar, no un integrante.`,
  };
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
  members = [],
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

  const dependentErr = detectProposedIsDependent(proposedMember);
  if (dependentErr) errors.push(dependentErr);

  const lookup = buildPrincipalLookup([
    ...(members || []),
    ...(originHousehold || []),
    ...(destinationHousehold || []),
    member,
    proposedMember,
  ].filter(Boolean));

  const cycleOrWarn = detectFamilyLinkCycle(memberId, proposed, {
    lookup,
    proposedMember,
  });
  if (cycleOrWarn?.severity === 'error') {
    errors.push(cycleOrWarn);
  } else if (cycleOrWarn?.severity === 'warning') {
    warnings.push(cycleOrWarn);
  }

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
    message: 'Este cambio modifica el vínculo administrativo del hogar. No altera saldos, cuotas, pagos ni reservas. Los cobros futuros del integrante siguen mirando la cuenta del titular apuntado (modelo de hogar).',
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
    financialNote: 'Sin impacto financiero directo: no se tocan saldos, cuotas, asientos ni reservas. No se reasignan débitos ni cargos históricos.',
    moduleImpact: FAMILY_LINK_MODULE_IMPACT,
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
