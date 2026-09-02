import { isSupabaseConfigured } from '../lib/supabase';
import * as repos from './repos';
import { canAccessAdmin } from '../domain/auth/roles';

const EMPTY_ERP = {
  chartOfAccounts: [],
  cashRegisters: [],
  cashSessions: [],
  cashMovements: [],
  expenses: [],
  suppliers: [],
  unidentifiedCollections: [],
  galiciaDebits: [],
  fixedExpenses: [],
  fixedDiscounts: [],
  paymentOrders: [],
  alerts: [],
  alertAcks: [],
  clubEvents: [],
  eventRegistrations: [],
  concessions: [],
  canonPayments: [],
};

const CRITICAL_TIMEOUT_MS = 8_000;
const DEFERRED_TIMEOUT_MS = 15_000;
const ERP_TIMEOUT_MS = 20_000;
/** Evita saturar el pool de Supabase (free/small). */
const QUERY_CONCURRENCY = 4;

function withTimeout(promise, ms, label = 'operación') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout: ${label} (${ms}ms)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Nunca rompe el flujo: falla → fallback. */
async function soft(promise, fallback, label = 'query', timeoutMs = CRITICAL_TIMEOUT_MS) {
  try {
    return await withTimeout(Promise.resolve(promise), timeoutMs, label);
  } catch {
    return typeof fallback === 'function' ? fallback() : fallback;
  }
}

/** Ejecuta tareas async con tope de concurrencia (protege el connection pool). */
async function mapLimit(tasks, limit = QUERY_CONCURRENCY) {
  const results = new Array(tasks.length);
  let next = 0;

  async function worker() {
    while (next < tasks.length) {
      const idx = next;
      next += 1;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), Math.max(1, tasks.length)) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

function emptyAppShell() {
  return {
    members: [],
    membersCount: 0,
    reservations: [],
    waitlist: [],
    newsList: [],
    rsvpList: [],
    journalEntries: [],
    staffMembers: [],
    staffHrRecords: [],
    claims: [],
    messages: [],
    entryLogs: [],
    surveys: [],
    guestPasses: [],
    isZondaActive: false,
    tierCatalog: null,
    disciplineCatalog: null,
    registeredUsersCount: 0,
    membershipApplications: [],
  };
}

function packShell({ app = {}, erp = {}, health = { ok: false }, memberDbIds = {} } = {}) {
  return {
    app: { ...emptyAppShell(), ...app },
    erp: { ...EMPTY_ERP, ...erp },
    health,
    memberDbIds,
  };
}

/**
 * Socio — crítico: ficha, reservas, noticias, mensajes, zonda.
 * Suficiente para pintar el portal en pocos segundos.
 */
export async function bootstrapMemberCriticalFromDb({ memberNumber } = {}) {
  if (!isSupabaseConfigured) return null;

  const [member, newsList, messages, reservations, zondaSetting] = await mapLimit([
    () => (memberNumber
      ? soft(repos.getMemberByNumber(memberNumber, { withPayments: true }), null, 'member')
      : Promise.resolve(null)),
    () => soft(repos.listNews({ limit: 30 }), [], 'news'),
    () => soft(repos.listMessages({ limit: 80 }), [], 'messages'),
    () => soft(repos.listReservations({ limit: 120 }), [], 'reservations'),
    () => soft(repos.getSetting('zonda'), null, 'zonda'),
  ], QUERY_CONCURRENCY);

  const members = member ? [member] : [];
  return packShell({
    app: {
      members,
      membersCount: members.length,
      reservations: reservations || [],
      newsList: newsList || [],
      messages: messages || [],
      isZondaActive: Boolean(zondaSetting?.active),
    },
    health: { ok: true },
    memberDbIds: member?.id ? { [member.memberId]: member.id } : {},
  });
}

/** Socio — diferido: waitlist, RSVP, pases, catálogos. */
export async function bootstrapMemberDeferredFromDb() {
  if (!isSupabaseConfigured) {
    return {
      waitlist: [],
      rsvpList: [],
      guestPasses: [],
      tierCatalog: null,
      disciplineCatalog: null,
    };
  }

  const [
    waitlist,
    rsvpList,
    guestPasses,
    memberTiersSetting,
    disciplinesSetting,
  ] = await mapLimit([
    () => soft(repos.listWaitlist(), [], 'waitlist', DEFERRED_TIMEOUT_MS),
    () => soft(repos.listRsvps(), [], 'rsvps', DEFERRED_TIMEOUT_MS),
    () => soft(repos.listGuestPasses(), [], 'guestPasses', DEFERRED_TIMEOUT_MS),
    () => soft(repos.getSetting('member_tiers'), null, 'tiers', DEFERRED_TIMEOUT_MS),
    () => soft(repos.getSetting('disciplines_catalog'), null, 'disciplines', DEFERRED_TIMEOUT_MS),
  ], QUERY_CONCURRENCY);

  return {
    waitlist: waitlist || [],
    rsvpList: rsvpList || [],
    guestPasses: guestPasses || [],
    tierCatalog: Array.isArray(memberTiersSetting) ? memberTiersSetting : null,
    disciplineCatalog: Array.isArray(disciplinesSetting) ? disciplinesSetting : null,
  };
}

/**
 * Ops — crítico: conteo, reservas, noticias, mensajes, alertas, reclamos.
 * Abre el panel sin esperar padrón/ERP/staff completo.
 */
export async function bootstrapOpsCriticalFromDb() {
  if (!isSupabaseConfigured) return null;

  const [
    membersCount,
    reservations,
    newsList,
    messages,
    claims,
    alerts,
    alertAcks,
    zondaSetting,
  ] = await mapLimit([
    () => soft(repos.countMembers(), 0, 'countMembers'),
    () => soft(repos.listReservations({ limit: 150 }), [], 'reservations'),
    () => soft(repos.listNews({ limit: 40 }), [], 'news'),
    () => soft(repos.listMessages({ limit: 100 }), [], 'messages'),
    () => soft(repos.listClaims({ limit: 80 }), [], 'claims'),
    () => soft(repos.listAlerts({ limit: 40 }), [], 'alerts'),
    () => soft(repos.listAlertAcks(), [], 'alertAcks'),
    () => soft(repos.getSetting('zonda'), null, 'zonda'),
  ], QUERY_CONCURRENCY);

  return packShell({
    app: {
      membersCount: membersCount || 0,
      reservations: reservations || [],
      newsList: newsList || [],
      messages: messages || [],
      claims: claims || [],
      isZondaActive: Boolean(zondaSetting?.active),
    },
    erp: {
      alerts: alerts || [],
      alertAcks: alertAcks || [],
    },
    health: { ok: true },
  });
}

/** Ops — diferido: staff, logs, encuestas, eventos, catálogos, altas. */
export async function bootstrapOpsDeferredFromDb() {
  if (!isSupabaseConfigured) {
    return { app: {}, erp: {} };
  }

  const softD = (p, fb, label) => soft(p, fb, label, DEFERRED_TIMEOUT_MS);

  const [
    waitlist,
    rsvpList,
    staffMembers,
    staffHrRecords,
    entryLogs,
    surveys,
    guestPasses,
    clubEvents,
    eventRegistrations,
    memberTiersSetting,
    disciplinesSetting,
    registeredUsersCount,
    membershipApplications,
  ] = await mapLimit([
    () => softD(repos.listWaitlist(), [], 'waitlist'),
    () => softD(repos.listRsvps(), [], 'rsvps'),
    () => softD(repos.listEmployees(), [], 'employees'),
    () => softD(repos.listHrRecords(), [], 'hr'),
    () => softD(repos.listAccessLogs({ limit: 200 }), [], 'accessLogs'),
    () => softD(repos.listSurveys(), [], 'surveys'),
    () => softD(repos.listGuestPasses(), [], 'guestPasses'),
    () => softD(repos.listClubEvents(), [], 'clubEvents'),
    () => softD(repos.listEventRegistrations(), [], 'eventRegs'),
    () => softD(repos.getSetting('member_tiers'), null, 'tiers'),
    () => softD(repos.getSetting('disciplines_catalog'), null, 'disciplines'),
    () => softD(repos.countRegisteredProfiles(), 0, 'profilesCount'),
    () => softD(repos.listMembershipApplications(), [], 'applications'),
  ], QUERY_CONCURRENCY);

  return {
    app: {
      waitlist: waitlist || [],
      rsvpList: rsvpList || [],
      staffMembers: staffMembers || [],
      staffHrRecords: staffHrRecords || [],
      entryLogs: entryLogs || [],
      surveys: surveys || [],
      guestPasses: guestPasses || [],
      tierCatalog: Array.isArray(memberTiersSetting) ? memberTiersSetting : null,
      disciplineCatalog: Array.isArray(disciplinesSetting) ? disciplinesSetting : null,
      registeredUsersCount: registeredUsersCount || 0,
      membershipApplications: membershipApplications || [],
    },
    erp: {
      clubEvents: clubEvents || [],
      eventRegistrations: eventRegistrations || [],
    },
  };
}

/** Contabilidad / tesorería / concesiones — después de pintar el shell. */
export async function bootstrapErpFromDb() {
  if (!isSupabaseConfigured) return { ...EMPTY_ERP };

  const softErp = (p, fb, label) => soft(p, fb, label, ERP_TIMEOUT_MS);

  const [
    chartOfAccounts,
    cashRegisters,
    cashSessions,
    cashMovements,
    expenses,
    suppliers,
    unidentifiedCollections,
    galiciaDebits,
    fixedExpenses,
    fixedDiscounts,
    paymentOrders,
    journalEntries,
    concessions,
    canonPayments,
  ] = await mapLimit([
    () => softErp(repos.listChartOfAccounts(), [], 'coa'),
    () => softErp(repos.listCashRegisters(), [], 'cashRegisters'),
    () => softErp(repos.listCashSessions(), [], 'cashSessions'),
    () => softErp(repos.listCashMovements(), [], 'cashMovements'),
    () => softErp(repos.listExpenses(), [], 'expenses'),
    () => softErp(repos.listSuppliers(), [], 'suppliers'),
    () => softErp(repos.listUnidentifiedCollections(), [], 'unidentified'),
    () => softErp(repos.listGaliciaDebits(), [], 'galicia'),
    () => softErp(repos.listFixedExpenses(), [], 'fixedExpenses'),
    () => softErp(repos.listFixedDiscounts(), [], 'fixedDiscounts'),
    () => softErp(repos.listPaymentOrders(), [], 'paymentOrders'),
    () => softErp(repos.listJournalEntries(), [], 'journal'),
    () => softErp(repos.listConcessions(), [], 'concessions'),
    () => softErp(repos.listCanonPayments(), [], 'canon'),
  ], QUERY_CONCURRENCY);

  return {
    chartOfAccounts: chartOfAccounts || [],
    cashRegisters: cashRegisters || [],
    cashSessions: cashSessions || [],
    cashMovements: cashMovements || [],
    expenses: expenses || [],
    suppliers: suppliers || [],
    unidentifiedCollections: unidentifiedCollections || [],
    galiciaDebits: galiciaDebits || [],
    fixedExpenses: fixedExpenses || [],
    fixedDiscounts: fixedDiscounts || [],
    paymentOrders: paymentOrders || [],
    journalEntries: journalEntries || [],
    concessions: concessions || [],
    canonPayments: canonPayments || [],
  };
}

/**
 * Entrada crítica unificada: socio → shell liviano; ops → panel sin ERP/padrón.
 */
export async function bootstrapShellFromDb({ role, memberNumber } = {}) {
  if (!isSupabaseConfigured) return null;
  if (!canAccessAdmin(role) && role !== 'gate_operator') {
    return bootstrapMemberCriticalFromDb({ memberNumber });
  }
  return bootstrapOpsCriticalFromDb();
}

/** Datos diferidos post-pintura (todos los roles). */
export async function bootstrapDeferredFromDb({ role } = {}) {
  if (!isSupabaseConfigured) return { app: {}, erp: {} };
  if (!canAccessAdmin(role) && role !== 'gate_operator') {
    const deferred = await bootstrapMemberDeferredFromDb();
    return { app: deferred, erp: {} };
  }
  return bootstrapOpsDeferredFromDb();
}

/** Padrón completo (fase 2, en background tras el shell). Solo ops. */
export async function bootstrapMembersFromDb() {
  if (!isSupabaseConfigured) return { members: [], memberDbIds: {} };
  const members = await soft(
    repos.listMembers(),
    [],
    'listMembers',
    45_000
  );
  return {
    members: members || [],
    memberDbIds: Object.fromEntries((members || []).map((m) => [m.memberId, m.id])),
  };
}

/** @deprecated usar bootstrapShellFromDb + bootstrapMembersFromDb */
export async function bootstrapFromDb() {
  const shell = await bootstrapShellFromDb({ role: 'admin' });
  if (!shell) return null;
  const { members, memberDbIds } = await bootstrapMembersFromDb();
  return {
    ...shell,
    app: { ...shell.app, members },
    memberDbIds,
  };
}

export { repos, mapLimit, QUERY_CONCURRENCY, EMPTY_ERP };
