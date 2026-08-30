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

const SHELL_TIMEOUT_MS = 12_000;
const ERP_TIMEOUT_MS = 20_000;
/** Evita saturar el pool de Supabase (free/small) con Promise.all masivos. */
const QUERY_CONCURRENCY = 3;

function withTimeout(promise, ms, label = 'operación') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout: ${label} (${ms}ms)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Nunca rompe el flujo: falla → fallback. */
async function soft(promise, fallback, label = 'query', timeoutMs = SHELL_TIMEOUT_MS) {
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

/**
 * Shell mínimo para socio: sin ERP ni padrón completo.
 * Debe resolver en pocos segundos para no dejar la UI en “Sincronizando…”.
 */
export async function bootstrapMemberShellFromDb({ memberNumber } = {}) {
  if (!isSupabaseConfigured) return null;

  const [
    member,
    newsList,
    messages,
    reservations,
    waitlist,
    rsvpList,
    guestPasses,
    zondaSetting,
    memberTiersSetting,
    disciplinesSetting,
    health,
  ] = await mapLimit([
    () => (memberNumber
      ? soft(repos.getMemberByNumber(memberNumber, { withPayments: true }), null, 'member')
      : Promise.resolve(null)),
    () => soft(repos.listNews(), [], 'news'),
    () => soft(repos.listMessages(), [], 'messages'),
    () => soft(repos.listReservations({ limit: 200 }), [], 'reservations'),
    () => soft(repos.listWaitlist(), [], 'waitlist'),
    () => soft(repos.listRsvps(), [], 'rsvps'),
    () => soft(repos.listGuestPasses(), [], 'guestPasses'),
    () => soft(repos.getSetting('zonda'), null, 'zonda'),
    () => soft(repos.getSetting('member_tiers'), null, 'tiers'),
    () => soft(repos.getSetting('disciplines_catalog'), null, 'disciplines'),
    () => soft(repos.healthCheck(), { ok: false }, 'health'),
  ]);

  const members = member ? [member] : [];
  return {
    app: {
      ...emptyAppShell(),
      members,
      membersCount: members.length,
      reservations: reservations || [],
      waitlist: waitlist || [],
      newsList: newsList || [],
      rsvpList: rsvpList || [],
      messages: messages || [],
      guestPasses: guestPasses || [],
      isZondaActive: Boolean(zondaSetting?.active),
      tierCatalog: Array.isArray(memberTiersSetting) ? memberTiersSetting : null,
      disciplineCatalog: Array.isArray(disciplinesSetting) ? disciplinesSetting : null,
    },
    erp: { ...EMPTY_ERP },
    health: health || { ok: false },
    memberDbIds: member?.id ? { [member.memberId]: member.id } : {},
  };
}

/**
 * Shell operativo (admin/staff): datos de portal sin contabilidad pesada.
 * ERP se hidrata aparte con bootstrapErpFromDb().
 */
export async function bootstrapOpsShellFromDb() {
  if (!isSupabaseConfigured) return null;

  const [
    membersCount,
    reservations,
    waitlist,
    newsList,
    rsvpList,
    staffMembers,
    staffHrRecords,
    claims,
    messages,
    entryLogs,
    surveys,
    guestPasses,
    alerts,
    alertAcks,
    clubEvents,
    eventRegistrations,
    zondaSetting,
    memberTiersSetting,
    disciplinesSetting,
    registeredUsersCount,
    membershipApplications,
    health,
  ] = await mapLimit([
    () => soft(repos.countMembers(), 0, 'countMembers'),
    () => soft(repos.listReservations({ limit: 300 }), [], 'reservations'),
    () => soft(repos.listWaitlist(), [], 'waitlist'),
    () => soft(repos.listNews(), [], 'news'),
    () => soft(repos.listRsvps(), [], 'rsvps'),
    () => soft(repos.listEmployees(), [], 'employees'),
    () => soft(repos.listHrRecords(), [], 'hr'),
    () => soft(repos.listClaims(), [], 'claims'),
    () => soft(repos.listMessages(), [], 'messages'),
    () => soft(repos.listAccessLogs(), [], 'accessLogs'),
    () => soft(repos.listSurveys(), [], 'surveys'),
    () => soft(repos.listGuestPasses(), [], 'guestPasses'),
    () => soft(repos.listAlerts(), [], 'alerts'),
    () => soft(repos.listAlertAcks(), [], 'alertAcks'),
    () => soft(repos.listClubEvents(), [], 'clubEvents'),
    () => soft(repos.listEventRegistrations(), [], 'eventRegs'),
    () => soft(repos.getSetting('zonda'), null, 'zonda'),
    () => soft(repos.getSetting('member_tiers'), null, 'tiers'),
    () => soft(repos.getSetting('disciplines_catalog'), null, 'disciplines'),
    () => soft(repos.countRegisteredProfiles(), 0, 'profilesCount'),
    () => soft(repos.listMembershipApplications(), [], 'applications'),
    () => soft(repos.healthCheck(), { ok: false }, 'health'),
  ]);

  return {
    app: {
      ...emptyAppShell(),
      membersCount: membersCount || 0,
      reservations: reservations || [],
      waitlist: waitlist || [],
      newsList: newsList || [],
      rsvpList: rsvpList || [],
      staffMembers: staffMembers || [],
      staffHrRecords: staffHrRecords || [],
      claims: claims || [],
      messages: messages || [],
      entryLogs: entryLogs || [],
      surveys: surveys || [],
      guestPasses: guestPasses || [],
      isZondaActive: Boolean(zondaSetting?.active),
      tierCatalog: Array.isArray(memberTiersSetting) ? memberTiersSetting : null,
      disciplineCatalog: Array.isArray(disciplinesSetting) ? disciplinesSetting : null,
      registeredUsersCount: registeredUsersCount || 0,
      membershipApplications: membershipApplications || [],
    },
    erp: {
      ...EMPTY_ERP,
      alerts: alerts || [],
      alertAcks: alertAcks || [],
      clubEvents: clubEvents || [],
      eventRegistrations: eventRegistrations || [],
    },
    health: health || { ok: false },
    memberDbIds: {},
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
 * Entrada unificada: socio → shell liviano; ops → shell sin ERP pesado.
 */
export async function bootstrapShellFromDb({ role, memberNumber } = {}) {
  if (!isSupabaseConfigured) return null;
  if (!canAccessAdmin(role) && role !== 'gate_operator') {
    return bootstrapMemberShellFromDb({ memberNumber });
  }
  return bootstrapOpsShellFromDb();
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

export { repos, mapLimit, QUERY_CONCURRENCY };
