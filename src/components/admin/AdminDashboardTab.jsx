import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, Calendar, DollarSign, Activity, MessageSquare, ClipboardList,
  Radio, BookOpen, ShieldAlert, BellRing, CheckCircle2,
  PartyPopper, FileSpreadsheet, Wind, Newspaper,
  DoorOpen, ChevronRight, AlertTriangle,
} from 'lucide-react';
import { useSedeWeather } from '../../hooks/useSedeWeather';
import { formatObservedClock } from '../../domain/weather/sedeWeather';
import { canAccessConcessions, canAccessQrGate } from '../../domain/auth/roles';
import { reviewItemsForAccess } from '../../domain/review/buildClubReview';
import { isAlertVisible, ALERT_SEVERITY } from '../../domain/alerts/alerts';
import { isPoolDayCashOpen, poolCanonByDay } from '../../domain/pool/poolAccess';
import { liquidatedTotalForMonth } from '../../domain/accounting/feePeriodLiquidation';
import { appFinanceSinceHandoff, buildOpsFinanceSnapshot, cashDeltaAfterDate, collectionForCalendarMonth, composeClubFinance, financeFromSummary, lilaContabilidadFromSnapshots } from '../../domain/accounting/opsFinanceSnapshot';
import { monthlyBalanceSeed } from '../../domain/accounting/monthlyBalance';
import { monthlyBalanceSummarySeed } from '../../domain/accounting/monthlyBalanceSummary';
import { detailedCcSeed } from '../../domain/accounting/detailedCurrentAccounts';
import { cashMovementsSeed, cashSeed } from '../../domain/accounting/cashLedger';
import { cobranzasSeed } from '../../domain/accounting/cobranzas';
import { buildPadronHouseholdStats } from '../../domain/members/households';
import { getOverdueMembers } from '../../domain/members/dues';
import { membershipMovesSeed, uniqueBajas } from '../../domain/members/membershipMoves';
import { useSnapshotSeed } from '../../hooks/useSnapshots';
import { formatISODateLongAR, todayISODateAR } from '../../lib/arDate';
import { dedupeAccessLogs } from '../../domain/credentials/accessLog';
import { OpsProgressRing } from './OpsGauge';
import DuesDueBanner from './DuesDueBanner';
import CurrentAccountCutNote from '../erp/CurrentAccountCutNote';

const MOVES_SNAPSHOTS = ['societasMembershipMoves'];
const LILA_MONEY_SNAPSHOTS = [
  'accessinMonthlyBalance',
  'accessinMonthlyBalanceSummary',
  'accessinDetailedCurrentAccounts',
  'accessinCashSnapshot',
  'accessinCashMovements',
  'accessinCobranzas',
];
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
  reservations = [],
  messages = [],
  entryLogs = [],
  surveys = [],
  staffHrRecords = [],
  clubEvents = [],
  alerts = [],
  alertAcks = [],
  onAckAlert,
  isZondaActive = false,
  tierCatalog = [],
  totalMembers,
  paymentCollectionRate,
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
  cashSessions = [],
  cashRegisters = [],
  onOpenDayCash,
  membershipApplications = [],
  portalAccessRequests = [],
  jevReview = null,
}) {
  const [openingCash, setOpeningCash] = useState(false);
  const [cashFlash, setCashFlash] = useState('');
  const [alertIndex, setAlertIndex] = useState(0);
  const alertHold = useRef(false);
  const [agendaDay, setAgendaDay] = useState(null);
  const [showAllMonthIncomes, setShowAllMonthIncomes] = useState(false);
  const showGate = canAccessQrGate(userRole);
  const pendingMembershipApps = useMemo(
    () => (membershipApplications || []).filter((a) => a.status === 'pending').length
      + (portalAccessRequests || []).filter((a) => a.status === 'pending').length,
    [membershipApplications, portalAccessRequests]
  );
  const todayKey = todayISODateAR();
  const hasAccounting = permittedTabs.includes('accounting');
  const lilaCut = useSnapshotSeed(
    hasAccounting ? LILA_MONEY_SNAPSHOTS : NO_SNAPSHOTS,
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
      list: list.slice(0, 8),
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

  const household = useMemo(
    () => buildPadronHouseholdStats(members, { tierCatalog }),
    [members, tierCatalog]
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
  const cashMoves = useMemo(() => {
    const recent = cashSeed().ACCESSIN_CASH_SNAPSHOT?.recentMovements || [];
    const all = cashMovementsSeed().ACCESSIN_CASH_MOVEMENTS || [];
    return [...recent, ...all];
  }, [lilaCut]);
  const monthFlow = useMemo(
    () => appFinanceSinceHandoff({
      members,
      journalEntries,
      chartOfAccounts,
      feePeriods,
      since: `${monthKey}-01`,
      today: todayKey,
    }),
    [members, journalEntries, chartOfAccounts, feePeriods, monthKey, todayKey],
  );
  const calendarMonth = collectionForCalendarMonth({
    money: lilaMoney,
    monthFlow,
    monthKey,
    cashMovements: cashMoves,
  });
  const cutKey = String(lilaMoney?.periodKey || lilaMoney?.periodTo || '').slice(0, 7);
  const cutIsThisMonth = Boolean(cutKey) && cutKey === monthKey;

  const finance = useMemo(
    () => buildOpsFinanceSnapshot({
      members,
      journalEntries,
      chartOfAccounts,
      getAccountBalance,
    }),
    [members, journalEntries, chartOfAccounts, getAccountBalance]
  );

  const cashToday = (lilaMoney?.cash ?? finance.cashToday) + (
    lilaMoney && !cutIsThisMonth ? cashDeltaAfterDate(cashMoves, lilaMoney.periodTo) : 0
  );
  const sheetLiquidated = liquidatedTotalForMonth(feePeriods, monthKey, { members, tierCatalog });
  const collectedMonth = lilaMoney ? calendarMonth.collected : finance.collectedMonth;
  const expectedMonth = sheetLiquidated != null
    ? sheetLiquidated
    : (lilaMoney ? calendarMonth.liquidated : finance.expectedMonth);
  const liveCollectionRate = expectedMonth > 0
    ? Math.round((collectedMonth / expectedMonth) * 100)
    : (lilaMoney ? 0 : (finance.collectionRate || paymentCollectionRate || 0));
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
  const dayCashOpen = isPoolDayCashOpen(cashSessions, cashRegisters);
  const recentIncomes = useMemo(() => {
    const byNumber = new Map();
    for (const member of members || []) {
      const digits = String(member.memberId || member.member_number || member.memberNumber || '').replace(/\D/g, '');
      if (digits && !byNumber.has(digits)) byNumber.set(digits, member);
    }
    const seen = new Set();
    const fromCash = [];
    for (const row of cashMoves || []) {
      const date = String(row?.date || '').slice(0, 10);
      if (!date.startsWith(monthKey)) continue;
      const movementType = String(row?.movementType || 'income');
      if (movementType === 'expense' || movementType === 'transfer_out') continue;
      const amount = Number(row?.amount) || 0;
      if (amount <= 0) continue;
      const id = String(row?.accessinId ?? row?.id ?? '');
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      const digits = String(row.memberNumber || row.description || '').replace(/\D/g, '');
      const member = byNumber.get(digits);
      const name = member?.name || member?.full_name || '';
      const label = name
        ? `${digits} · ${name}`
        : (digits ? `Socio ${digits}` : (row.typeLabel || 'Ingreso'));
      fromCash.push({
        id: id || `${date}-${digits}-${amount}`,
        date,
        label,
        amount,
      });
    }
    const base = (finance.recentIncomes || []).filter((row) => {
      const date = String(row.date || '').slice(0, 10);
      return date.startsWith(monthKey) && !/^canon pileta/i.test(String(row.label || ''));
    });
    return [...fromCash, ...poolMonthRows, ...base]
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))
        || String(b.id || '').localeCompare(String(a.id || '')))
      .slice(0, 20);
  }, [cashMoves, members, monthKey, finance.recentIncomes, poolMonthRows]);
  const todayIncomeRows = useMemo(() => {
    const poolToday = poolMonthRows.find((row) => row.date === todayKey);
    const base = (todayIncomes || []).filter((row) => !/^canon pileta/i.test(String(row.label || '')));
    return poolToday ? [poolToday, ...base] : base;
  }, [poolMonthRows, todayKey, todayIncomes]);

  const openDayCash = async () => {
    if (dayCashOpen || openingCash || typeof onOpenDayCash !== 'function') return;
    setOpeningCash(true);
    setCashFlash('');
    try {
      const session = await onOpenDayCash();
      setCashFlash(session?.openedNow ? 'Caja del día abierta.' : 'La caja del día ya estaba abierta.');
    } catch (err) {
      setCashFlash(err?.message || 'No se pudo abrir la caja del día.');
    } finally {
      setOpeningCash(false);
    }
  };

  const cashSplit = useMemo(() => {
    if (typeof getAccountBalance !== 'function') return [];
    return [
      { id: 'caja', label: 'Caja', amount: Number(getAccountBalance('Caja General')) || 0 },
      { id: 'cantina', label: 'Cantina', amount: Number(getAccountBalance('Caja Cantina')) || 0 },
      { id: 'banco', label: 'Banco', amount: Number(getAccountBalance('Banco Nación')) || 0 },
    ];
  }, [getAccountBalance, cashToday]);

  const overdueTop = useMemo(
    () => getOverdueMembers(members).slice(0, 5),
    [members],
  );

  const padronStatus = useMemo(() => {
    let active = 0;
    let inactive = 0;
    let suspended = 0;
    for (const m of members) {
      if (m.status === 'inactive') inactive += 1;
      else if (m.status === 'suspended') suspended += 1;
      else active += 1;
    }
    return { active, inactive, suspended };
  }, [members]);

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
      tab: 'accounting',
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
    .filter((a) => permittedTabs.includes(a.tab) && (!a.roles || a.roles.includes(userRole)))
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
          {(permittedTabs.includes('dues') || permittedTabs.includes('accounting')) ? (
            <DuesDueBanner
              today={todayKey}
              members={members}
              journalEntries={journalEntries}
              chartOfAccounts={chartOfAccounts}
              feePeriods={feePeriods}
              tierCatalog={tierCatalog}
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
                  </div>
                  <span className="ops-month">{moneyMonthLabel}</span>
                </header>

                <div className="ops-money-hero">
                  <OpsProgressRing
                    value={liveCollectionRate}
                    tone={collectionTone}
                    title={lilaMoney
                      ? `${liveCollectionRate}% recaudado de lo liquidado`
                      : `${finance.alDia} de ${finance.activeMembers} socios al día`}
                  />
                  <div>
                    <div className="ops-money-big">{liveCollectionRate}%</div>
                    <div className="ops-muted">
                      {lilaMoney
                        ? `Avance de ${moneyMonthLabel}`
                        : `${finance.alDia} de ${finance.activeMembers} socios al día`}
                    </div>
                    {!lilaMoney ? (
                      <div className="ops-muted" style={{ marginTop: '0.25rem', fontSize: '0.78rem' }}>
                        Hoy:{' '}
                        <strong style={{ color: finance.collectedToday > 0 ? 'var(--emerald-accent)' : 'inherit' }}>
                          {formatCurrency(finance.collectedToday || 0)}
                        </strong>
                      </div>
                    ) : null}
                  </div>
                </div>

                <button type="button" className="ops-cash-banner" onClick={() => goToTab('accounting', 'cash')}>
                  <span className="ops-cash-ico"><DollarSign size={20} /></span>
                  <span>
                    <strong>{formatCurrency(cashToday)}</strong>
                    <small>
                      {lilaMoney
                        ? (cutIsThisMonth
                          ? `Total en caja al corte ${lilaMoney.periodTo?.slice(8, 10) || ''}/${lilaMoney.periodTo?.slice(5, 7) || ''}`
                          : `Total en caja · ${moneyMonthLabel}`)
                        : 'Saldo Caja + Cantina + Banco (asientos)'}
                    </small>
                  </span>
                  <span className="ops-cash-go">Ver</span>
                </button>

                {!lilaMoney && cashSplit.length > 0 ? (
                  <div className="ops-cash-split" aria-label="Saldos por caja">
                    {cashSplit.map((row) => (
                      <div key={row.id}>
                        <b className="tabular-nums">{formatCurrency(row.amount)}</b>
                        <span>{row.label}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {todayIncomeRows.length > 0 ? (
                  <div className="ops-block" style={{ marginTop: '0.85rem' }}>
                    <div className="ops-block-title ops-block-title--split">
                      <span>Ingresos de hoy</span>
                      <strong style={{ color: 'var(--emerald-accent)' }}>
                        {formatCurrency(todayIncomeRows.reduce((s, row) => s + (Number(row.amount) || 0), 0))}
                      </strong>
                    </div>
                    {todayIncomeRows.map((row) => (
                      <div key={`today-${row.id}`} className="ops-row">
                        <span className="ops-ellipsis">{row.label}</span>
                        <strong style={{ color: 'var(--emerald-accent)' }}>{formatCurrency(row.amount)}</strong>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="ops-block" style={{ marginTop: '0.85rem' }}>
                  <div className="ops-block-title ops-block-title--split">
                    <span>Últimos ingresos · {moneyMonthLabel}</span>
                    <button
                      type="button"
                      className="btn btn-primary pool-day-cash"
                      disabled={openingCash || dayCashOpen || typeof onOpenDayCash !== 'function'}
                      onClick={openDayCash}
                    >
                      {dayCashOpen ? 'Caja del día abierta' : (openingCash ? 'Abriendo…' : 'Abrir caja del día')}
                    </button>
                  </div>
                  {cashFlash ? <p className="ops-muted" style={{ margin: '0.35rem 0 0' }}>{cashFlash}</p> : null}
                  {recentIncomes.length > 0 ? (
                    <>
                      {(showAllMonthIncomes ? recentIncomes : recentIncomes.slice(0, 5)).map((row) => (
                        <div key={row.id} className="ops-row">
                          <span className="ops-ellipsis">
                            <span className="ops-muted" style={{ marginRight: 6 }}>{String(row.date || '').slice(8, 10)}/{String(row.date || '').slice(5, 7)} </span>
                            {row.label}
                          </span>
                          <strong style={{ color: 'var(--emerald-accent)' }}>{formatCurrency(row.amount)}</strong>
                        </div>
                      ))}
                      {recentIncomes.length > 5 && !showAllMonthIncomes ? (
                        <button
                          type="button"
                          className="ops-dash-link"
                          onClick={() => setShowAllMonthIncomes(true)}
                        >
                          Ver más
                        </button>
                      ) : null}
                    </>
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

        {/* DERECHA — Padrón (compacto, apilado) */}
        <div className="ops-dash-col ops-dash-col--right">
          {hasMembers ? (
            <>
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
              </article>
            </>
          ) : (
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
          )}

          {showGate && (
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
              {todayEntries.list.map((log) => (
                <div key={log.id || `${log.memberName}-${log.time || log.timeLabel}`} className="ops-row">
                  <span className="ops-ellipsis">{log.memberName || 'Visitante'}</span>
                  <span className={`ops-gate-tag ${(log.status === 'denied' || log.status === 'blocked') ? 'denied' : 'ok'}`}>
                    {log.timeLabel || log.time || '—'}
                  </span>
                </div>
              ))}
              {todayEntries.list.length === 0 && (
                <p className="ops-muted" style={{ margin: '0.25rem 0 0.5rem' }}>Sin ingresos hoy.</p>
              )}
            </article>
          )}

          {permittedTabs.includes('surveys') && surveys.length > 0 && (
            <button type="button" className="ops-chip ops-tile ops-tile--revista" onClick={() => goToTab('surveys')}>
              <CheckCircle2 size={15} /> {surveys.length} encuestas
            </button>
          )}

        </div>
      </section>

    </div>
  );
}
