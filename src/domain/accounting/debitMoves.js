/**
 * Altas y bajas de débitos automáticos.
 * Son los socios cuya cuota del mes en curso se descuenta por débito (Galicia / Prisma / MP).
 */

import { canChargeSocialDues } from '../members/dues';
import { allocateNextMemberNumber, isLiveMember, isTitularMember } from '../members/households';
import { isMpAdhered } from '../payments/mercadoPago';
import { todayISODateAR } from '../../lib/arDate';

export const DEBIT_MOVE_COLORS = Object.freeze({
  accent: '#5b21b6',
  alta: '#1f7a4d',
  vigente: '#5b21b6',
  pendiente: '#b45309',
  rechazado: '#c23b3b',
  baja: '#6b7280',
  exento: '#6b7280',
});

export const DEBIT_MOVE_KINDS = Object.freeze({
  vigente: { id: 'vigente', label: 'Vigente', color: DEBIT_MOVE_COLORS.vigente },
  pendiente: { id: 'pendiente', label: 'Alta pendiente', color: DEBIT_MOVE_COLORS.pendiente },
  rechazado: { id: 'rechazado', label: 'Rechazado', color: DEBIT_MOVE_COLORS.rechazado },
  baja: { id: 'baja', label: 'Baja', color: DEBIT_MOVE_COLORS.baja },
  exento: { id: 'exento', label: 'No debita cuota', color: DEBIT_MOVE_COLORS.exento },
});

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function wantsAutomaticDebit(member) {
  const raw = fold(member?.paymentMethod);
  if (raw === 'debito' || raw === 'debito_automatico' || raw === 'debito automatico' || raw === 'galicia') {
    return true;
  }
  // Etiquetas legacy / importadas
  if (raw && (raw.includes('debito automatico') || raw.includes('debito galicia'))) return true;
  if (raw && (raw === 'credito' || raw.includes('credito automatico'))) return true;
  const kind = fold(member?.meta?.automaticDebitKind || member?.automaticDebitKind || '');
  return kind === 'credito' || kind === 'debito';
}

/** Crédito (Argencard/Visa) o débito (Visa Débito) en la planilla / ficha. */
export function automaticDebitKindOf(member) {
  const raw = fold(member?.meta?.automaticDebitKind || member?.automaticDebitKind || '');
  if (raw === 'debito') return 'debito';
  if (raw === 'credito') return 'credito';
  const tipo = fold(member?.prismaTipoDebito);
  if (tipo.includes('debit')) return 'debito';
  if (tipo.includes('credit') || tipo.includes('argencard') || tipo.includes('visa')) return 'credito';
  const method = fold(member?.paymentMethod);
  if (method.includes('credito')) return 'credito';
  if (wantsAutomaticDebit(member)) return 'credito';
  return null;
}

export function mpAdhesionStatus(member) {
  return fold(member?.mpAdhesion || member?.mercadoPagoAdhesion || member?.meta?.mpAdhesion);
}

export function hasPrismaDebitCard(member) {
  const card = String(member?.prismaId || '').replace(/\D/g, '');
  return card.length === 16;
}

export function debitChannelOf(member) {
  if (isMpAdhered(member)) return 'Mercado Pago';
  if (hasPrismaDebitCard(member)) {
    const tipo = String(member?.prismaTipoDebito || '').trim();
    return tipo ? `Prisma · ${tipo}` : 'Prisma';
  }
  if (wantsAutomaticDebit(member)) return 'Galicia / ficha';
  return '—';
}

function readMoveLog(member) {
  const raw = member?.debitMoves || member?.meta?.debitMoves;
  return Array.isArray(raw) ? raw : [];
}

function withDebitMove(member, move) {
  const moves = [...readMoveLog(member), move];
  const prevMeta = member.meta && typeof member.meta === 'object' ? member.meta : {};
  return {
    ...member,
    debitMoves: moves,
    meta: { ...prevMeta, debitMoves: moves },
  };
}

function monthKeyOf(iso) {
  const raw = String(iso || '').slice(0, 10);
  return /^\d{4}-\d{2}/.test(raw) ? raw.slice(0, 7) : '';
}

export function classifyDebitMember(member, { today = todayISODateAR() } = {}) {
  const live = isLiveMember(member);
  const titular = isTitularMember(member);
  const wants = wantsAutomaticDebit(member);
  const adhered = isMpAdhered(member);
  const rejected = mpAdhesionStatus(member) === 'rejected';
  const prisma = hasPrismaDebitCard(member);
  const charges = canChargeSocialDues(member);
  const channel = debitChannelOf(member);

  let kind = DEBIT_MOVE_KINDS.baja;
  if (wants || adhered || prisma) {
    if (!charges) kind = DEBIT_MOVE_KINDS.exento;
    else if (rejected && !prisma) kind = DEBIT_MOVE_KINDS.rechazado;
    else if (adhered || prisma) kind = DEBIT_MOVE_KINDS.vigente;
    else if (wants) kind = DEBIT_MOVE_KINDS.pendiente;
  }

  return {
    memberId: String(member?.memberId || ''),
    name: member?.name || `Socio ${member?.memberId || ''}`,
    documentNumber: member?.documentNumber || '',
    paymentMethod: member?.paymentMethod || '',
    channel,
    kind: kind.id,
    kindLabel: kind.label,
    color: kind.color,
    live,
    titular,
    chargesDues: charges,
    wantsDebit: wants,
    adhered,
    rejected,
    prisma,
    balance: Number(member?.outstandingBalance) || 0,
    asOf: today,
    moves: readMoveLog(member),
  };
}

/** Padrón vivo de débitos (quien puede descontar la cuota del mes). */
export function buildDebitRoster(members = [], { today = todayISODateAR() } = {}) {
  const rows = (members || [])
    .filter((member) => isLiveMember(member) && isTitularMember(member))
    .map((member) => classifyDebitMember(member, { today }))
    .filter((row) => row.wantsDebit || row.adhered || row.prisma)
    .toSorted((a, b) => (
      String(a.name || '').localeCompare(String(b.name || ''), 'es')
      || String(a.memberId || '').localeCompare(String(b.memberId || ''))
    ));

  const summary = {
    asOf: today,
    monthKey: monthKeyOf(today),
    vigentes: rows.filter((row) => row.kind === 'vigente').length,
    pendientes: rows.filter((row) => row.kind === 'pendiente').length,
    rechazados: rows.filter((row) => row.kind === 'rechazado').length,
    exentos: rows.filter((row) => row.kind === 'exento').length,
    total: rows.length,
    chargeable: rows.filter((row) => row.kind === 'vigente' && row.chargesDues).length,
  };

  return { rows, summary };
}

/**
 * Movimientos del mes: altas/bajas registradas en meta.debitMoves,
 * más altas pendientes vivas (todavía sin adhesión).
 */
export function listDebitMoves(members = [], {
  today = todayISODateAR(),
  view = 'altas',
  query = '',
  monthKey = monthKeyOf(today),
} = {}) {
  const q = fold(query);
  const roster = buildDebitRoster(members, { today });
  const events = [];

  for (const member of members || []) {
    for (const move of readMoveLog(member)) {
      const at = String(move?.at || '').slice(0, 10);
      if (monthKey && monthKeyOf(at) !== monthKey) continue;
      const type = fold(move?.type) === 'baja' ? 'baja' : 'alta';
      events.push({
        id: `${member.memberId}-${type}-${at}-${move?.note || ''}`,
        type,
        at,
        note: move?.note || '',
        by: move?.by || '',
        channel: move?.channel || debitChannelOf(member),
        memberId: String(member.memberId || ''),
        name: member.name || `Socio ${member.memberId || ''}`,
        documentNumber: member.documentNumber || '',
        color: type === 'alta' ? DEBIT_MOVE_COLORS.alta : DEBIT_MOVE_COLORS.baja,
        kindLabel: type === 'alta' ? 'Alta' : 'Baja',
      });
    }
  }

  if (view === 'altas') {
    for (const row of roster.rows) {
      if (row.kind !== 'pendiente' && row.kind !== 'vigente') continue;
      const already = events.some((event) => (
        event.type === 'alta'
        && event.memberId === row.memberId
        && monthKeyOf(event.at) === monthKey
      ));
      if (already) continue;
      if (row.kind === 'pendiente') {
        events.push({
          id: `pending-${row.memberId}`,
          type: 'alta',
          at: today,
          note: 'Alta pendiente de adhesión',
          by: '',
          channel: row.channel,
          memberId: row.memberId,
          name: row.name,
          documentNumber: row.documentNumber,
          color: DEBIT_MOVE_COLORS.pendiente,
          kindLabel: 'Alta pendiente',
        });
      }
    }
  }

  const filtered = events
    .filter((event) => (view === 'bajas' ? event.type === 'baja' : event.type === 'alta'))
    .filter((event) => {
      if (!q) return true;
      const hay = fold([event.name, event.memberId, event.documentNumber, event.note, event.channel].join(' '));
      return hay.includes(q);
    })
    .toSorted((a, b) => (
      String(b.at || '').localeCompare(String(a.at || ''))
      || String(a.name || '').localeCompare(String(b.name || ''), 'es')
    ));

  return { rows: filtered, roster, monthKey };
}

export function filterDebitRoster(rows = [], { query = '', kind = 'all' } = {}) {
  const q = fold(query);
  return (rows || []).filter((row) => {
    if (kind && kind !== 'all' && row.kind !== kind) return false;
    if (!q) return true;
    const hay = fold([row.name, row.memberId, row.documentNumber, row.channel, row.kindLabel].join(' '));
    return hay.includes(q);
  });
}

/** Aplica baja de débito automático sobre la ficha (puro). */
export function applyDebitBaja(member, {
  today = todayISODateAR(),
  by = '',
  note = '',
  nextMethod = 'transferencia',
  listing = null,
} = {}) {
  if (!member) throw new Error('Falta el socio.');
  const next = withDebitMove(member, {
    type: 'baja',
    at: today,
    by: by || '',
    note: note || 'Baja de débito automático',
    channel: debitChannelOf(member),
    cardKind: automaticDebitKindOf(member) || listing?.cardKind || null,
    cardNumber: listing?.cardNumber || null,
    listingMemberId: listing?.memberId || null,
  });
  const prevMeta = next.meta && typeof next.meta === 'object' ? next.meta : {};
  const cardDigits = String(listing?.cardNumber || member.cardNumber || member.prismaId || '')
    .replace(/\D/g, '');
  const cardExpiry = normalizeCardExpiry(listing?.cardExpiry || member.cardExpiry || member.meta?.cardExpiry || '');
  return {
    ...next,
    paymentMethod: nextMethod || 'transferencia',
    cardNumber: cardDigits || member.cardNumber || null,
    cardExpiry: cardExpiry || null,
    automaticDebitKind: null,
    prismaTipoDebito: null,
    meta: {
      ...prevMeta,
      automaticDebitKind: null,
      prismaTipoDebito: null,
      ...(cardDigits ? { lastDebitCardNumber: cardDigits } : {}),
      ...(cardExpiry ? { cardExpiry } : {}),
    },
  };
}

/** True si el valor parece N° de tarjeta (13–19 dígitos). */
export function looksLikeCardNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 13 && digits.length <= 19;
}

/** Algoritmo de Luhn: tarjeta de crédito/débito válida. */
export function isValidCardLuhn(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** Normaliza VTO tarjeta a MM/AA. Vacío → ''. */
export function normalizeCardExpiry(value) {
  const raw = String(value || '').replace(/\D/g, '');
  if (!raw) return '';
  if (raw.length === 3) return `0${raw.slice(0, 1)}/${raw.slice(1)}`;
  if (raw.length >= 4) return `${raw.slice(0, 2)}/${raw.slice(2, 4)}`;
  return String(value || '').trim();
}

export function isValidCardExpiry(value) {
  const norm = normalizeCardExpiry(value);
  const match = /^(\d{2})\/(\d{2})$/.exec(norm);
  if (!match) return false;
  const mm = Number(match[1]);
  const yy = Number(match[2]);
  if (mm < 1 || mm > 12) return false;
  const now = new Date();
  const exp = new Date(2000 + yy, mm, 0, 23, 59, 59);
  return exp >= new Date(now.getFullYear(), now.getMonth(), 1);
}

function defaultReceipt(year, month) {
  const y = Number(year) || 0;
  const m = Number(month) || 0;
  if (!y || !m) return '';
  return `${String(m)}${y}`;
}

function defaultDueDate(year, month) {
  const y = Number(year) || 0;
  const m = Number(month) || 0;
  if (!y || !m) return '';
  return `${y}-${String(m).padStart(2, '0')}-10`;
}

function brandForCardKind(cardKind) {
  return cardKind === 'debito' ? 'VISA DEBITO' : 'ARGENCARD';
}

/** Listo para registrar alta/baja: socio + tarjeta Luhn + marca de planilla. */
export function isDebitListingDraftReady(draft) {
  const row = normalizeDebitListingDraft(draft || {});
  if (!row.memberId || !row.holderName) return false;
  if (!row.brand) return false;
  if (!row.cardNumber || !looksLikeCardNumber(row.cardNumber) || !isValidCardLuhn(row.cardNumber)) {
    return false;
  }
  if (row.cardExpiry && !isValidCardExpiry(row.cardExpiry)) return false;
  return true;
}

/** Nº de socio institucional (1–6 dígitos). Descarta IDs random tipo tarjeta. */
export function clubMemberIdOf(member, {
  members = [],
  nextMemberId = null,
} = {}) {
  const rawId = String(member?.memberId || '').replace(/\D/g, '');
  if (rawId && !looksLikeCardNumber(rawId) && rawId.length <= 6) return rawId;
  const assigned = String(nextMemberId || '').replace(/\D/g, '');
  if (assigned && !looksLikeCardNumber(assigned) && assigned.length <= 6) return assigned;
  return allocateNextMemberNumber(members);
}

/**
 * Arma el borrador de datos de planilla a partir de la ficha.
 * N° socio = correlativo de club (nunca un random de 13–19 dígitos).
 * Tarjeta = solo cardNumber / prisma / última guardada en ficha (nunca el nº de socio).
 */
export function buildDebitListingDraft(member, {
  year,
  month,
  cardKind = 'credito',
  moveType = 'alta',
  members = [],
  nextMemberId = null,
} = {}) {
  const kind = cardKind === 'debito' ? 'debito' : 'credito';
  const rawId = String(member?.memberId || '').trim();
  const memberId = clubMemberIdOf(member, { members, nextMemberId });
  const remumber = Boolean(rawId) && memberId !== String(rawId).replace(/\D/g, '');
  const cardNumber = String(
    member?.cardNumber
    || member?.prismaId
    || member?.meta?.lastDebitCardNumber
    || member?.meta?.cardNumber
    || '',
  ).replace(/\D/g, '');
  const cardExpiry = normalizeCardExpiry(
    member?.cardExpiry || member?.meta?.cardExpiry || '',
  );
  const dues = Number(member?.outstandingBalance) > 0
    ? Math.round(Number(member.outstandingBalance) * 100) / 100
    : 0;
  return {
    moveType: moveType === 'baja' ? 'baja' : 'alta',
    cardKind: kind,
    sheetKind: kind,
    brand: brandForCardKind(kind),
    year: Number(year) || 0,
    month: Number(month) || 0,
    memberId,
    remumber,
    previousMemberId: remumber ? String(rawId).replace(/\D/g, '') : null,
    holderName: String(member?.name || '').trim(),
    cardNumber,
    cardExpiry,
    cardCvv: '',
    receipt: defaultReceipt(year, month),
    dueDate: defaultDueDate(year, month),
    duesAmount: dues,
    abonoAmount: 0,
    totalAmount: dues,
    statusCode: 'N',
    note: '',
    missing: {
      memberId: !memberId,
      cardNumber: !cardNumber || !isValidCardLuhn(cardNumber),
      holderName: !String(member?.name || '').trim(),
    },
  };
}

export function normalizeDebitListingDraft(draft = {}) {
  const cardKind = draft.cardKind === 'debito' ? 'debito' : 'credito';
  const dues = Math.max(0, Number(draft.duesAmount) || 0);
  const abono = Math.max(0, Number(draft.abonoAmount) || 0);
  const total = Math.max(0, Number(draft.totalAmount) || (dues + abono));
  const cardNumber = String(draft.cardNumber || '').replace(/\D/g, '');
  const memberId = String(draft.memberId || '').trim();
  const cardExpiry = normalizeCardExpiry(draft.cardExpiry);
  // CVV solo en memoria del formulario; nunca se normaliza para persistir.
  const cardCvv = String(draft.cardCvv || '').replace(/\D/g, '').slice(0, 4);
  return {
    ...draft,
    moveType: draft.moveType === 'baja' ? 'baja' : 'alta',
    cardKind,
    sheetKind: cardKind,
    brand: String(draft.brand || brandForCardKind(cardKind)).trim() || brandForCardKind(cardKind),
    memberId,
    holderName: String(draft.holderName || '').replace(/\s+/g, ' ').trim(),
    cardNumber,
    cardExpiry,
    cardCvv,
    receipt: String(draft.receipt || '').trim(),
    dueDate: String(draft.dueDate || '').slice(0, 10),
    duesAmount: dues,
    abonoAmount: abono,
    totalAmount: total,
    statusCode: 'N',
    note: String(draft.note || '').replace(/\s+/g, ' ').trim(),
  };
}

export function validateDebitListingDraft(draft) {
  const row = normalizeDebitListingDraft(draft);
  if (!row.memberId) {
    throw new Error('Falta el N° de socio de la ficha.');
  }
  if (!row.cardNumber || !looksLikeCardNumber(row.cardNumber)) {
    throw new Error('Ingresá un N° de tarjeta de crédito o débito (13 a 19 dígitos).');
  }
  if (!isValidCardLuhn(row.cardNumber)) {
    throw new Error('El N° de tarjeta no es válido. Revisá los dígitos.');
  }
  if (!row.brand) {
    throw new Error('Elegí el tipo de tarjeta (Argencard, Visa o Visa Débito).');
  }
  if (row.cardExpiry && !isValidCardExpiry(row.cardExpiry)) {
    throw new Error('El vencimiento de la tarjeta debe ser MM/AA y no estar vencido.');
  }
  if (row.cardCvv && (row.cardCvv.length < 3 || row.cardCvv.length > 4)) {
    throw new Error('El código de seguridad (dorso) debe tener 3 o 4 dígitos.');
  }
  if (!row.holderName) {
    throw new Error('Completá el titular.');
  }
  // Nunca devolver CVV hacia persistencia.
  return { ...row, cardCvv: '' };
}

/** Aplica alta también con datos de planilla (card en ficha). */
export function applyDebitAlta(member, {
  today = todayISODateAR(),
  by = '',
  note = '',
  cardKind = 'credito',
  listing = null,
} = {}) {
  if (!member) throw new Error('Falta el socio.');
  if (!canChargeSocialDues(member)) {
    throw new Error('Vitalicio, fundador y comisión no abonan cuota: no entra en débito automático.');
  }
  const kind = cardKind === 'debito' ? 'debito' : 'credito';
  const channel = kind === 'debito' ? 'Visa Débito / ficha' : 'Crédito / ficha';
  const cardDigits = String(listing?.cardNumber || member.cardNumber || member.prismaId || '')
    .replace(/\D/g, '');
  const next = withDebitMove(member, {
    type: 'alta',
    at: today,
    by: by || '',
    note: note || (kind === 'debito' ? 'Alta de débito automático' : 'Alta de crédito automático'),
    channel,
    cardKind: kind,
    cardNumber: cardDigits || null,
    listingMemberId: listing?.memberId || null,
  });
  const prevMeta = next.meta && typeof next.meta === 'object' ? next.meta : {};
  const cardExpiry = normalizeCardExpiry(listing?.cardExpiry || member.cardExpiry || member.meta?.cardExpiry || '');
  return {
    ...next,
    paymentMethod: 'debito',
    cardNumber: cardDigits || member.cardNumber || null,
    cardExpiry: cardExpiry || null,
    prismaTipoDebito: kind === 'debito' ? 'Visa Débito' : 'Crédito',
    automaticDebitKind: kind,
    meta: {
      ...prevMeta,
      automaticDebitKind: kind,
      prismaTipoDebito: kind === 'debito' ? 'Visa Débito' : 'Crédito',
      ...(cardDigits ? { lastDebitCardNumber: cardDigits } : {}),
      ...(cardExpiry ? { cardExpiry } : {}),
    },
  };
}
