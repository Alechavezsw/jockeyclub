import { buildPostedEntry } from '../accounting/journal';

export const DEFAULT_CLUB_EVENTS = [];

export const DEFAULT_EVENT_SETTINGS = {
  maxGuestsPerMember: 4,
};

const DEMO_EVENT_IDS = new Set(['evt-1', 'evt-2']);

export function isDemoClubEvent(ev) {
  const id = String(ev?.id || '');
  if (DEMO_EVENT_IDS.has(id)) return true;
  const title = String(ev?.title || '');
  return title === 'Cena de Gala Socios Royal & Platinum'
    || title.startsWith('After Match — Tercer Tiempo Regional Cuyano');
}

export function isDemoEventRegistration(r) {
  const id = String(r?.id || '');
  return id.startsWith('ereg-d') || DEMO_EVENT_IDS.has(String(r?.eventId || ''));
}

export function withoutDemoEventData(events = [], registrations = []) {
  return {
    events: (events || []).filter((ev) => !isDemoClubEvent(ev)),
    registrations: (registrations || []).filter((r) => !isDemoEventRegistration(r)),
  };
}

export function createClubEvent(payload) {
  return {
    id: `evt-${Date.now()}`,
    title: payload.title.trim(),
    category: payload.category || 'fiesta',
    description: payload.description?.trim() || '',
    location: payload.location?.trim() || 'Sede Rivadavia',
    startsAt: payload.startsAt,
    endsAt: payload.endsAt || null,
    capacity: payload.capacity ? Number(payload.capacity) : null,
    ticketPrice: Number(payload.ticketPrice) || 0,
    incomeAccountId: payload.incomeAccountId || 'coa-4.1.03',
    status: payload.status || 'published',
    coverImageUrl: payload.coverImageUrl || '',
    createdAt: new Date().toISOString(),
  };
}

export function countRegistrations(registrations, eventId) {
  return (registrations || [])
    .filter((r) => r.eventId === eventId && r.status !== 'revoked')
    .reduce((sum, r) => sum + (Number(r.guestsCount) || 1), 0);
}

export function listEventRegistrations(registrations = [], eventId) {
  return (registrations || []).filter(
    (r) => r.eventId === eventId && r.status !== 'revoked'
  );
}

export function memberEventRegistration(registrations, eventId, memberId) {
  return listEventRegistrations(registrations, eventId).find(
    (r) => r.kind !== 'guest' && r.memberId === memberId
  ) || null;
}

export function guestEventRegistrationsForHost(registrations, eventId, hostMemberId) {
  return listEventRegistrations(registrations, eventId).filter(
    (r) => r.kind === 'guest' && r.hostMemberId === hostMemberId
  );
}

export function cashAccountForPaymentMethod(method = 'efectivo') {
  return method === 'mercadopago' ? 'coa-1.1.03' : 'coa-1.1.01';
}

export function buildEventMpPayload({ amount, memberId, memberName, eventTitle }) {
  const ref = `EVT-${String(memberId || '').slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`;
  return [
    'mercadopago:',
    'alias=jockey.club.sj.mp',
    `amount=${Number(amount) || 0}`,
    `ref=${ref}`,
    `concept=Entrada ${eventTitle || 'evento'} ${memberName || ''}`.trim(),
  ].join('|');
}

export function evaluateEventRegistration(member, event, {
  registrations = [],
  maxGuests = DEFAULT_EVENT_SETTINGS.maxGuestsPerMember,
} = {}) {
  if (!event) {
    return { canEnable: false, blockers: ['Seleccioná un evento.'], alreadyIn: false, ticketPrice: 0 };
  }
  if (!member) {
    return {
      canEnable: false,
      blockers: ['Seleccioná un socio.'],
      alreadyIn: false,
      ticketPrice: Number(event.ticketPrice) || 0,
    };
  }

  const blockers = [];
  if (member.status === 'inactive') blockers.push('El socio está de baja.');
  else if (member.status === 'suspended') blockers.push('El socio está suspendido.');
  else if (member.status && member.status !== 'active') blockers.push('La cuenta del socio no está habilitada.');

  if (event.status && event.status !== 'published' && event.status !== 'open') {
    blockers.push('El evento no está abierto a inscripción.');
  }

  const alreadyIn = Boolean(memberEventRegistration(registrations, event.id, member.memberId));
  const used = countRegistrations(registrations, event.id);
  if (!alreadyIn && event.capacity != null && used + 1 > Number(event.capacity)) {
    blockers.push('No hay cupos disponibles.');
  }

  return {
    canEnable: blockers.length === 0 && !alreadyIn,
    blockers,
    alreadyIn,
    ticketPrice: Number(event.ticketPrice) || 0,
    used,
    capacity: event.capacity != null ? Number(event.capacity) : null,
    maxGuests,
  };
}

export function registerForEvent({
  event,
  memberId,
  memberName = '',
  guestName = '',
  guestsCount = 1,
  kind = 'member',
  hostMemberId = null,
  paymentMethod = 'efectivo',
  cashAccountId,
  chart,
  actorName = '',
}) {
  const count = Math.max(1, Number(guestsCount) || 1);
  const amount = (Number(event.ticketPrice) || 0) * count;
  const method = paymentMethod === 'mercadopago' ? 'mercadopago' : 'efectivo';
  const debitAccount = cashAccountId || cashAccountForPaymentMethod(method);

  const registration = {
    id: `ereg-${Date.now().toString(36)}`,
    eventId: event.id,
    eventTitle: event.title,
    memberId,
    memberName: memberName || '',
    guestName: guestName || null,
    hostMemberId: hostMemberId || (kind === 'guest' ? memberId : null),
    kind: kind === 'guest' ? 'guest' : 'member',
    guestsCount: count,
    amountPaid: amount,
    paymentMethod: amount > 0 ? method : null,
    paymentStatus: amount > 0 ? 'paid' : 'waived',
    registeredAt: new Date().toISOString(),
    registeredBy: actorName || null,
    status: 'active',
    journalEntryId: null,
  };

  let journalEntry = null;
  if (amount > 0) {
    const who = kind === 'guest' && guestName
      ? `${guestName} (invitado de ${memberName || memberId})`
      : (memberName || memberId);
    journalEntry = buildPostedEntry({
      date: new Date().toISOString().slice(0, 10),
      description: `Entrada evento: ${event.title} — ${who} (${method === 'mercadopago' ? 'MP QR' : 'Efectivo'})`,
      lines: [
        { accountId: debitAccount, debit: amount, credit: 0 },
        { accountId: event.incomeAccountId || 'coa-4.1.03', debit: 0, credit: amount },
      ],
      sourceModule: 'eventos',
      sourceId: registration.id,
      chart,
    });
    registration.journalEntryId = journalEntry.id;
  }

  return { registration, journalEntry };
}

export function enableMemberEventAccess({
  event,
  member,
  registrations = [],
  paymentMethod = 'efectivo',
  chart,
  actorName = '',
}) {
  const eval_ = evaluateEventRegistration(member, event, { registrations });
  if (eval_.alreadyIn) throw new Error('El socio ya está inscripto en este evento.');
  if (member?.status !== 'active') throw new Error('Solo socios activos pueden inscribirse.');
  if (eval_.blockers.length) throw new Error(eval_.blockers[0]);

  return registerForEvent({
    event,
    memberId: member.memberId,
    memberName: member.name,
    kind: 'member',
    guestsCount: 1,
    paymentMethod,
    chart,
    actorName,
  });
}

export function enableGuestEventAccess({
  event,
  host,
  guestName,
  registrations = [],
  paymentMethod = 'efectivo',
  maxGuests = DEFAULT_EVENT_SETTINGS.maxGuestsPerMember,
  chart,
  actorName = '',
}) {
  if (!host?.memberId) throw new Error('Socio anfitrión requerido.');
  const name = String(guestName || '').trim();
  if (!name) throw new Error('Indicá el nombre del invitado.');
  if (host.status !== 'active') throw new Error('El anfitrión debe estar activo.');

  const hostReg = memberEventRegistration(registrations, event.id, host.memberId);
  if (!hostReg) throw new Error('Inscribí primero al socio titular.');

  const guests = guestEventRegistrationsForHost(registrations, event.id, host.memberId);
  if (guests.length >= maxGuests) {
    throw new Error(`Máximo ${maxGuests} invitados por socio en este evento.`);
  }

  const used = countRegistrations(registrations, event.id);
  if (event.capacity != null && used + 1 > Number(event.capacity)) {
    throw new Error('No hay cupos disponibles.');
  }

  return registerForEvent({
    event,
    memberId: host.memberId,
    memberName: host.name,
    guestName: name,
    hostMemberId: host.memberId,
    kind: 'guest',
    guestsCount: 1,
    paymentMethod,
    chart,
    actorName,
  });
}

export function revokeEventRegistration(registrations, registrationId) {
  return (registrations || []).map((r) =>
    r.id === registrationId
      ? { ...r, status: 'revoked', revokedAt: new Date().toISOString() }
      : r
  );
}

export function eventOpsStats(events = [], registrations = []) {
  const published = (events || []).filter((e) => e.status === 'published' || e.status === 'open');
  const activeRegs = (registrations || []).filter((r) => r.status !== 'revoked');
  const members = activeRegs.filter((r) => r.kind !== 'guest').length;
  const guests = activeRegs.filter((r) => r.kind === 'guest').length;
  const collected = activeRegs.reduce((s, r) => s + (Number(r.amountPaid) || 0), 0);
  return {
    events: published.length || events.length,
    members,
    guests,
    totalPeople: members + guests,
    collected,
  };
}

export const EVENT_CATEGORY_LABELS = {
  fiesta: 'Fiesta',
  deportes: 'Deportes',
  institucional: 'Institucional',
  hipica: 'Hípica',
};

function isActiveRegistration(r) {
  return r && r.status !== 'revoked';
}

/**
 * Series para los gráficos de Fiestas: cupo, mix socio/invitado y cobros.
 */
export function buildEventDashboard(events = [], registrations = []) {
  const activeRegs = (registrations || []).filter(isActiveRegistration);
  const ops = eventOpsStats(events, registrations);

  const byEvent = (events || []).map((ev) => {
    const regs = activeRegs.filter((r) => r.eventId === ev.id);
    const members = regs.filter((r) => r.kind !== 'guest').length;
    const guests = regs.filter((r) => r.kind === 'guest').length;
    const used = countRegistrations(registrations, ev.id);
    const capacity = ev.capacity != null && ev.capacity !== '' ? Number(ev.capacity) : null;
    const collected = regs.reduce((s, r) => s + (Number(r.amountPaid) || 0), 0);
    const occupancyPct = capacity && capacity > 0
      ? Math.min(100, Math.round((used / capacity) * 100))
      : null;
    return {
      id: ev.id,
      title: ev.title,
      category: ev.category || 'fiesta',
      startsAt: ev.startsAt,
      members,
      guests,
      used,
      capacity,
      occupancyPct,
      collected,
      ticketPrice: Number(ev.ticketPrice) || 0,
    };
  });

  const payments = { efectivo: 0, mercadopago: 0, complimentary: 0 };
  for (const r of activeRegs) {
    const amt = Number(r.amountPaid) || 0;
    if (amt <= 0) payments.complimentary += 1;
    else if (r.paymentMethod === 'mercadopago') payments.mercadopago += amt;
    else payments.efectivo += amt;
  }

  const paidTotal = payments.efectivo + payments.mercadopago;
  const mixTotal = ops.members + ops.guests;

  return {
    ops,
    byEvent,
    payments,
    paidTotal,
    mix: {
      members: ops.members,
      guests: ops.guests,
      total: mixTotal,
      memberPct: mixTotal ? Math.round((ops.members / mixTotal) * 100) : 0,
      guestPct: mixTotal ? Math.round((ops.guests / mixTotal) * 100) : 0,
    },
    maxCollected: byEvent.reduce((m, row) => Math.max(m, row.collected), 0),
    maxCapacity: byEvent.reduce((m, row) => Math.max(m, row.capacity || row.used || 0), 0),
  };
}
