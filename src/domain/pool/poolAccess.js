/** Acceso a pileta: revisación médica, canon del día e invitados. */

export const DEFAULT_POOL_SETTINGS = {
  memberDayFee: 5000,
  guestDayFee: 8000,
  medicalValidityDays: 365,
  maxGuestsPerMember: 3,
  seasonLabel: 'Temporada de pileta',
};

export const POOL_PAYMENT_METHODS = [
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'mercadopago', label: 'Mercado Pago (QR)' },
];

function todayISO(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function addDaysISO(isoDate, days) {
  const d = new Date(`${String(isoDate).slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

export function mergePoolSettings(raw = {}) {
  return { ...DEFAULT_POOL_SETTINGS, ...(raw || {}) };
}

/** Documento médico de pileta (apto / revisación). */
export function getPoolMedicalDoc(member) {
  if (!member) return null;
  const fromDocs = (member.documents || []).find((d) => d.type === 'medical');
  if (fromDocs) return fromDocs;
  const meta = member.meta && typeof member.meta === 'object' ? member.meta : {};
  if (meta.poolMedicalExpiresAt || meta.poolMedicalFileName || member.poolMedicalExpiresAt) {
    return {
      type: 'medical',
      fileName: meta.poolMedicalFileName || member.poolMedicalFileName || 'revisacion-medica',
      uploadedAt: meta.poolMedicalUploadedAt || member.poolMedicalUploadedAt || null,
      expiresAt: meta.poolMedicalExpiresAt || member.poolMedicalExpiresAt || null,
      dataUrl: meta.poolMedicalDataUrl || member.poolMedicalDataUrl || null,
      status: meta.poolMedicalStatus || 'approved',
      note: meta.poolMedicalNote || '',
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
  return { ok: true, code: 'valid', label: 'Revisación vigente', expiresAt, doc };
}

export function attachPoolMedical(member, {
  fileName,
  dataUrl = null,
  note = '',
  uploadedAt = new Date().toISOString(),
  validityDays = DEFAULT_POOL_SETTINGS.medicalValidityDays,
  actorName = '',
} = {}) {
  if (!member) throw new Error('Socio requerido.');
  if (!fileName && !dataUrl) throw new Error('Subí el archivo de la revisación médica.');
  const expiresAt = addDaysISO(String(uploadedAt).slice(0, 10), validityDays);
  const row = {
    id: 'doc-medical',
    type: 'medical',
    fileName: fileName || 'revisacion-medica.pdf',
    dataUrl: dataUrl || null,
    note: note || 'Revisación médica pileta',
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
  };
  return { ...member, documents: docs, meta };
}

export function listDayAccesses(accesses = [], date = todayISO()) {
  return (accesses || []).filter((a) => a.date === date && a.status !== 'revoked');
}

export function memberDayAccess(accesses, memberId, date = todayISO()) {
  return listDayAccesses(accesses, date).find(
    (a) => a.kind === 'member' && a.memberId === memberId && a.status === 'active'
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
} = {}) {
  const cfg = mergePoolSettings(settings);
  if (!member) {
    return { canEnable: false, blockers: ['Seleccioná un socio.'], medical: null, paidToday: false, alreadyIn: false };
  }
  const blockers = [];
  if (member.status === 'inactive') blockers.push('El socio está de baja.');
  else if (member.status === 'suspended') blockers.push('El socio está suspendido.');
  else if (member.status && member.status !== 'active') blockers.push('La cuenta del socio no está habilitada.');

  const medical = getMedicalStatus(member, { today, validityDays: cfg.medicalValidityDays });
  if (!medical.ok) blockers.push(medical.label);

  const alreadyIn = Boolean(memberDayAccess(accesses, member.memberId, today));
  const paidToday = alreadyIn || listDayAccesses(accesses, today).some(
    (a) => a.kind === 'member' && a.memberId === member.memberId && a.payment?.amount >= 0 && a.payment?.paidAt
  );

  return {
    canEnable: blockers.length === 0 && !alreadyIn,
    blockers,
    medical,
    paidToday,
    alreadyIn,
    memberFee: cfg.memberDayFee,
    guestFee: cfg.guestDayFee,
    maxGuests: cfg.maxGuestsPerMember,
  };
}

export function buildPoolMpPayload({ amount, memberId, memberName, concept = 'Canon pileta' }) {
  const ref = `POOL-${String(memberId || '').slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`;
  return [
    'mercadopago:',
    'alias=jockey.club.sj.mp',
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
}) {
  const eval_ = evaluatePoolAccess(member, { accesses, today, settings });
  if (eval_.alreadyIn) throw new Error('El socio ya tiene acceso habilitado hoy.');
  if (!eval_.medical?.ok) throw new Error(eval_.medical?.label || 'Falta revisación médica.');
  if (member.status !== 'active') throw new Error('Solo socios activos pueden ingresar a pileta.');

  const fee = amount != null ? Number(amount) : mergePoolSettings(settings).memberDayFee;
  if (fee < 0) throw new Error('Importe inválido.');
  if (!['efectivo', 'mercadopago'].includes(method)) throw new Error('Medio de pago inválido.');

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
      method,
      paidAt: new Date().toISOString(),
      ref: paymentRef || null,
      concept: 'Canon pileta socio',
    },
    medicalExpiresAt: eval_.medical.expiresAt,
    enabledAt: new Date().toISOString(),
    enabledBy: actorName || null,
    status: 'active',
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
  if (host.status !== 'active') throw new Error('El anfitrión debe estar activo.');

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

export function poolDayStats(accesses = [], date = todayISO()) {
  const day = listDayAccesses(accesses, date).filter((a) => a.status === 'active');
  const members = day.filter((a) => a.kind === 'member').length;
  const guests = day.filter((a) => a.kind === 'guest').length;
  const collected = day.reduce((s, a) => s + (Number(a.payment?.amount) || 0), 0);
  return { members, guests, total: members + guests, collected };
}
