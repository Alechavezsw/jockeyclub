/** Agrega KPIs económicos y operativos para la consola de reportes. */

function sum(arr, pick) {
  return arr.reduce((acc, item) => acc + (Number(pick(item)) || 0), 0);
}

export function buildClubReportStats({
  members = [],
  reservations = [],
  journalEntries = [],
  staffMembers = [],
  claims = [],
  messages = [],
  entryLogs = [],
  surveys = [],
  expenses = [],
  concessions = [],
  clubEvents = [],
  alerts = [],
  cashRegisters = [],
  cashSessions = [],
  canonPayments = [],
  newsList = [],
  totalIngresos = 0,
  totalGastos = 0,
  utilidadNeta = 0,
  totalActivos = 0,
  totalPasivos = 0,
  totalPatrimonioNetoTotal = 0,
} = {}) {
  const activeMembers = members.filter((m) => m.status === 'active');
  const suspendedMembers = members.filter((m) => m.status !== 'active');
  const debtors = members.filter((m) => (Number(m.outstandingBalance) || 0) > 0);
  const debtTotal = sum(debtors, (m) => m.outstandingBalance);
  const alDia = members.filter((m) => (Number(m.outstandingBalance) || 0) <= 0).length;

  const byTier = {};
  for (const m of members) {
    const key = String(m.tier || 'sin_categoria').toLowerCase();
    byTier[key] = (byTier[key] || 0) + 1;
  }

  const confirmed = reservations.filter((r) => r.status === 'confirmed').length;
  const pending = reservations.filter((r) => r.status === 'pending').length;
  const cancelled = reservations.filter((r) => r.status === 'cancelled').length;

  const openClaims = claims.filter((c) => !['closed', 'resolved', 'cerrado'].includes(String(c.status || '').toLowerCase())).length;
  const unreadMessages = messages.filter((m) => !m.isRead).length;
  const activeSurveys = surveys.filter((s) => s.active !== false && (s.status === 'open' || s.status === 'published' || s.active)).length;

  const expensePaid = expenses.filter((e) => e.status === 'paid');
  const expensePending = expenses.filter((e) => ['pending_approval', 'approved', 'draft'].includes(e.status));
  const expensePaidTotal = sum(expensePaid, (e) => e.amount);
  const expensePendingTotal = sum(expensePending, (e) => e.amount);

  const concessionsActive = concessions.filter((c) => ['active', 'expiring'].includes(c.status)).length;
  const canonCollected = sum(canonPayments, (p) => p.amount);

  const openSessions = cashSessions.filter((s) => s.status === 'open').length;
  const cashBalance = sum(cashRegisters, (r) => r.currentBalance ?? r.balance ?? 0);

  const eventsUpcoming = clubEvents.filter((e) => {
    if (!e.date && !e.startsAt) return true;
    const d = new Date(e.date || e.startsAt);
    return !Number.isNaN(d.getTime()) && d >= new Date(new Date().toDateString());
  }).length;

  const alertsOpen = alerts.filter((a) => a.active !== false && a.status !== 'resolved').length;
  const accessToday = entryLogs.filter((l) => {
    const raw = l.timestamp || l.createdAt || l.date || '';
    return String(raw).slice(0, 10) === new Date().toISOString().slice(0, 10);
  }).length;

  const journalLines = journalEntries.reduce((n, e) => n + (e.lines?.length || 0), 0);

  return {
    members: {
      total: members.length,
      active: activeMembers.length,
      suspended: suspendedMembers.length,
      alDia,
      debtors: debtors.length,
      debtTotal,
      byTier,
      adherents: members.reduce((n, m) => n + (m.adherents?.length || 0), 0),
    },
    economic: {
      totalIngresos,
      totalGastos,
      utilidadNeta,
      totalActivos,
      totalPasivos,
      totalPatrimonioNetoTotal,
      expensePaidTotal,
      expensePendingTotal,
      expenseCount: expenses.length,
      canonCollected,
      cashBalance,
      openSessions,
      journalEntries: journalEntries.length,
      journalLines,
    },
    operations: {
      reservations: reservations.length,
      confirmed,
      pending,
      cancelled,
      openClaims,
      claimsTotal: claims.length,
      unreadMessages,
      messagesTotal: messages.length,
      activeSurveys,
      surveysTotal: surveys.length,
      staff: staffMembers.length,
      concessionsActive,
      concessionsTotal: concessions.length,
      eventsUpcoming,
      eventsTotal: clubEvents.length,
      alertsOpen,
      accessToday,
      accessTotal: entryLogs.length,
      news: newsList.length,
    },
  };
}
