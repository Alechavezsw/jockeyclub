/** Acceso a pileta: revisación médica, canon de temporada e invitados del día. */

import { isOperationalMember } from '../members/operationalVisibility';
import { piletaPayAccess, seasonDuesGate } from './seasonDuesGate';
import { todayAR } from '../../lib/arDate';
import {
  memberHasPoolSeasonPass,
  quotePersonPoolSeason,
} from './poolSeasonBilling';
import { poolSeasonWindow } from './poolSeason';


/** Temporada 2026-12-01 → 2027-03-31: $90.000 / persona, máx. 4, menores de 4 libres. */
export const DEFAULT_POOL_SETTINGS = {
  memberSeasonFee: 90000,
  /** Alias legacy: mismo importe de temporada (no es cobro diario). */
  memberDayFee: 90000,
  guestDayFee: 8000,
  maxPayingPerHousehold: 4,
  freeUnderAgeYears: 4,
  medicalValidityDays: 365,
  maxGuestsPerMember: 3,
  seasonLabel: 'Temporada de pileta 2026/2027',
  memberCanUploadMedical: true,
  seasonBlocksUnpaidDues: true,
};

/** Mismos medios de cobro que en la app (cuotas), sin mixto: el canon de pileta es un solo importe. */
export const POOL_PAYMENT_METHODS = [
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'transferencia', label: 'Transferencia' },
  { id: 'tarjeta', label: 'Pago POS' },
  { id: 'debito', label: 'Débito' },
  { id: 'mercadopago', label: 'Mercado Pago' },
];

export const POOL_DESK_PAYMENT_METHODS = POOL_PAYMENT_METHODS
  .filter((m) => m.id !== 'mercadopago')
  .map((m) => m.id);

export function poolMethodUsesCash(method) {
  return method === 'efectivo';
}

/** Terminal POS / cupón: no entra en Caja General. */
export function poolMethodUsesCardPos(method) {
  const raw = String(method || '').trim().toLowerCase();
  return raw === 'tarjeta' || raw === 'pos' || raw === 'pago pos';
}

export function poolMethodUsesBank(method) {
  return method === 'transferencia' || method === 'debito';
}

export function poolMethodLabel(method) {
  if (poolMethodUsesCardPos(method)) return 'Pago POS';
  return POOL_PAYMENT_METHODS.find((m) => m.id === method)?.label
    || (method === 'asistencia' ? 'Asistencia' : String(method || ''));
}

function todayISO(d = new Date()) {
  return todayAR(d);
}

function addDaysISO(isoDate, days) {
  const d = new Date(`${String(isoDate).slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + Number(days || 0));
  return todayAR(d);
}

export function mergePoolSettings(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const next = { ...DEFAULT_POOL_SETTINGS, ...src };
  next.seasonBlocksUnpaidDues = src.seasonBlocksUnpaidDues !== false;

  // Migración: el viejo “canon del día” ($5.000) pasa a temporada ($90.000).
  const legacyDay = src.memberDayFee != null ? Number(src.memberDayFee) : null;
  const seasonRaw = src.memberSeasonFee != null ? Number(src.memberSeasonFee) : null;
  if (seasonRaw != null && Number.isFinite(seasonRaw)) {
    next.memberSeasonFee = Math.max(0, seasonRaw);
  } else if (legacyDay != null && Number.isFinite(legacyDay)) {
    next.memberSeasonFee = legacyDay === 5000 ? 90000 : Math.max(0, legacyDay);
  } else {
    next.memberSeasonFee = DEFAULT_POOL_SETTINGS.memberSeasonFee;
  }
  next.memberDayFee = next.memberSeasonFee;
  next.maxPayingPerHousehold = Math.max(
    0,
    Number(src.maxPayingPerHousehold ?? DEFAULT_POOL_SETTINGS.maxPayingPerHousehold) || 0,
  );
  next.freeUnderAgeYears = Math.max(
    0,
    Number(src.freeUnderAgeYears ?? DEFAULT_POOL_SETTINGS.freeUnderAgeYears) || 0,
  );
  next.guestDayFee = Math.max(0, Number(next.guestDayFee) || 0);
  return next;
}

/** Documento médico de pileta (apto / revisación). */
export function getPoolMedicalDoc(member) {
  if (!member) return null;
  const fromDocs = (member.documents || []).find((d) => d.type === 'medical');
  if (fromDocs) {
    const meta = member.meta && typeof member.meta === 'object' ? member.meta : {};
    return {
      ...fromDocs,
      talonario: fromDocs.talonario || meta.poolMedicalTalonario || member.poolMedicalTalonario || null,
      source: fromDocs.source || meta.poolMedicalSource || null,
    };
  }
  const meta = member.meta && typeof member.meta === 'object' ? member.meta : {};
  if (
    meta.poolMedicalExpiresAt
    || meta.poolMedicalFileName
    || meta.poolMedicalTalonario
    || member.poolMedicalExpiresAt
    || member.poolMedicalTalonario
  ) {
    return {
      type: 'medical',
      fileName: meta.poolMedicalFileName || member.poolMedicalFileName || 'revisacion-medica',
      uploadedAt: meta.poolMedicalUploadedAt || member.poolMedicalUploadedAt || null,
      expiresAt: meta.poolMedicalExpiresAt || member.poolMedicalExpiresAt || null,
      dataUrl: meta.poolMedicalDataUrl || member.poolMedicalDataUrl || null,
      status: meta.poolMedicalStatus || 'approved',
      note: meta.poolMedicalNote || '',
      talonario: meta.poolMedicalTalonario || member.poolMedicalTalonario || null,
      source: meta.poolMedicalSource || member.poolMedicalSource || null,
    };
  }
  return null;
}

export function getMedicalStatus(member, {
  today = todayISO(),
  validityDays = DEFAULT_POOL_SETTINGS.medicalValidityDays,
} = {}) {
  const doc = getPoolMedicalDoc(member);
  if (!doc) {
    return { ok: false, code: 'missing', label: 'Sin revisación médica', expiresAt: null, doc: null };
  }
  let expiresAt = doc.expiresAt || null;
  if (!expiresAt && doc.uploadedAt) {
    expiresAt = addDaysISO(String(doc.uploadedAt).slice(0, 10), validityDays);
  }
  if (!expiresAt) {
    return { ok: false, code: 'incomplete', label: 'Revisación sin fecha de vigencia', expiresAt: null, doc };
  }
  if (String(expiresAt).slice(0, 10) < today) {
    return { ok: false, code: 'expired', label: 'Revisación vencida', expiresAt, doc };
  }
  const talonario = String(doc.talonario || '').trim();
  const label = talonario
    ? `Revisación vigente · talón ${talonario}`
    : 'Revisación vigente';
  return { ok: true, code: 'valid', label, expiresAt, doc };
}

/**
 * Marca revisación médica: archivo subido y/o número del talonario (papel).
 * Con talonario alcanza; el archivo es opcional.
 */
export function attachPoolMedical(member, {
  fileName,
  dataUrl = null,
  note = '',
  talonario = '',
  uploadedAt = new Date().toISOString(),
  validityDays = DEFAULT_POOL_SETTINGS.medicalValidityDays,
  actorName = '',
} = {}) {
  if (!member) throw new Error('Socio requerido.');
  const ticket = String(talonario || '').trim();
  if (!fileName && !dataUrl && !ticket) {
    throw new Error('Indicá el número del talonario o subí el archivo de la revisación.');
  }
  const expiresAt = addDaysISO(String(uploadedAt).slice(0, 10), validityDays);
  const source = ticket && !dataUrl && !fileName ? 'talonario' : (ticket ? 'mixed' : 'upload');
  const resolvedName = fileName
    || (ticket ? `talonario-${ticket}` : 'revisacion-medica.pdf');
  const resolvedNote = note
    || (ticket
      ? `Revisación médica pileta · talón ${ticket}`
      : 'Revisación médica pileta');
  const row = {
    id: 'doc-medical',
    type: 'medical',
    fileName: resolvedName,
    dataUrl: dataUrl || null,
    note: resolvedNote,
    talonario: ticket || null,
    source,
    uploadedAt,
    expiresAt,
    status: 'approved',
    uploadedBy: actorName || null,
  };
  const docs = [...(member.documents || [])];
  const idx = docs.findIndex((d) => d.type === 'medical');
  if (idx >= 0) docs[idx] = row;
  else docs.push(row);

  const meta = {
    ...(member.meta && typeof member.meta === 'object' ? member.meta : {}),
    documents: docs,
    poolMedicalExpiresAt: expiresAt,
    poolMedicalFileName: row.fileName,
    poolMedicalUploadedAt: uploadedAt,
    poolMedicalStatus: 'approved',
    poolMedicalNote: row.note,
    poolMedicalTalonario: ticket || null,
    poolMedicalSource: source,
  };
  return { ...member, documents: docs, meta };
}

export function listDayAccesses(accesses = [], date = todayISO()) {
  return (accesses || []).filter((a) => a.date === date && a.status !== 'revoked');
}

/**
 * Canon cobrado sin apto no es un ingreso.
 * Si la fila vieja no trae la marca, un canon de temporada sin fecha de apto tampoco lo es.
 */
export function inferPoolEntered(row = {}) {
  const flag = row?.entered ?? row?.meta?.entered;
  if (flag === false || flag === 'false') return false;
  if (flag === true || flag === 'true') return true;
  if (row?.kind === 'guest') return true;
  const concept = String(row?.payment?.concept || row?.paymentConcept || '');
  const amount = Number(row?.payment?.amount ?? row?.paymentAmount) || 0;
  const medical = row?.medicalExpiresAt || row?.medical_expires_at || null;
  if (amount > 0 && /temporada/i.test(concept) && !medical) return false;
  return true;
}

/** Canon cobrado sin apto: no cuenta como ingreso del día. */
export function poolVisitCounts(row) {
  return inferPoolEntered(row);
}

export function memberDayAccess(accesses, memberId, date = todayISO()) {
  return listDayAccesses(accesses, date).find(
    (a) => a.kind === 'member'
      && String(a.memberId) === String(memberId)
      && a.status === 'active'
      && poolVisitCounts(a)
  ) || null;
}

export function guestDayAccessesForHost(accesses, hostMemberId, date = todayISO()) {
  return listDayAccesses(accesses, date).filter(
    (a) => a.kind === 'guest' && a.hostMemberId === hostMemberId && a.status === 'active'
  );
}

export function evaluatePoolAccess(member, {
  accesses = [],
  today = todayISO(),
  settings = DEFAULT_POOL_SETTINGS,
  members = [],
} = {}) {
  const cfg = mergePoolSettings(settings);
  if (!member) {
    return {
      canEnable: false,
      blockers: ['Seleccioná un socio.'],
      medical: null,
      duesGate: { blocked: false, inSeason: false, mora: false, reason: '' },
      duesBlocked: false,
      payBlocked: false,
      paidToday: false,
      alreadyIn: false,
    };
  }
  const blockers = [];
  if (!isOperationalMember(member)) {
    blockers.push(member.status === 'suspended' ? 'El socio está suspendido.' : 'El socio está de baja.');
  }

  const medical = getMedicalStatus(member, { today, validityDays: cfg.medicalValidityDays });
  if (!medical.ok) blockers.push(medical.label);

  const duesGate = seasonDuesGate(member, { today, settings: cfg, members });
  if (duesGate.blocked) blockers.push(duesGate.reason);
  const payAccess = piletaPayAccess(member, { today, settings: cfg, members });
  if (!duesGate.blocked && payAccess.mora) blockers.push(payAccess.detail);

  const alreadyIn = Boolean(memberDayAccess(accesses, member.memberId, today));
  const seasonPaid = memberHasPoolSeasonPass(accesses, member.memberId, today, cfg);
  const personQuote = quotePersonPoolSeason(member, {
    today,
    settings: cfg,
    members,
    accesses,
  });
  const paidToday = seasonPaid || listDayAccesses(accesses, today).some(
    (a) => a.kind === 'member'
      && String(a.memberId) === String(member.memberId)
      && (Number(a.payment?.amount) > 0 || a.payment?.scope === 'season')
  );

  const payBlockers = blockers.filter((line) => line !== medical.label);
  return {
    canEnable: blockers.length === 0 && !alreadyIn,
    canPayCanon: payBlockers.length === 0 && !seasonPaid && (Number(personQuote.amount) || 0) > 0,
    blockers,
    medical,
    duesGate,
    duesBlocked: duesGate.blocked,
    payBlocked: Boolean(payAccess.mora),
    paidToday,
    seasonPaid,
    seasonAmountDue: Number(personQuote.amount) || 0,
    seasonReason: personQuote.reason || '',
    alreadyIn,
    memberFee: cfg.memberSeasonFee,
    guestFee: cfg.guestDayFee,
    maxGuests: cfg.maxGuestsPerMember,
  };
}

/** Banderas de la búsqueda de pileta: en mora no se ofrece canon. */
export function poolSearchFlags(snap, dues, formatMoney) {
  const flags = [];
  const owed = Number(dues) || 0;
  if (snap?.payBlocked) {
    flags.push({ tone: 'bad', label: 'En mora · no paga pileta' });
  } else {
    const seasonOk = Boolean(snap?.seasonPaid || snap?.paidToday);
    flags.push({
      tone: seasonOk ? 'ok' : 'bad',
      label: seasonOk ? 'Temporada abonada' : 'Temporada impaga',
    });
  }
  flags.push({
    tone: snap?.medical?.ok ? 'ok' : 'bad',
    label: snap?.medical?.ok ? 'Apto médico' : 'Sin apto',
  });
  if (owed > 0) {
    flags.push({
      tone: 'bad',
      label: typeof formatMoney === 'function' ? `Debe ${formatMoney(owed)}` : `Debe ${owed}`,
    });
  } else if (!snap?.payBlocked) {
    flags.push({ tone: 'ok', label: 'Cuota al día' });
  }
  return flags;
}

export function buildPoolMpPayload({ amount, memberId, memberName, concept = 'Canon pileta' }) {
  const ref = `POOL-${String(memberId || '').slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`;
  return [
    'mercadopago:',
    `amount=${Number(amount) || 0}`,
    `ref=${ref}`,
    `concept=${concept} ${memberName || ''}`.trim(),
  ].join('|');
}

export function enableMemberPoolAccess({
  member,
  accesses = [],
  method = 'efectivo',
  amount,
  actorName = '',
  today = todayISO(),
  settings = DEFAULT_POOL_SETTINGS,
  paymentRef = '',
  members = [],
  requireMedical = true,
}) {
  const eval_ = evaluatePoolAccess(member, { accesses, today, settings, members });
  if (eval_.alreadyIn) throw new Error('El socio ya tiene acceso habilitado hoy.');
  if (eval_.payBlocked) throw new Error('En mora · regularizá la cuota para pagar pileta.');
  if (eval_.duesBlocked) throw new Error(eval_.duesGate?.reason || 'En mora · no ingresa hasta regularizar.');
  if (requireMedical && !eval_.medical?.ok) {
    throw new Error(eval_.medical?.label || 'Falta revisación médica.');
  }
  if (!isOperationalMember(member)) throw new Error('Solo socios activos pueden ingresar a pileta.');

  const cfg = mergePoolSettings(settings);
  const personQuote = quotePersonPoolSeason(member, {
    today,
    settings: cfg,
    members,
    accesses,
  });
  const fee = amount != null ? Number(amount) : Number(personQuote.amount) || 0;
  if (fee < 0) throw new Error('Importe inválido.');
  const resolvedMethod = fee > 0
    ? String(method || 'efectivo').toLowerCase()
    : 'asistencia';
  if (fee > 0 && !POOL_PAYMENT_METHODS.some((m) => m.id === resolvedMethod)) {
    throw new Error('Medio de pago inválido.');
  }
  const isSeasonCharge = fee > 0 || personQuote.alreadyPaid || personQuote.pays === false;

  const entry = {
    id: `pool-${Date.now().toString(36)}`,
    date: today,
    kind: 'member',
    memberId: member.memberId,
    memberName: member.name,
    guestName: null,
    hostMemberId: null,
    payment: {
      amount: fee,
      method: resolvedMethod,
      paidAt: new Date().toISOString(),
      ref: paymentRef || null,
      concept: fee > 0
        ? 'Canon pileta temporada'
        : (personQuote.reason || 'Acceso pileta temporada'),
      scope: isSeasonCharge ? 'season' : 'day',
    },
    medicalExpiresAt: eval_.medical?.expiresAt || null,
    entered: eval_.medical?.ok === true,
    enabledAt: new Date().toISOString(),
    enabledBy: actorName || null,
    status: 'active',
  };
  return { entry, accesses: [entry, ...(accesses || [])] };
}

/** Marca asistencia en puerta: hace falta apto vigente y el canon de temporada ya cobrado. */
export function recordPoolAttendance({
  member,
  accesses = [],
  actorName = '',
  today = todayISO(),
  members = [],
} = {}) {
  if (!member?.memberId) throw new Error('Seleccioná un socio.');
  const eval_ = evaluatePoolAccess(member, { accesses, today, members });
  if (eval_.payBlocked || eval_.duesBlocked) {
    throw new Error(eval_.duesGate?.reason || 'En mora · regularizá la cuota para ingresar.');
  }
  if (!eval_.medical?.ok) throw new Error(eval_.medical?.label || 'Falta revisación médica.');
  if ((Number(eval_.seasonAmountDue) || 0) > 0) {
    throw new Error('No abonó el canon de temporada de pileta.');
  }
  if (eval_.alreadyIn || memberDayAccess(accesses, member.memberId, today)) {
    throw new Error('El socio ya está anotado hoy.');
  }
  const medical = eval_.medical;
  const entry = {
    id: `pool-a-${Date.now().toString(36)}`,
    date: today,
    kind: 'member',
    memberId: member.memberId,
    memberName: member.name,
    guestName: null,
    hostMemberId: null,
    payment: {
      amount: 0,
      method: 'asistencia',
      paidAt: new Date().toISOString(),
      ref: null,
      concept: 'Asistencia pileta',
    },
    medicalExpiresAt: medical.expiresAt || null,
    entered: true,
    enabledAt: new Date().toISOString(),
    enabledBy: actorName || null,
    status: 'active',
    source: 'attendance',
  };
  return { entry, accesses: [entry, ...(accesses || [])] };
}

export function enableGuestPoolAccess({
  host,
  guestName,
  accesses = [],
  method = 'efectivo',
  amount,
  actorName = '',
  today = todayISO(),
  settings = DEFAULT_POOL_SETTINGS,
  paymentRef = '',
}) {
  if (!host?.memberId) throw new Error('Socio anfitrión requerido.');
  const name = String(guestName || '').trim();
  if (!name) throw new Error('Indicá el nombre del invitado.');
  if (!isOperationalMember(host)) throw new Error('El anfitrión debe estar activo.');

  const cfg = mergePoolSettings(settings);
  const hostAccess = memberDayAccess(accesses, host.memberId, today);
  if (!hostAccess) throw new Error('Habilitá primero el acceso del socio titular.');

  const guests = guestDayAccessesForHost(accesses, host.memberId, today);
  if (guests.length >= cfg.maxGuestsPerMember) {
    throw new Error(`Máximo ${cfg.maxGuestsPerMember} invitados por socio y día.`);
  }

  const fee = amount != null ? Number(amount) : cfg.guestDayFee;
  const entry = {
    id: `pool-g-${Date.now().toString(36)}`,
    date: today,
    kind: 'guest',
    memberId: host.memberId,
    memberName: host.name,
    guestName: name,
    hostMemberId: host.memberId,
    payment: {
      amount: fee,
      method,
      paidAt: new Date().toISOString(),
      ref: paymentRef || null,
      concept: 'Canon pileta invitado',
    },
    medicalExpiresAt: null,
    enabledAt: new Date().toISOString(),
    enabledBy: actorName || null,
    status: 'active',
  };
  return { entry, accesses: [entry, ...(accesses || [])] };
}

export function revokePoolAccess(accesses, entryId) {
  return (accesses || []).map((a) =>
    a.id === entryId
      ? { ...a, status: 'revoked', revokedAt: new Date().toISOString() }
      : a
  );
}

export function memberPoolHistory(accesses = [], memberId) {
  const id = String(memberId || '');
  if (!id) return [];
  return (accesses || [])
    .filter((a) => String(a.memberId) === id)
    .toSorted((a, b) => String(b.date || '').localeCompare(String(a.date || ''))
      || String(b.enabledAt || '').localeCompare(String(a.enabledAt || '')));
}

export function poolEntranceVerdict(member, eval_ = {}, dues = 0) {
  if (!member) {
    return { status: 'idle', title: 'Buscá un socio', detail: 'Nombre, DNI o número de socio.' };
  }
  if (eval_.alreadyIn) {
    return { status: 'granted', title: 'ASISTIÓ', detail: 'Anotado en ingresos de hoy' };
  }
  if (isOperationalMember(member) && eval_.medical?.ok && (eval_.paidToday || eval_.seasonPaid)) {
    return {
      status: 'granted',
      title: 'PUEDE INGRESAR',
      detail: eval_.seasonPaid
        ? 'Temporada abonada · apto médico vigente'
        : 'Canon pago · apto médico vigente',
    };
  }
  const blockers = eval_.blockers || [];
  const first = blockers[0]
    || (!(eval_.paidToday || eval_.seasonPaid) ? 'No abonó el canon de temporada de pileta.' : 'No puede ingresar.');
  return {
    status: 'denied',
    title: 'NO INGRESA',
    detail: first,
    duesOwed: Number(dues) || 0,
  };
}

function foldSearch(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function nameSearchParts(member) {
  const name = foldSearch([member?.name, member?.firstName, member?.lastName].filter(Boolean).join(' '));
  return { name, tokens: name.split(/\s+/).filter(Boolean) };
}

/** Cada palabra del texto tiene que aparecer en el nombre, en cualquier orden. */
function scoreNameWords(member, textWords) {
  if (!textWords.length) return 0;
  const { name, tokens } = nameSearchParts(member);
  if (!tokens.length) return 0;
  const used = new Set();
  let exact = 0;
  let prefixes = 0;
  for (const word of textWords) {
    const exactAt = tokens.findIndex((token, index) => !used.has(index) && token === word);
    if (exactAt >= 0) {
      used.add(exactAt);
      exact += 1;
      prefixes += 1;
      continue;
    }
    const prefixAt = tokens.findIndex((token, index) => !used.has(index) && token.startsWith(word));
    if (prefixAt >= 0) {
      used.add(prefixAt);
      prefixes += 1;
      continue;
    }
    if (word.length < 3 || !name.includes(word)) return 0;
  }
  if (name.startsWith(textWords.join(' '))) return 92;
  if (exact === textWords.length) return 88;
  if (prefixes === textWords.length) return 82;
  return 64;
}

export function searchPoolMembers(members = [], query, { limit = 40 } = {}) {
  const raw = String(query || '').trim();
  if (!raw) return [];
  const q = foldSearch(raw);
  const digits = raw.replace(/\D/g, '');
  const textWords = q.split(/\s+/).flatMap((word) => {
    const letters = word.replace(/[^a-z]/g, '');
    return letters ? [letters] : [];
  });
  const scored = [];
  for (const member of members) {
    const nro = String(member.memberId || '').replace(/\D/g, '');
    const dni = String(member.documentNumber || '').replace(/\D/g, '');
    let score = 0;
    if (digits && dni === digits) score = 100;
    else if (digits && nro === digits) score = 90;
    else if (digits && digits.length >= 3 && (dni.includes(digits) || nro.includes(digits))) score = 70;
    score = Math.max(score, scoreNameWords(member, textWords));
    if (score > 0) scored.push({ member, score });
  }
  return scored
    .toSorted((a, b) => b.score - a.score
      || (a.member.status === 'active' ? 0 : 1) - (b.member.status === 'active' ? 0 : 1)
      || String(a.member.name || '').localeCompare(String(b.member.name || ''), 'es'))
    .slice(0, limit)
    .map((row) => row.member);
}

export function mergePoolSearchHits(local = [], remote = [], { limit = 30 } = {}) {
  const seen = new Set();
  const out = [];
  for (const member of [...local, ...remote]) {
    const id = String(member?.memberId || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(member);
    if (out.length >= limit) break;
  }
  return out;
}

export function poolDayStats(accesses = [], date = todayISO()) {
  const day = listDayAccesses(accesses, date).filter((a) => a.status === 'active');
  const visits = day.filter(poolVisitCounts);
  const members = visits.filter((a) => a.kind === 'member').length;
  const guests = visits.filter((a) => a.kind === 'guest').length;
  const collected = day.reduce((s, a) => s + (Number(a.payment?.amount) || 0), 0);
  return { members, guests, total: members + guests, collected };
}

/** Ventana de temporada a mostrar: la vigente si está viva; si no, la última cerrada. */
export function poolSeasonBounds(today = todayISO()) {
  const win = poolSeasonWindow(today);
  if (win.live) {
    return { open: win.open, close: win.close, live: true };
  }
  return { open: win.previousOpen, close: win.previousClose, live: false };
}

export function listSeasonAccesses(accesses = [], today = todayISO()) {
  const { open, close } = poolSeasonBounds(today);
  return (accesses || []).filter((row) => {
    const date = String(row?.date || '').slice(0, 10);
    return date >= open && date <= close;
  });
}

/**
 * KPIs de pileta: día + temporada (como el resumen de Colonia).
 * Cobrado de temporada: importes de accesos no revocados en la ventana.
 */
export function poolSeasonStats(accesses = [], today = todayISO()) {
  const bounds = poolSeasonBounds(today);
  const day = poolDayStats(accesses, today);
  const season = listSeasonAccesses(accesses, today);
  const active = season.filter((row) => row.status === 'active');
  const members = active.filter((row) => row.kind === 'member');
  const guests = active.filter((row) => row.kind === 'guest');
  const uniqueMembers = new Set(
    members.map((row) => String(row.memberId || '')).filter(Boolean),
  ).size;
  const collected = season
    .filter((row) => row.status !== 'revoked')
    .reduce((sum, row) => sum + (Number(row.payment?.amount) || 0), 0);
  return {
    open: bounds.open,
    close: bounds.close,
    live: bounds.live,
    dayMembers: day.members,
    dayGuests: day.guests,
    dayTotal: day.total,
    dayCollected: day.collected,
    seasonMembers: uniqueMembers,
    seasonGuests: guests.length,
    seasonEntries: active.length,
    seasonCollected: collected,
    revoked: season.filter((row) => row.status === 'revoked').length,
  };
}

function poolMethodCell(method) {
  const key = String(method || '').trim();
  if (!key) return '—';
  if (key === 'asistencia') return 'Asistió';
  return poolMethodLabel(key) || key;
}

/** Filas de tabla para Hoy o Temporada. */
export function poolAccessReportRows(accesses = [], { scope = 'day', today = todayISO() } = {}) {
  const source = scope === 'season'
    ? listSeasonAccesses(accesses, today)
    : listDayAccesses(accesses, today);
  return [...source]
    .toSorted((a, b) => String(b.enabledAt || b.date || '').localeCompare(String(a.enabledAt || a.date || '')))
    .map((row) => ({
      id: row.id,
      date: String(row.date || '').slice(0, 10),
      who: row.kind === 'guest'
        ? (row.guestName || 'Invitado')
        : (row.memberName || row.memberId || '—'),
      memberId: row.memberId || row.hostMemberId || '',
      kind: row.kind === 'guest' ? 'Invitado' : 'Socio',
      host: row.kind === 'guest'
        ? (row.memberName || row.hostMemberId || '—')
        : '—',
      amount: Number(row.payment?.amount) || 0,
      method: poolMethodCell(row.payment?.method),
      status: row.status === 'revoked' ? 'Revocado' : 'Activo',
      raw: row,
    }));
}

/** Un renglón por día: la suma del canon de pileta, no un cobro por socio. */
export function poolCanonByDay(accesses = [], { month = '', limit = 8 } = {}) {
  const byDate = new Map();
  for (const row of accesses || []) {
    if (row?.status === 'revoked') continue;
    const date = String(row?.date || '').slice(0, 10);
    if (!date || (month && !date.startsWith(month))) continue;
    const amount = Number(row?.payment?.amount) || 0;
    if (amount <= 0) continue;
    const current = byDate.get(date) || { amount: 0, count: 0 };
    current.amount += amount;
    current.count += 1;
    byDate.set(date, current);
  }
  return [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, limit)
    .map(([date, current]) => ({
      id: `pool-canon-${date}`,
      date,
      label: `Canon pileta · ${current.count} ${current.count === 1 ? 'ingreso' : 'ingresos'}`,
      amount: current.amount,
      source: 'pool',
    }));
}

/** La Caja General del día ya está abierta. */
export function isPoolDayCashOpen(sessions = [], registers = []) {
  const generalIds = new Set(
    (registers || [])
      .filter((register) => register?.isActive !== false
        && /general|secretar/i.test(`${register.name || ''} ${register.code || ''}`))
      .map((register) => register.id),
  );
  return (sessions || []).some((session) => {
    if (session?.status !== 'open') return false;
    if (generalIds.has(session.cashRegisterId)) return true;
    return /pileta/i.test(session.notes || '');
  });
}
