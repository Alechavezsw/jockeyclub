import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, Calendar, DollarSign, Activity, MessageSquare, ClipboardList,
  Radio, BookOpen, ShieldAlert, BellRing, CheckCircle2,
  PartyPopper, FileSpreadsheet, Wind, Newspaper,
  DoorOpen, ChevronRight, AlertTriangle, Waves,
} from 'lucide-react';
import { useSedeWeather } from '../../hooks/useSedeWeather';
import { formatObservedClock } from '../../domain/weather/sedeWeather';
import { canAccessConcessions, canAccessQrGate } from '../../domain/auth/roles';
import { reviewItemsForAccess } from '../../domain/review/buildClubReview';
import { isAlertVisible, ALERT_SEVERITY } from '../../domain/alerts/alerts';
import { poolCanonByDay } from '../../domain/pool/poolAccess';
import { buildOpsFinanceSnapshot, collectDeltaAfterCut, composeClubFinance, dueCollectBoard, duesCollectionFromMonthlySummary, financeFromSummary, freshMonthCollectBoard, lilaBookCutDate, lilaContabilidadFromSnapshots } from '../../domain/accounting/opsFinanceSnapshot';
import { monthlyBalanceSeed } from '../../domain/accounting/monthlyBalance';
import { monthlyBalanceSummarySeed } from '../../domain/accounting/monthlyBalanceSummary';
import { detailedCcSeed } from '../../domain/accounting/detailedCurrentAccounts';
import { cashMovementsSeed, cashSeed, mergeAccessinCashMovements } from '../../domain/accounting/cashLedger';
import { cobranzasSeed } from '../../domain/accounting/cobranzas';
import { splitMonthDuesCollection } from '../../domain/accounting/cashPaymentDetail';
import { liquidatedTotalForMonth } from '../../domain/accounting/feePeriodLiquidation';
import { resolveFeePeriods } from '../../domain/accounting/feeBilling';
import { buildPadronHouseholdStats } from '../../domain/members/households';
import { getOverdueMembers } from '../../domain/members/dues';
import { membershipMovesSeed, uniqueBajas } from '../../domain/members/membershipMoves';
import { accessRequestIsOpen } from '../../domain/members/selfService';
import { useSnapshotSeed } from '../../hooks/useSnapshots';
import { snapshotStatus } from '../../data/snapshots';
import { countMembers } from '../../data/repos';
import { formatISODateLongAR, todayISODateAR } from '../../lib/arDate';
import { dedupeAccessLogs } from '../../domain/credentials/accessLog';
import { OpsProgressRing } from './OpsGauge';
import DuesDueBanner from './DuesDueBanner';
import CurrentAccountCutNote from '../erp/CurrentAccountCutNote';
import { summarizeCurrentAccountCut } from '../../domain/accounting/currentAccountBalances';

const MOVES_SNAPSHOTS = ['societasMembershipMoves'];
const LILA_MONEY_LIGHT = [
  'accessinMonthlyBalance',
  'accessinMonthlyBalanceSummary',
  'accessinCashSnapshot',
];
const LILA_MONEY_SNAPSHOTS = [
  ...LILA_MONEY_LIGHT,
  'accessinDetailedCurrentAccounts',
  'accessinCashMovements',
  'accessinCobranzas',
];
const CASH_MOVE_SNAPSHOTS = ['accessinCashMovements', 'accessinCashSnapshot'];
const NO_SNAPSHOTS = [];

function reservationDay(res) {
  return String(res?.date || res?.reservation_date || '').slice(0, 10);
}

function parseLogInstant(log) {
  if (log?.at) {
    const d = new Date(log.at);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const day = String(log?.date || '').slice(0, 10);
  const time = String(log?.time || '00:00').slice(0, 5);
  if (!day) return null;
  const d = new Date(`${day}T${time}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDaysISO(iso, days) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function weekdayLabel(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', '');
}

function formatMoveDay(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '—';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

function compactOpsMoney(amount) {
  const value = Math.abs(Number(amount) || 0);
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `$${m >= 10 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (value >= 1_000) return `$${Math.round(value / 1000)} mil`;
  return `$${Math.round(value)}`;
}

function buildBookingsSnapshot(reservations = [], today = new Date()) {
  const todayKey = todayISODateAR(today);
  const list = Array.isArray(reservations) ? reservations : [];
  const upcoming = list.filter((r) => {
    const day = reservationDay(r);
    return day && day >= todayKey && r.status !== 'cancelled';
  });
  const confirmedUpcoming = upcoming.filter((r) => r.status === 'confirmed');
  const pendingUpcoming = upcoming.filter((r) => r.status === 'pending');
  const todayList = upcoming
    .filter((r) => reservationDay(r) === todayKey)
    .sort((a, b) => String(a.time || a.time_slot || '').localeCompare(String(b.time || b.time_slot || '')));
  const next = [...upcoming]
    .sort((a, b) => {
      const da = `${reservationDay(a)} ${a.time || a.time_slot || ''}`;
      const db = `${reservationDay(b)} ${b.time || b.time_slot || ''}`;
      return da.localeCompare(db);
    })
    .slice(0, 3);
  const pastList = list
    .filter((r) => r.status !== 'cancelled' && reservationDay(r) && reservationDay(r) < todayKey)
    .sort((a, b) => {
      const da = `${reservationDay(a)} ${a.time || a.time_slot || ''}`;
      const db = `${reservationDay(b)} ${b.time || b.time_slot || ''}`;
      return db.localeCompare(da);
    })
    .slice(0, 3);
  const facilityCounts = new Map();
  for (const r of list) {
    if (r.status === 'cancelled') continue;
    const name = r.facilityName || r.facilityId || 'Cancha';
    facilityCounts.set(name, (facilityCounts.get(name) || 0) + 1);
  }
  const topFacilities = [...facilityCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, count]) => ({ name, count }));
  const byDay = new Map();
  const week = Array.from({ length: 7 }, (_, i) => {
    const key = addDaysISO(todayKey, i);
    const dayList = upcoming
      .filter((r) => reservationDay(r) === key)
      .sort((a, b) => String(a.time || a.time_slot || '').localeCompare(String(b.time || b.time_slot || '')));
    byDay.set(key, dayList);
    return {
      key,
      count: dayList.length,
      label: weekdayLabel(key),
      day: key.slice(8, 10),
    };
  });
  return {
    confirmedUpcoming: confirmedUpcoming.length,
    pendingUpcoming: pendingUpcoming.length,
    todayCount: todayList.length,
    todayList: todayList.slice(0, 5),
    next,
    pastList,
    topFacilities,
    maxFacility: topFacilities[0]?.count || 1,
    week,
    byDay,
    pastConfirmed: list.filter((r) => r.status === 'confirmed' && reservationDay(r) < todayKey).length,
  };
}

function formatLongDate(d = new Date()) {
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function opsAlert(id, severity, title, body, tab) {
  return { id, severity, title, body, tab, source: 'ops' };
}

/**
 * Mesa de control asimétrica:
 * 1) atajos
 * 2) Hoy en la sede (agenda / clima / revista)
 * 3) comunicaciones | caja+cuotas+portería | padrón
 */
export default function AdminDashboardTab({
  userRole,
  userName = '',
  permittedTabs,
  goToTab,
  members = [],
  membersLoading = false,
  reservations = [],
  messages = [],
  entryLogs = [],
  surveys = [],
  staffHrRecords = [],
  clubEvents = [],
  alerts = [],
  isZondaActive = false,
  tierCatalog = [],
  totalMembers,
  totalActivos,
  overdueMembersCount = 0,
  upcomingDuesCount = 0,
  totalOutstanding = 0,
  pendingClaimsCount = 0,
  activeBookingsCount = 0,
  formatCurrency,
  getAccountBalance,
  journalEntries = [],
  chartOfAccounts = [],
  feePeriods = [],
  poolAccesses = [],
  accessinCashMovements = [],
  membershipApplications = [],
  portalAccessRequests = [],
  jevReview = null,
}) {
  const [alertIndex, setAlertIndex] = useState(0);
  const alertHold = useRef(false);
  const [agendaDay, setAgendaDay] = useState(null);
  const [showAllTodayIncomes, setShowAllTodayIncomes] = useState(false);
  const [showAllGateEntries, setShowAllGateEntries] = useState(false);
  const showGate = canAccessQrGate(userRole);
  const pendingMembershipApps = useMemo(
    () => (membershipApplications || []).filter((a) => a.status === 'pending').length
      + (portalAccessRequests || []).filter((a) => accessRequestIsOpen(a)).length,
    [membershipApplications, portalAccessRequests]
  );
  const todayKey = todayISODateAR();
  const hasAccounting = permittedTabs.includes('accounting')
    || permittedTabs.includes('operation')
    || permittedTabs.includes('books');
  const [heavyMoney, setHeavyMoney] = useState(false);
  useEffect(() => {
    if (!hasAccounting) return undefined;
    const arm = () => setHeavyMoney(true);
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(arm, { timeout: 1200 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(arm, 500);
    return () => window.clearTimeout(id);
  }, [hasAccounting]);
  const lilaCut = useSnapshotSeed(
    hasAccounting ? (heavyMoney ? LILA_MONEY_SNAPSHOTS : LILA_MONEY_LIGHT) : NO_SNAPSHOTS,
    () => {
      const summary = monthlyBalanceSummarySeed();
      const latestCut = financeFromSummary({
        snapshot: summary.ACCESSIN_MONTHLY_BALANCE_SUMMARY_SNAPSHOT,
        sections: summary.ACCESSIN_MONTHLY_BALANCE_SUMMARY_SECTIONS,
      });
      const detailed = lilaContabilidadFromSnapshots({
        monthlySnapshot: monthlyBalanceSeed().ACCESSIN_MONTHLY_BALANCE_SNAPSHOT,
        detailedSnapshot: detailedCcSeed().ACCESSIN_DETAILED_CC_SNAPSHOT,
        cashSnapshot: cashSeed().ACCESSIN_CASH_SNAPSHOT,
        cobranzas: cobranzasSeed().ACCESSIN_COBRANZAS,
        day: todayKey,
      });
      const base = latestCut || detailed;
      if (!base) return null;
      return {
        ...base,
        lastIncomes: detailed?.lastIncomes || base.lastIncomes || [],
      };
    },
  );
  const lilaMoney = useMemo(
    () => composeClubFinance({
      lila: lilaCut,
      members,
      journalEntries,
      chartOfAccounts,
      feePeriods,
      today: todayKey,
    }) || lilaCut,
    [lilaCut, members, journalEntries, chartOfAccounts, feePeriods, todayKey],
  );
  const hasMembers = permittedTabs.includes('members');

  const bookings = useMemo(() => buildBookingsSnapshot(reservations), [reservations]);
  const selectedAgendaDay = useMemo(() => {
    const keys = new Set(bookings.week.map((d) => d.key));
    if (agendaDay && keys.has(agendaDay)) return agendaDay;
    const nextBusy = bookings.week.find((d) => d.count > 0);
    return nextBusy?.key || todayKey;
  }, [agendaDay, bookings.week, todayKey]);
  const agendaList = bookings.byDay.get(selectedAgendaDay) || [];

  const msgStats = useMemo(() => {
    const list = Array.isArray(messages) ? messages : [];
    // Bandeja de administración: solo mensajes dirigidos a "ops" (los enviados
    // por el propio staff nunca se marcan leídos y no deben inflar el badge).
    const inbox = list.filter((m) => m.recipientId === 'ops');
    const total = inbox.length;
    const unread = inbox.filter((m) => !m.isRead).length;
    const unanswered = inbox.filter((m) => !m.isRead && !m.parentId).length;
    const inProgress = Math.max(0, total - unread);
    const attention = unanswered + Math.max(0, unread - unanswered);
    const recent = [...inbox]
      .sort((a, b) => String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || '')))
      .slice(0, 3);
    return { total, unread, unanswered, inProgress, attention, recent };
  }, [messages]);

  const todayEntries = useMemo(() => {
    const todays = dedupeAccessLogs(entryLogs)
      .map((log) => ({ log, at: parseLogInstant(log) }))
      .filter(({ log, at }) => {
        const day = String(log.date || '').slice(0, 10);
        if (day === todayKey) return true;
        return at ? todayISODateAR(at) === todayKey : false;
      })
      .sort((a, b) => (b.at?.getTime() || 0) - (a.at?.getTime() || 0));
    const list = todays.map(({ log, at }) => ({
      ...log,
      timeLabel: at
        ? at.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
        : (log.time || '—'),
    }));
    return {
      list,
      preview: list.slice(0, 5),
      granted: list.filter((l) => l.status === 'granted' || l.status === 'ok').length,
      denied: list.filter((l) => l.status === 'denied' || l.status === 'blocked').length,
      todayTotal: list.length,
    };
  }, [entryLogs, todayKey]);

  const activeAlerts = useMemo(
    () => (alerts || []).filter((a) => isAlertVisible(a)),
    [alerts],
  );

  const nextEvent = useMemo(() => {
    const now = Date.now();
    return [...(clubEvents || [])]
      .filter((e) => e.status !== 'cancelled' && new Date(e.startsAt).getTime() >= now - 86400000)
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))[0] || null;
  }, [clubEvents]);

  const { weather, status: weatherStatus } = useSedeWeather({ isZondaActive });
  const weatherClosed = weather?.outdoor === 'closed';
  const weatherCaution = weather?.outdoor === 'caution';

  const hrPending = useMemo(
    () => (staffHrRecords || []).filter((r) => r.status === 'pending').length,
    [staffHrRecords],
  );

  const deferredMembers = useDeferredValue(members);
  const accountCut = useMemo(() => summarizeCurrentAccountCut(deferredMembers), [deferredMembers]);
  const household = useMemo(
    () => buildPadronHouseholdStats(deferredMembers, { tierCatalog }),
    [deferredMembers, tierCatalog]
  );
  const padronTop = useMemo(() => {
    const top = household.byTier.slice(0, 5);
    const rest = household.byTier.slice(5);
    const restCount = rest.reduce((n, t) => n + t.count, 0);
    const restCats = rest.length;
    const max = top[0]?.count || 1;
    return { top, rest, restCount, restCats, max };
  }, [household.byTier]);

  const monthKey = todayKey.slice(0, 7);
  const [monthYear, monthNumber] = monthKey.split('-');
  const monthRaw = new Date(Number(monthYear), Number(monthNumber) - 1, 1)
    .toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  const moneyMonthLabel = monthRaw.charAt(0).toUpperCase() + monthRaw.slice(1);
  const seededMoves = useSnapshotSeed(
    hasAccounting && heavyMoney ? CASH_MOVE_SNAPSHOTS : NO_SNAPSHOTS,
    () => cashMovementsSeed().ACCESSIN_CASH_MOVEMENTS,
  );
  const seededRecent = useSnapshotSeed(
    hasAccounting ? ['accessinCashSnapshot'] : NO_SNAPSHOTS,
    () => cashSeed().ACCESSIN_CASH_SNAPSHOT?.recentMovements || [],
  );
  const cashMoves = useMemo(
    () => mergeAccessinCashMovements(
      mergeAccessinCashMovements(seededMoves, seededRecent),
      accessinCashMovements,
    ),
    [seededMoves, seededRecent, accessinCashMovements],
  );
  const finance = useMemo(
    () => buildOpsFinanceSnapshot({
      members: deferredMembers,
      journalEntries,
      chartOfAccounts,
      getAccountBalance,
    }),
    [deferredMembers, journalEntries, chartOfAccounts, getAccountBalance]
  );

  const duesBoard = useMemo(() => {
    const summarySnapshot = monthlyBalanceSummarySeed().ACCESSIN_MONTHLY_BALANCE_SUMMARY_SNAPSHOT;
    const lilaMonth = duesCollectionFromMonthlySummary({
      snapshot: summarySnapshot,
      sections: monthlyBalanceSummarySeed().ACCESSIN_MONTHLY_BALANCE_SUMMARY_SECTIONS,
      monthKey,
    });
    const periods = resolveFeePeriods(feePeriods);
    const liquidated = Number(liquidatedTotalForMonth(periods, monthKey, { members: deferredMembers, tierCatalog })) || 0;
    const todaySplit = splitMonthDuesCollection({
      movements: cashMoves,
      members: deferredMembers,
      monthKey,
      onDate: todayKey,
    });
    const summaryState = snapshotStatus('accessinMonthlyBalanceSummary');
    const summarySettled = summaryState === 'ready' || summaryState === 'error';
    const stacked = lilaMonth
      ? dueCollectBoard({
        lilaMonth,
        summarySettled: true,
        delta: collectDeltaAfterCut({
          movements: cashMoves,
          members: deferredMembers,
          journalEntries,
          chartOfAccounts,
          feePeriods,
          monthKey,
          baseLiquidated: lilaMonth.liquidated,
          cutDate: lilaBookCutDate(cashSeed().ACCESSIN_CASH_SNAPSHOT, summarySnapshot),
        }),
      })
      : (summarySettled
        ? freshMonthCollectBoard({
          monthKey,
          feePeriods,
          movements: cashMoves,
          members: deferredMembers,
          journalEntries,
          chartOfAccounts,
          liquidated,
        })
        : null);
    if (!stacked) return null;
    const collected = stacked.collected;
    const liquidado = stacked.liquidated;
    const rate = Number.isFinite(stacked.rate)
      ? stacked.rate
      : (liquidado > 0 ? Math.round((collected / liquidado) * 100) : 0);
    return {
      recaudado: collected,
      liquidated: liquidado,
      rate,
      today: todaySplit.recaudado,
      cuotaMes: stacked.cuotaMes,
      atrasadas: stacked.atrasadas,
      posteriores: stacked.posteriores,
      recargos: stacked.recargos,
      reservas: stacked.reservas,
      porteria: stacked.porteria,
    };
  }, [membersLoading, feePeriods, monthKey, deferredMembers, tierCatalog, cashMoves, todayKey, journalEntries, chartOfAccounts]);
  const liveCollectionRate = duesBoard?.rate ?? 0;
  const standingCaption = duesBoard
    ? `${formatCurrency(duesBoard.recaudado)} de ${formatCurrency(duesBoard.liquidated)} liquidado`
    : '\u00a0';
  const collectionTone = liveCollectionRate >= 80 ? 'ok' : liveCollectionRate >= 50 ? 'mid' : 'low';
  const debtTotal = finance.debtTotal || totalOutstanding || 0;
  const todayIncomes = useMemo(() => {
    const lilaToday = (lilaMoney?.lastIncomes || []).filter((row) => row.date === todayKey);
    return lilaToday.length ? lilaToday : (finance.todayIncomes || []);
  }, [lilaMoney, todayKey, finance.todayIncomes]);

  const poolMonthRows = useMemo(
    () => poolCanonByDay(poolAccesses, { month: todayKey.slice(0, 7) }),
    [poolAccesses, todayKey],
  );
  const monthIncomeByDay = useMemo(() => {
    const [y, m] = monthKey.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const endDay = todayKey.startsWith(monthKey)
      ? Number(todayKey.slice(8, 10))
      : daysInMonth;
    const totals = new Map();
    for (let day = 1; day <= endDay; day += 1) totals.set(day, 0);

    const seen = new Set();
    const bump = (dateStr, amount, id) => {
      const date = String(dateStr || '').slice(0, 10);
      if (!date.startsWith(monthKey)) return;
      const day = Number(date.slice(8, 10));
      if (!totals.has(day)) return;
      const key = id ? String(id) : `${date}:${Number(amount) || 0}`;
      if (seen.has(key)) return;
      seen.add(key);
      totals.set(day, (totals.get(day) || 0) + (Number(amount) || 0));
    };

    for (const row of cashMoves || []) {
      const movementType = String(row?.movementType || 'income');
      if (movementType === 'expense' || movementType === 'transfer_out') continue;
      const amount = Number(row?.amount) || 0;
      if (amount <= 0) continue;
      bump(row?.date, amount, row?.accessinId ?? row?.id);
    }
    for (const row of poolMonthRows || []) {
      bump(row.date, row.amount, row.id || `pool-${row.date}`);
    }
    for (const row of finance.recentIncomes || []) {
      if (/^canon pileta/i.test(String(row.label || ''))) continue;
      bump(row.date, row.amount, row.id);
    }

    const days = Array.from(totals.entries()).map(([day, amount]) => ({
      day,
      amount,
      isToday: todayKey === `${monthKey}-${String(day).padStart(2, '0')}`,
    }));
    const max = Math.max(1, ...days.map((row) => row.amount));
    const total = days.reduce((sum, row) => sum + row.amount, 0);
    return { days, max, total };
  }, [cashMoves, finance.recentIncomes, monthKey, poolMonthRows, todayKey]);
  const todayIncomeRows = useMemo(() => {
    const poolToday = poolMonthRows.find((row) => row.date === todayKey);
    const base = (todayIncomes || []).filter((row) => !/^canon pileta/i.test(String(row.label || '')));
    return poolToday ? [poolToday, ...base] : base;
  }, [poolMonthRows, todayKey, todayIncomes]);

  const overdueTop = useMemo(
    () => getOverdueMembers(deferredMembers).slice(0, 5),
    [deferredMembers],
  );

  const [offRoster, setOffRoster] = useState(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      countMembers('inactive'),
      countMembers('suspended'),
    ]).then(([inactive, suspended]) => {
      if (!cancelled) setOffRoster({ inactive, suspended });
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const padronStatus = useMemo(() => {
    let active = 0;
    for (const m of deferredMembers) {
      if (m.status !== 'inactive' && m.status !== 'suspended') active += 1;
    }
    return {
      active,
      inactive: offRoster?.inactive ?? 0,
      suspended: offRoster?.suspended ?? 0,
    };
  }, [deferredMembers, offRoster]);

  // Altas y bajas de Societas (nombre y DNI): solo se piden si se ve el padrón.
  const movesSeed = useSnapshotSeed(hasMembers ? MOVES_SNAPSHOTS : NO_SNAPSHOTS, membershipMovesSeed);
  const movePulse = useMemo(() => {
    const {
      SOCIETAS_MEMBERSHIP_ALTAS,
      SOCIETAS_MEMBERSHIP_BAJAS,
      SOCIETAS_MEMBERSHIP_MOVES_SNAPSHOT: snap,
    } = movesSeed;
    const altas = [...SOCIETAS_MEMBERSHIP_ALTAS]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 3);
    const bajas = uniqueBajas(SOCIETAS_MEMBERSHIP_BAJAS).slice(0, 3);
    // Socios dados de alta en la app después del último sync de Societas
    // (todavía no llegaron al importador, pero ya son socios reales).
    const knownIds = new Set(SOCIETAS_MEMBERSHIP_ALTAS.map((row) => String(row.memberId)));
    const liveAltas = (members || [])
      .filter((m) => m.joinDate && (!snap.periodTo || m.joinDate > snap.periodTo) && !knownIds.has(String(m.memberId)))
      .map((m) => ({ memberId: m.memberId, name: m.name, date: m.joinDate, move: 'alta' }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return {
      altas: (Number(snap.altas) || 0) + liveAltas.length,
      bajas: Number(snap.bajas) || 0,
      from: snap.periodFrom,
      to: snap.periodTo,
      recent: [
        ...liveAltas.map((row) => ({ ...row, move: 'alta' })),
        ...altas.map((row) => ({ ...row, move: 'alta' })),
        ...bajas.map((row) => ({ ...row, move: 'baja' })),
      ]
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 4),
    };
  }, [movesSeed, members]);

  const activeSurveys = (surveys || []).filter((s) => s.active !== false && (s.status === 'open' || s.status === 'published' || s.active)).length;

  const quickActions = [
    {
      tab: 'dues',
      tone: overdueMembersCount > 0 ? 'danger' : 'gold',
      icon: ShieldAlert,
      title: 'Cobranza',
      hint: overdueMembersCount > 0
        ? `${overdueMembersCount} en mora · ${formatCurrency(totalOutstanding)}`
        : upcomingDuesCount > 0
          ? `${upcomingDuesCount} a vencer en 15 días`
          : 'Padrón al día',
      badge: overdueMembersCount > 0 ? String(overdueMembersCount) : null,
    },
    {
      tab: 'messaging',
      tone: msgStats.unanswered > 0 || msgStats.unread > 0 ? 'warn' : 'gold',
      icon: MessageSquare,
      title: 'Mensajería',
      hint: msgStats.unanswered > 0
        ? `${msgStats.unanswered} sin responder`
        : msgStats.unread > 0
          ? `${msgStats.unread} sin leer`
          : 'Escribir a socios',
      badge: (msgStats.unanswered || msgStats.unread) || null,
    },
    {
      tab: 'bookings',
      tone: 'emerald',
      icon: Calendar,
      title: 'Reservas',
      hint: bookings.pendingUpcoming > 0
        ? `${bookings.pendingUpcoming} por confirmar`
        : bookings.confirmedUpcoming > 0
          ? `${bookings.confirmedUpcoming} próximas confirmadas`
          : bookings.todayCount > 0
            ? `${bookings.todayCount} para hoy`
            : 'Sin turnos próximos',
      badge: bookings.pendingUpcoming > 0 ? String(bookings.pendingUpcoming) : null,
    },
    {
      tab: 'news',
      tone: 'gold',
      icon: Newspaper,
      title: 'Revista',
      hint: 'Novedades en el portal del socio',
    },
    {
      tab: 'reports',
      tone: 'gold',
      icon: FileSpreadsheet,
      title: 'Informes',
      hint: 'Estadísticas, PDF y exportaciones',
    },
    {
      tab: 'members',
      tone: 'gold',
      icon: Users,
      title: 'Padrón',
      hint: `${totalMembers || members.length} socios titulares`,
    },
    {
      tab: 'surveys',
      tone: 'gold',
      icon: Radio,
      title: 'Encuestas',
      hint: activeSurveys > 0 ? `${activeSurveys} consulta${activeSurveys === 1 ? '' : 's'} abierta${activeSurveys === 1 ? '' : 's'}` : 'Crear consulta colectiva',
      badge: activeSurveys > 0 ? String(activeSurveys) : null,
    },
    {
      tab: 'claims',
      tone: pendingClaimsCount > 0 ? 'warn' : 'gold',
      icon: ClipboardList,
      title: 'Reclamos',
      hint: pendingClaimsCount > 0 ? `${pendingClaimsCount} abiertos` : 'Sin pendientes',
      badge: pendingClaimsCount > 0 ? String(pendingClaimsCount) : null,
    },
    {
      tab: 'pool_gate',
      tone: 'emerald',
      icon: Waves,
      title: 'Puerta pileta',
      hint: 'Buscar socio, cobrar canon y habilitar',
      roles: ['pool_operator', 'admin_employee'],
    },
    {
      tab: 'operation',
      focus: 'cash',
      tone: 'emerald',
      icon: DollarSign,
      title: 'Arqueo',
      hint: 'Cajas y movimientos del día',
      roles: ['cashier'],
    },
    {
      tab: 'accounting',
      tone: 'gold',
      icon: BookOpen,
      title: 'Contabilidad',
      hint: 'Libro diario y balances',
      roles: ['accountant'],
    },
  ]
    .filter((a) => (
      (a.tab === 'pool_gate' ? permittedTabs.includes('pool') : permittedTabs.includes(a.tab))
      && (!a.roles || a.roles.includes(userRole))
    ))
    .slice(0, 4);

  const jevVisible = jevReview
    ? reviewItemsForAccess(jevReview.items, {
      tabs: permittedTabs,
      concessions: canAccessConcessions(userRole),
    })
    : [];

  const rotatingAlerts = useMemo(() => {
    const extras = [];
    if (permittedTabs.includes('claims') && pendingClaimsCount > 0) {
      extras.push(opsAlert(
        'ops-claims',
        'warning',
        'Reclamos abiertos',
        `${pendingClaimsCount} ${pendingClaimsCount === 1 ? 'reclamo espera' : 'reclamos esperan'} respuesta.`,
        'claims',
      ));
    }
    if (permittedTabs.includes('members') && pendingMembershipApps > 0) {
      extras.push(opsAlert(
        'ops-access',
        'warning',
        'Pedidos de acceso',
        `${pendingMembershipApps} ${pendingMembershipApps === 1 ? 'pedido espera' : 'pedidos esperan'} revisión.`,
        'members',
      ));
    }
    if (permittedTabs.includes('dues') && overdueMembersCount > 0) {
      extras.push(opsAlert(
        'ops-dues',
        'warning',
        'Socios con deuda',
        `${overdueMembersCount} ${overdueMembersCount === 1 ? 'titular tiene' : 'titulares tienen'} saldo vencido.`,
        'dues',
      ));
    }
    if (permittedTabs.includes('bookings') && bookings.pendingUpcoming > 0) {
      extras.push(opsAlert(
        'ops-bookings',
        'info',
        'Reservas por confirmar',
        `${bookings.pendingUpcoming} ${bookings.pendingUpcoming === 1 ? 'turno pendiente' : 'turnos pendientes'}.`,
        'bookings',
      ));
    }
    if (permittedTabs.includes('messaging') && msgStats.unanswered > 0) {
      extras.push(opsAlert(
        'ops-messages',
        'info',
        'Mensajes sin responder',
        `${msgStats.unanswered} ${msgStats.unanswered === 1 ? 'mensaje en' : 'mensajes en'} la bandeja.`,
        'messaging',
      ));
    }
    if (permittedTabs.includes('staff') && hrPending > 0) {
      extras.push(opsAlert(
        'ops-hr',
        'info',
        'Legajos pendientes',
        `${hrPending} ${hrPending === 1 ? 'registro de personal por revisar' : 'registros de personal por revisar'}.`,
        'staff',
      ));
    }
    if (permittedTabs.includes('jev') && jevVisible.length > 0) {
      extras.push(opsAlert(
        'ops-jev',
        'info',
        'Fichas para revisar',
        `${jevVisible.length} ${jevVisible.length === 1 ? 'punto de Jev' : 'puntos de Jev'} con algo para mirar.`,
        'jev',
      ));
    }
    const seen = new Set(activeAlerts.map((alert) => alert.id));
    return [...activeAlerts, ...extras.filter((alert) => !seen.has(alert.id))].slice(0, 8);
  }, [
    activeAlerts,
    permittedTabs,
    pendingClaimsCount,
    pendingMembershipApps,
    overdueMembersCount,
    bookings.pendingUpcoming,
    msgStats.unanswered,
    hrPending,
    jevVisible.length,
  ]);

  const shownAlertIndex = rotatingAlerts.length ? alertIndex % rotatingAlerts.length : 0;

  useEffect(() => {
    if (rotatingAlerts.length < 2) return undefined;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      if (alertHold.current) return;
      setAlertIndex((index) => (index + 1) % rotatingAlerts.length);
    }, 11000);
    return () => window.clearInterval(timer);
  }, [rotatingAlerts.length]);

  const link = (label, onClick) => (
    <button type="button" className="ops-dash-link" onClick={onClick}>
      {String(label).replace(/\s*>+\s*$/, '')}
    </button>
  );

  const jevTeaser = permittedTabs.includes('jev') && jevReview ? (
    <button type="button" className="jev-teaser" onClick={() => goToTab('jev')}>
      <span className="jev-teaser-kicker">Jev</span>
      <strong className="tabular-nums">
        {jevReview.counts?.ready === false
          ? '…'
          : Number(jevReview.counts?.bien || 0).toLocaleString('es-AR')}
      </strong>
      <span>socios con la ficha bien</span>
      <em>
        {jevVisible.length === 0
          ? 'Nada pendiente'
          : `${jevVisible.length} para revisar`}
      </em>
    </button>
  ) : null;

  return (
    <div className="fade-in ops-dash">
      <section className="ops-dash-hero ops-dash-hero--solo">
        <div className="ops-dash-hero-main">
          <h2 className="ops-dash-title">Panel de administración</h2>
          {userName ? (
            <p className="ops-dash-kicker" style={{ marginTop: '-0.55rem', marginBottom: '0.85rem' }}>
              {userName} · {formatLongDate()}
            </p>
          ) : null}
          {(permittedTabs.includes('dues') || permittedTabs.includes('accounting') || permittedTabs.includes('operation')) ? (
            <DuesDueBanner
              today={todayKey}
              members={members}
              membersLoading={membersLoading}
              journalEntries={journalEntries}
              chartOfAccounts={chartOfAccounts}
              feePeriods={feePeriods}
              tierCatalog={tierCatalog}
              cashMovements={cashMoves}
            />
          ) : null}
          <div className="ops-dash-actions" aria-label="Accesos rápidos">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  type="button"
                  key={`${action.tab}-${action.title}`}
                  className={`ops-dash-action tone-${action.tone || 'gold'}`}
                  onClick={() => goToTab(action.tab, action.focus || null)}
                >
                  <span className="ops-dash-action-icon" aria-hidden="true">
                    <Icon size={20} strokeWidth={1.75} />
                    {action.badge ? <em>{action.badge}</em> : null}
                  </span>
                  <span className="ops-dash-action-copy">
                    <strong>{action.title}</strong>
                    <small>{action.hint}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Hoy en la sede — agenda / clima / revista */}
      <section className="ops-today" aria-label="Hoy en la sede">
        <header className="ops-today-head">
          <p className="ops-today-kicker">Hoy en la sede</p>
          <time className="ops-today-date" dateTime={todayKey}>{formatLongDate()}</time>
        </header>
        <div className="ops-today-grid">
          <article className="ops-today-pane ops-today-pane--agenda">
            <header className="ops-today-pane-head">
              <Calendar size={15} aria-hidden="true" />
              <h3>Agenda del día</h3>
              {agendaList.length > 0 ? (
                <span className="ops-today-badge">{agendaList.length}</span>
              ) : null}
            </header>
            <ul className="ops-week" aria-label="Turnos de los próximos 7 días">
              {bookings.week.map((d) => {
                const selected = d.key === selectedAgendaDay;
                const isToday = d.key === todayKey;
                const classes = [
                  isToday ? 'is-today' : '',
                  d.count > 0 ? 'is-busy' : '',
                  selected ? 'is-selected' : '',
                ].filter(Boolean).join(' ');
                return (
                  <li key={d.key}>
                    <button
                      type="button"
                      className={classes || undefined}
                      aria-pressed={selected}
                      aria-current={isToday ? 'date' : undefined}
                      aria-label={`${d.label} ${d.day}, ${d.count} ${d.count === 1 ? 'turno' : 'turnos'}`}
                      onClick={() => setAgendaDay(d.key)}
                    >
                      <span className="ops-week-dow">{d.label}</span>
                      <b className="ops-week-date tabular-nums">{d.day}</b>
                      <small
                        className={`ops-week-count tabular-nums${d.count > 0 ? '' : ' is-empty'}`}
                        aria-hidden="true"
                      >
                        {d.count > 0 ? d.count : ''}
                      </small>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="ops-today-next-label">
              {selectedAgendaDay === todayKey ? 'Hoy' : formatISODateLongAR(selectedAgendaDay)}
            </p>
            {agendaList.length === 0 ? (
              <p className="ops-muted ops-today-empty">
                Sin turnos
                {selectedAgendaDay === todayKey && bookings.pastConfirmed > 0
                  ? ` · ${bookings.pastConfirmed} históricas en el libro`
                  : ''}
                .
              </p>
            ) : (
              <ul className="ops-today-list">
                {agendaList.map((res) => (
                  <li key={res.id || `${reservationDay(res)}-${res.time || res.time_slot}`}>
                    <span className="ops-today-time tabular-nums">
                      {String(res.time || res.time_slot || '—').slice(0, 5)}
                    </span>
                    <span className="ops-today-copy">
                      <strong>{res.facilityName || res.facilityId}</strong>
                      <small>
                        {res.memberName || 'Socio'}
                        {res.status === 'pending' ? ' · por confirmar' : ''}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {bookings.topFacilities.length > 0 ? (
              <div className="ops-today-fill">
                <p className="ops-today-next-label">Canchas más pedidas</p>
                <ul className="ops-mini-bars" aria-label="Canchas con más reservas">
                  {bookings.topFacilities.map((f) => (
                    <li key={f.name}>
                      <div className="ops-mini-bars-meta">
                        <span>{f.name}</span>
                        <b className="tabular-nums">{f.count}</b>
                      </div>
                      <div className="ops-mini-bars-track" aria-hidden="true">
                        <span style={{ width: `${Math.max(10, Math.round((f.count / bookings.maxFacility) * 100))}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {agendaList.length === 0 && bookings.pastList.length > 0 ? (
              <div className="ops-today-fill ops-today-fill--scroll">
                <p className="ops-today-next-label">Últimos turnos</p>
                <ul className="ops-today-list">
                  {bookings.pastList.map((res) => (
                    <li key={res.id || `${reservationDay(res)}-${res.time || res.time_slot}-past`}>
                      <span className="ops-today-time tabular-nums">
                        {formatMoveDay(reservationDay(res))}
                      </span>
                      <span className="ops-today-copy">
                        <strong>{res.facilityName || res.facilityId}</strong>
                        <small>
                          {String(res.time || res.time_slot || '—').slice(0, 5)}
                          {res.memberName ? ` · ${res.memberName}` : ''}
                        </small>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {weatherClosed || weatherCaution ? (
              <p className={`ops-today-note ${weatherClosed ? 'is-closed' : 'is-caution'}`}>
                {weatherClosed
                  ? 'Outdoor en pausa · conviene canchas cubiertas.'
                  : 'Outdoor con precaución · avisar a profesores.'}
              </p>
            ) : null}
            {nextEvent ? (
              <div className="ops-today-event">
                <PartyPopper size={14} aria-hidden="true" />
                <div>
                  <strong>{nextEvent.title}</strong>
                  <small>
                    {new Date(nextEvent.startsAt).toLocaleDateString('es-AR', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {nextEvent.location ? ` · ${nextEvent.location}` : ''}
                  </small>
                </div>
              </div>
            ) : null}
            {permittedTabs.includes('bookings') && (
              <div className="ops-today-pane-foot">
                <button type="button" className="ops-dash-link" onClick={() => goToTab('bookings')}>
                  Nueva reserva
                </button>
                <Link to="/panel/bookings" className="ops-dash-link">
                  Ver agenda completa
                </Link>
              </div>
            )}
          </article>

          <article className={`ops-today-pane ops-today-pane--weather ${weatherClosed ? 'is-zonda' : weatherCaution ? 'is-caution' : ''}`}>
            <header className="ops-today-pane-head">
              <Wind size={15} aria-hidden="true" />
              <h3>Clima operativo</h3>
            </header>
            {weatherStatus === 'error' && !weather ? (
              <p className="ops-muted ops-today-empty">No se pudo leer el clima de Rivadavia.</p>
            ) : !weather ? (
              <p className="ops-muted ops-today-empty">Leyendo estación de Rivadavia…</p>
            ) : (
              <>
                <div className="ops-weather-now">
                  <strong className="ops-weather-temp">
                    {Math.round(weather.temperature)}°
                  </strong>
                  <div className="ops-weather-now-copy">
                    <span className="ops-weather-condition">{weather.condition}</span>
                    <span className="ops-weather-meta">
                      Rivadavia
                      {formatObservedClock(weather.observedAt) ? ` · ${formatObservedClock(weather.observedAt)}` : ''}
                    </span>
                    <span className="ops-weather-meta">
                      Humedad {Math.round(weather.humidity)}% · {weather.windLabel}
                      {weather.gustsKmh ? ` · ráfagas ${Math.round(weather.gustsKmh)}` : ''}
                    </span>
                  </div>
                </div>
                <div className="ops-weather-status">
                  <span className={`ops-weather-pill ${weather.pill.tone}`}>
                    {weather.pill.label}
                  </span>
                  <p>{weather.summary}</p>
                </div>
                <p
                  className={`ops-weather-outdoor ${weatherClosed ? 'closed' : weatherCaution ? 'caution' : ''}`}
                  aria-label={`Canchas outdoor: ${weather.outdoorLabel}`}
                >
                  <span>Canchas outdoor</span>
                  <em>{weather.outdoorLabel}</em>
                </p>
              </>
            )}
          </article>

          <article
            className="ops-today-pane ops-today-pane--alerts"
            onMouseEnter={() => { alertHold.current = true; }}
            onMouseLeave={() => { alertHold.current = false; }}
            onFocusCapture={() => { alertHold.current = true; }}
            onBlurCapture={() => { alertHold.current = false; }}
          >
            <header className="ops-today-pane-head">
              <BellRing size={15} aria-hidden="true" />
              <h3>Alertas</h3>
              {rotatingAlerts.length > 1 ? (
                <span className="ops-alert-dots" role="tablist" aria-label="Otras alertas">
                  {rotatingAlerts.map((alert, index) => (
                    <button
                      key={alert.id}
                      type="button"
                      role="tab"
                      aria-selected={index === shownAlertIndex}
                      aria-label={alert.title}
                      className={index === shownAlertIndex ? 'is-on' : ''}
                      onClick={() => setAlertIndex(index)}
                    />
                  ))}
                </span>
              ) : null}
              {rotatingAlerts.length > 0 ? (
                <span className="ops-today-badge">{rotatingAlerts.length}</span>
              ) : null}
            </header>
            {rotatingAlerts.length === 0 ? (
              <p className="ops-muted ops-today-empty">Sin alertas vigentes.</p>
            ) : (
              <ul className="ops-today-alerts ops-today-alerts--cycle">
                {rotatingAlerts.slice(shownAlertIndex, shownAlertIndex + 1).map((a) => {
                  const sev = a.severity || 'info';
                  const Icon = sev === 'critical'
                    ? ShieldAlert
                    : sev === 'warning'
                      ? AlertTriangle
                      : BellRing;
                  const openTab = a.tab || (permittedTabs.includes('alerts') ? 'alerts' : '');
                  return (
                    <li key={a.id} className={`ops-today-alert-item sev-${sev}`}>
                      <button
                        type="button"
                        className="ops-today-alert-hit"
                        onClick={openTab ? () => goToTab(openTab) : undefined}
                      >
                        <span className="ops-today-alert-icon" aria-hidden="true">
                          <Icon size={18} strokeWidth={2.2} />
                        </span>
                        <span className="ops-today-alert-body">
                          <em className="ops-today-alert-sev">
                            {ALERT_SEVERITY[sev]?.label || 'Alerta'}
                          </em>
                          <strong>{a.title}</strong>
                          {a.body ? <small>{a.body}</small> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {jevTeaser}
          </article>
        </div>
      </section>

      <section className={`ops-dash-main ${!hasAccounting ? 'ops-dash-main--ops' : ''}`}>
        {/* IZQUIERDA — Contabilidad */}
        <div className="ops-dash-col ops-dash-col--center">
          {hasAccounting ? (
            <>
              <article className="glass-card ops-card ops-tile ops-tile--money">
                <header className="ops-card-head ops-card-head--split">
                  <div>
                    {userRole === 'cashier' ? (
                      <DollarSign size={16} color="var(--primary-gold)" />
                    ) : (
                      <BookOpen size={16} color="var(--primary-gold)" />
                    )}
                    <h3>
                      {userRole === 'cashier' ? 'Caja' : 'Contabilidad'}
                      <CurrentAccountCutNote members={members} />
                    </h3>
                    {accountCut.asOf ? (
                      <p className="ops-muted" style={{ margin: '0.2rem 0 0', fontSize: '0.78rem' }}>
                        Cuentas corrientes al {formatISODateLongAR(accountCut.asOf)}
                      </p>
                    ) : null}
                  </div>
                  <span className="ops-month">{moneyMonthLabel}</span>
                </header>

                <div className="ops-money-hero">
                  <OpsProgressRing
                    value={Math.min(100, Math.max(0, liveCollectionRate))}
                    tone={collectionTone}
                    title={standingCaption}
                  />
                  <div>
                    <div className="ops-money-big">{duesBoard ? `${liveCollectionRate}%` : '\u00a0'}</div>
                    <div className="ops-muted">{standingCaption}</div>
                    <div className="ops-muted" style={{ marginTop: '0.25rem', fontSize: '0.78rem' }}>
                      Hoy:{' '}
                      <strong style={{ color: (duesBoard?.today || 0) > 0 ? 'var(--emerald-accent)' : 'inherit' }}>
                        {duesBoard ? formatCurrency(duesBoard.today || 0) : '\u00a0'}
                      </strong>
                    </div>
                  </div>
                  {duesBoard ? (
                    <ul className="ops-dues-lines" aria-label="Desglose del mes">
                      <li><span>Cuota del mes</span><b className="tabular-nums">{formatCurrency(duesBoard.cuotaMes)}</b></li>
                      <li><span>Atrasadas</span><b className="tabular-nums">{formatCurrency(duesBoard.atrasadas)}</b></li>
                      <li><span>Adelantos</span><b className="tabular-nums">{formatCurrency(duesBoard.posteriores)}</b></li>
                      <li><span>Recargos</span><b className="tabular-nums">{formatCurrency(duesBoard.recargos)}</b></li>
                      <li><span>Salón</span><b className="tabular-nums">{formatCurrency(duesBoard.reservas)}</b></li>
                      <li><span>Portería</span><b className="tabular-nums">{formatCurrency(duesBoard.porteria)}</b></li>
                    </ul>
                  ) : null}
                </div>

                {todayIncomeRows.length > 0 ? (
                  <div className="ops-block" style={{ marginTop: '0.85rem' }}>
                    <div className="ops-block-title ops-block-title--split">
                      <span>Ingresos de hoy</span>
                      <strong style={{ color: 'var(--emerald-accent)' }}>
                        {formatCurrency(todayIncomeRows.reduce((s, row) => s + (Number(row.amount) || 0), 0))}
                      </strong>
                    </div>
                    {(showAllTodayIncomes ? todayIncomeRows : todayIncomeRows.slice(0, 5)).map((row) => (
                      <div key={`today-${row.id}`} className="ops-row">
                        <span className="ops-ellipsis">{row.label}</span>
                        <strong style={{ color: 'var(--emerald-accent)' }}>{formatCurrency(row.amount)}</strong>
                      </div>
                    ))}
                    {todayIncomeRows.length > 5 && !showAllTodayIncomes ? (
                      <button
                        type="button"
                        className="ops-dash-link"
                        onClick={() => setShowAllTodayIncomes(true)}
                      >
                        Leer más · {todayIncomeRows.length - 5} más
                      </button>
                    ) : null}
                  </div>
                ) : null}

                <div className="ops-block" style={{ marginTop: '0.85rem' }}>
                  <div className="ops-block-title ops-block-title--split">
                    <span>Recaudación diaria · {moneyMonthLabel}</span>
                    <strong style={{ color: monthIncomeByDay.total > 0 ? 'var(--emerald-accent)' : 'inherit' }}>
                      {formatCurrency(monthIncomeByDay.total)}
                    </strong>
                  </div>
                  {monthIncomeByDay.total > 0 ? (
                    <div
                      className="ops-income-chart"
                      role="img"
                      aria-label={`Recaudación diaria de ${moneyMonthLabel}: ${formatCurrency(monthIncomeByDay.total)}`}
                    >
                      <div className="ops-income-chart__bars">
                        {monthIncomeByDay.days.map((row) => {
                          const pct = Math.round((row.amount / monthIncomeByDay.max) * 100);
                          return (
                            <div
                              key={row.day}
                              className={`ops-income-chart__col${row.isToday ? ' is-today' : ''}${row.amount > 0 ? ' has-value' : ''}`}
                              title={`${row.day}/${monthNumber}: ${formatCurrency(row.amount)}`}
                            >
                              <span className="ops-income-chart__val">
                                {row.amount > 0 ? compactOpsMoney(row.amount) : ''}
                              </span>
                              <span className="ops-income-chart__track">
                                <span
                                  className="ops-income-chart__bar"
                                  style={{ height: `${row.amount > 0 ? Math.max(pct, 8) : 2}%` }}
                                />
                              </span>
                              <span className="ops-income-chart__day">{row.day}</span>
                            </div>
                          );
                        })}
                      </div>
                      <p className="ops-muted ops-income-chart__hint">
                        Barras por día del mes · hoy resaltado
                      </p>
                    </div>
                  ) : (
                    <p className="ops-muted" style={{ margin: '0.7rem 0 0' }}>
                      Todavía no hay cobros cargados en {moneyMonthLabel}.
                    </p>
                  )}
                </div>

                {(finance.journalExpenseMonth > 0 || totalActivos > 0) && (
                  <div className="ops-row" style={{ marginTop: '0.45rem' }}>
                    <span className="ops-muted">Activos contables / gastos del mes</span>
                    <strong>
                      {formatCurrency(totalActivos)}
                      {finance.journalExpenseMonth > 0 ? ` · −${formatCurrency(finance.journalExpenseMonth)}` : ''}
                    </strong>
                  </div>
                )}

                {overdueTop.length > 0 ? (
                  <div className="ops-block ops-debtors" style={{ marginTop: '0.9rem' }}>
                    <div className="ops-block-title ops-block-title--split">
                      <span>Mayores deudas</span>
                      <strong style={{ color: '#ef4444' }}>{overdueMembersCount || finance.debtors}</strong>
                    </div>
                    {overdueTop.map((m) => {
                      const id = m.memberId || m.id;
                      return (
                        <Link
                          key={id}
                          to={`/panel/members/${encodeURIComponent(id)}`}
                          className="ops-row ops-debtor-row"
                        >
                          <span className="ops-ellipsis">
                            {m.name}
                            <small className="ops-muted"> · Nº {id}</small>
                          </span>
                          <strong style={{ color: '#ef4444' }}>{formatCurrency(m.amountDue)}</strong>
                        </Link>
                      );
                    })}
                  </div>
                ) : null}

                {permittedTabs.includes('dues') && (
                  <div className="ops-dues-strip">
                    <div>
                      <strong style={{ color: '#ef4444' }}>{overdueMembersCount || finance.debtors}</strong>
                      <span>con deuda</span>
                    </div>
                    <div>
                      <strong style={{ color: '#f59e0b' }}>{upcomingDuesCount}</strong>
                      <span>a vencer</span>
                    </div>
                    <div className="ops-dues-total">
                      <strong>{formatCurrency(debtTotal)}</strong>
                      <span>pendiente</span>
                    </div>
                    {link('Cobranzas >', () => goToTab('dues'))}
                  </div>
                )}
              </article>
            </>
          ) : (
            <>
              {permittedTabs.includes('events') && nextEvent && (
                <article className="glass-card ops-card ops-tile ops-tile--money">
                  <header className="ops-card-head">
                    <PartyPopper size={16} color="var(--primary-gold)" />
                    <h3>Próximo evento</h3>
                  </header>
                  <strong>{nextEvent.title}</strong>
                  <p className="ops-muted">
                    {new Date(nextEvent.startsAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
                    {' · '}{nextEvent.location}
                  </p>
                  {link('Ver fiestas >', () => goToTab('events'))}
                </article>
              )}
            </>
          )}
        </div>

        {(hasMembers || showGate || (permittedTabs.includes('surveys') && surveys.length > 0)) ? (
        <div className="ops-dash-col ops-dash-col--right">
          {!hasMembers ? (
            <article className="glass-card ops-card ops-tile ops-tile--padron">
              <header className="ops-card-head">
                <Activity size={16} color="var(--primary-gold)" />
                <h3>Resumen</h3>
              </header>
              {permittedTabs.includes('dues') && (
                <div className="ops-row">
                  <span>Deudas</span>
                  <strong style={{ color: '#ef4444' }}>{overdueMembersCount}</strong>
                </div>
              )}
              {permittedTabs.includes('bookings') && (
                <div className="ops-row">
                  <span>Reservas activas</span>
                  <strong>{activeBookingsCount}</strong>
                </div>
              )}
              {permittedTabs.includes('claims') && (
                <div className="ops-row">
                  <span>Reclamos</span>
                  <strong>{pendingClaimsCount}</strong>
                </div>
              )}
            </article>
          ) : null}

          {showGate ? (
            <article className="glass-card ops-card ops-card--gate ops-tile ops-tile--gate">
              <header className="ops-card-head ops-card-head--split">
                <div>
                  <DoorOpen size={16} color="var(--primary-gold)" />
                  <h3>Portería</h3>
                </div>
                <span className="ops-muted" style={{ fontSize: '0.75rem' }}>
                  {todayEntries.todayTotal} hoy
                </span>
              </header>
              <div className="ops-gate-stats">
                <div>
                  <strong style={{ color: 'var(--emerald-accent)' }}>{todayEntries.granted}</strong>
                  <span>Ingresos OK</span>
                </div>
                <div>
                  <strong style={{ color: '#ef4444' }}>{todayEntries.denied}</strong>
                  <span>Denegados</span>
                </div>
              </div>
              {(showAllGateEntries ? todayEntries.list : todayEntries.preview).map((log) => (
                <div key={log.id || `${log.memberName}-${log.time || log.timeLabel}`} className="ops-row">
                  <span className="ops-ellipsis">{log.memberName || 'Visitante'}</span>
                  <span className={`ops-gate-tag ${(log.status === 'denied' || log.status === 'blocked') ? 'denied' : 'ok'}`}>
                    {log.timeLabel || log.time || '—'}
                  </span>
                </div>
              ))}
              {todayEntries.list.length === 0 ? (
                <p className="ops-muted">Sin ingresos hoy.</p>
              ) : todayEntries.list.length > 5 && !showAllGateEntries ? (
                <button
                  type="button"
                  className="ops-dash-link"
                  onClick={() => setShowAllGateEntries(true)}
                >
                  Leer más · {todayEntries.list.length - 5} más
                </button>
              ) : null}
            </article>
          ) : null}

          {hasMembers ? (
            <article className="glass-card ops-card ops-padron-card ops-tile ops-tile--padron">
              <header className="ops-card-head ops-card-head--split">
                <div>
                  <Users size={16} color="var(--primary-gold)" />
                  <h3>Padrón</h3>
                </div>
                <span className="ops-padron-total">{household.titularesActivos.toLocaleString('es-AR')}</span>
              </header>
              <div className="ops-padron-kpis" aria-label="Resumen de hogares">
                <div>
                  <b>{household.titularesActivos.toLocaleString('es-AR')}</b>
                  <span>Titulares</span>
                </div>
                <div>
                  <b>{household.gruposFamiliares.toLocaleString('es-AR')}</b>
                  <span>Grupos</span>
                </div>
                <div>
                  <b>{household.integrantesActivos.toLocaleString('es-AR')}</b>
                  <span>Integrantes</span>
                </div>
              </div>
              <div className="ops-padron-board">
                <div className="ops-padron-cats">
                  <p className="ops-muted ops-padron-caption">
                    Categorías de socios titulares (sin contar el grupo familiar debajo).
                  </p>
                  <ul className="ops-padron-bars" aria-label="Titulares por categoría">
                    {padronTop.top.map((t) => (
                      <li key={t.id}>
                        <div className="ops-padron-bar-meta">
                          <span className="ops-padron-bar-name" title={t.name}>{t.name}</span>
                          <b style={{ color: t.color }}>{t.count.toLocaleString('es-AR')}</b>
                        </div>
                        <div className="ops-padron-bar-track" aria-hidden="true">
                          <span
                            className="ops-padron-bar-fill"
                            style={{
                              width: `${Math.max(8, Math.round((t.count / padronTop.max) * 100))}%`,
                              background: t.color,
                            }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                  {padronTop.rest.length > 0 ? (
                    <ul className="ops-padron-rest" aria-label="Resto de categorías">
                      {padronTop.rest.map((t) => (
                        <li key={t.id} style={{ '--chip-color': t.color }}>
                          <b className="tabular-nums">{t.count}</b>
                          <span title={t.name}>{t.name}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <div className="ops-padron-side">
                  <div className="ops-padron-status" aria-label="Estado del padrón">
                    <div>
                      <b className="tabular-nums">{padronStatus.active.toLocaleString('es-AR')}</b>
                      <span>Activos</span>
                    </div>
                    <div>
                      <b className="tabular-nums">{padronStatus.inactive.toLocaleString('es-AR')}</b>
                      <span>Inactivos</span>
                    </div>
                    {overdueMembersCount > 0 ? (
                      <button type="button" className="ops-padron-mora-btn" onClick={() => goToTab('dues')}>
                        <b className="tabular-nums">{overdueMembersCount.toLocaleString('es-AR')}</b>
                        <span>En mora</span>
                      </button>
                    ) : (
                      <div>
                        <b className="tabular-nums">{padronStatus.suspended.toLocaleString('es-AR')}</b>
                        <span>Suspendidos</span>
                      </div>
                    )}
                  </div>
                  <div className="ops-padron-moves">
                    <p className="ops-today-next-label">Altas y bajas</p>
                    <p className="ops-muted ops-padron-moves-sum">
                      {movePulse.altas.toLocaleString('es-AR')} altas · {movePulse.bajas.toLocaleString('es-AR')} bajas
                      {' · '}
                      {formatMoveDay(movePulse.from)}–{formatMoveDay(movePulse.to)}
                    </p>
                    <ul>
                      {movePulse.recent.map((row) => (
                        <li key={`${row.move}-${row.memberId}-${row.date}-${row.motivo || row.movimiento}`}>
                          <Link
                            to={`/panel/members/${encodeURIComponent(row.memberId)}`}
                            className={`ops-padron-move ops-padron-move--${row.move}`}
                          >
                            <em>{row.move === 'alta' ? 'Alta' : 'Baja'}</em>
                            <strong>{row.name || `Nº ${row.memberId}`}</strong>
                            <small>{formatMoveDay(row.date)}</small>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <button
                    type="button"
                    className="ops-padron-cta"
                    onClick={() => goToTab('members')}
                  >
                    <span>Ver padrón</span>
                    <ChevronRight size={16} strokeWidth={2.25} />
                  </button>
                </div>
              </div>
            </article>
          ) : null}

          {permittedTabs.includes('surveys') && surveys.length > 0 ? (
            <button type="button" className="ops-chip ops-tile ops-tile--revista" onClick={() => goToTab('surveys')}>
              <CheckCircle2 size={15} /> {surveys.length} encuestas
            </button>
          ) : null}
        </div>
        ) : null}
      </section>

    </div>
  );
}
