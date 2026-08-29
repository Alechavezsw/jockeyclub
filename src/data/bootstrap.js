import { isSupabaseConfigured } from '../lib/supabase';
import * as repos from './repos';

/**
 * Carga rápida del shell (sin padrón completo).
 * El dashboard puede pintar con membersCount mientras llega listMembers.
 */
export async function bootstrapShellFromDb() {
  if (!isSupabaseConfigured) return null;

  const [
    membersCount,
    reservations,
    waitlist,
    newsList,
    rsvpList,
    journalEntries,
    staffMembers,
    staffHrRecords,
    claims,
    messages,
    entryLogs,
    surveys,
    guestPasses,
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
    alerts,
    alertAcks,
    clubEvents,
    eventRegistrations,
    concessions,
    canonPayments,
    zondaSetting,
    memberTiersSetting,
    disciplinesSetting,
    registeredUsersCount,
    membershipApplications,
    health,
  ] = await Promise.all([
    repos.countMembers(),
    repos.listReservations(),
    repos.listWaitlist(),
    repos.listNews(),
    repos.listRsvps(),
    repos.listJournalEntries(),
    repos.listEmployees(),
    repos.listHrRecords(),
    repos.listClaims(),
    repos.listMessages(),
    repos.listAccessLogs(),
    repos.listSurveys(),
    repos.listGuestPasses(),
    repos.listChartOfAccounts(),
    repos.listCashRegisters(),
    repos.listCashSessions(),
    repos.listCashMovements(),
    repos.listExpenses(),
    repos.listSuppliers(),
    repos.listUnidentifiedCollections(),
    repos.listGaliciaDebits(),
    repos.listFixedExpenses(),
    repos.listFixedDiscounts(),
    repos.listPaymentOrders(),
    repos.listAlerts(),
    repos.listAlertAcks(),
    repos.listClubEvents(),
    repos.listEventRegistrations(),
    repos.listConcessions(),
    repos.listCanonPayments(),
    repos.getSetting('zonda'),
    repos.getSetting('member_tiers'),
    repos.getSetting('disciplines_catalog'),
    repos.countRegisteredProfiles(),
    repos.listMembershipApplications(),
    repos.healthCheck(),
  ]);

  return {
    app: {
      members: [],
      membersCount: membersCount || 0,
      reservations,
      waitlist,
      newsList,
      rsvpList,
      journalEntries,
      staffMembers,
      staffHrRecords,
      claims,
      messages,
      entryLogs,
      surveys,
      guestPasses,
      isZondaActive: Boolean(zondaSetting?.active),
      tierCatalog: Array.isArray(memberTiersSetting) ? memberTiersSetting : null,
      disciplineCatalog: Array.isArray(disciplinesSetting) ? disciplinesSetting : null,
      registeredUsersCount: registeredUsersCount || 0,
      membershipApplications: membershipApplications || [],
    },
    erp: {
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
      alerts,
      alertAcks,
      clubEvents,
      eventRegistrations,
      concessions,
      canonPayments,
    },
    health,
    memberDbIds: {},
  };
}

/** Padrón completo (fase 2, en background tras el shell). */
export async function bootstrapMembersFromDb() {
  if (!isSupabaseConfigured) return { members: [], memberDbIds: {} };
  const members = await repos.listMembers();
  return {
    members,
    memberDbIds: Object.fromEntries((members || []).map((m) => [m.memberId, m.id])),
  };
}

/** @deprecated usar bootstrapShellFromDb + bootstrapMembersFromDb */
export async function bootstrapFromDb() {
  const shell = await bootstrapShellFromDb();
  if (!shell) return null;
  const { members, memberDbIds } = await bootstrapMembersFromDb();
  return {
    ...shell,
    app: { ...shell.app, members },
    memberDbIds,
  };
}

export { repos };
