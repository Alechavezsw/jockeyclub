import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Users, Calendar, DollarSign, Activity, MessageSquare, ClipboardList,
  Radio, BookOpen, ShieldAlert, BellRing, CheckCircle2,
  PartyPopper, Clock, UserCircle2, FileSpreadsheet, Wind, Newspaper,
  DoorOpen, ExternalLink, UserPlus, UserRound, ChevronRight, AlertTriangle,
} from 'lucide-react';
import { useSedeWeather } from '../../hooks/useSedeWeather';
import { formatObservedClock } from '../../domain/weather/sedeWeather';
import { canAccessQrGate } from '../../domain/auth/roles';
import { filterAlertsForRole, isAlertAcknowledged, isAlertVisible, ALERT_SEVERITY } from '../../domain/alerts/alerts';
import { buildOpsFinanceSnapshot } from '../../domain/accounting/opsFinanceSnapshot';
import { isNewsPublished, newsCategoryLabel } from '../../domain/news/news';
import { buildPadronHouseholdStats } from '../../domain/members/households';
import { getOverdueMembers } from '../../domain/members/dues';
import { membershipMovesSeed, uniqueBajas } from '../../domain/members/membershipMoves';
import { useSnapshotSeed } from '../../hooks/useSnapshots';
import { todayISODateAR } from '../../lib/arDate';
import { AlertsBanner } from '../erp/AlertsPanel';
import { OpsProgressRing, OpsSegmentRing } from './OpsGauge';

const MOVES_SNAPSHOTS = ['societasMembershipMoves'];
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
  const week = Array.from({ length: 7 }, (_, i) => {
    const key = addDaysISO(todayKey, i);
    return {
      key,
      count: upcoming.filter((r) => reservationDay(r) === key).length,
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
    pastConfirmed: list.filter((r) => r.status === 'confirmed' && reservationDay(r) < todayKey).length,
  };
}

function formatLongDate(d = new Date()) {
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
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
  claims = [],
  messages = [],
  entryLogs = [],
  surveys = [],
  staffMembers = [],
  staffHrRecords = [],
  clubEvents = [],
  alerts = [],
  alertAcks = [],
  onAckAlert,
  latestNews = [],
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
  registeredUsersCount = 0,
  membershipApplications = [],
  portalAccessRequests = [],
}) {
  const navigate = useNavigate();
  const showGate = canAccessQrGate(userRole);
  const pendingMembershipApps = useMemo(
    () => (membershipApplications || []).filter((a) => a.status === 'pending').length
      + (portalAccessRequests || []).filter((a) => a.status === 'pending').length,
    [membershipApplications, portalAccessRequests]
  );
  const todayKey = todayISODateAR();
  const hasAccounting = permittedTabs.includes('accounting');
  const hasMessaging = permittedTabs.includes('messaging');
  const hasMembers = permittedTabs.includes('members');

  const bookings = useMemo(() => buildBookingsSnapshot(reservations), [reservations]);

  const msgStats = useMemo(() => {
    const list = Array.isArray(messages) ? messages : [];
    const total = list.length;
    const unread = list.filter((m) => !m.isRead).length;
    const unanswered = list.filter((m) => !m.isRead && !m.parentId && m.recipientId === 'ops').length;
    const inProgress = Math.max(0, total - unread);
    const attention = unanswered + Math.max(0, unread - unanswered);
    const recent = [...list]
      .sort((a, b) => String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || '')))
      .slice(0, 3);
    return { total, unread, unanswered, inProgress, attention, recent };
  }, [messages]);

  const commsSegments = useMemo(() => {
    const unreadOnly = Math.max(0, msgStats.unread - msgStats.unanswered);
    return [
      { key: 'wait', value: msgStats.unanswered, color: '#CA390C' },
      { key: 'read', value: unreadOnly, color: '#7c5cbf' },
      { key: 'ok', value: msgStats.inProgress, color: '#096755' },
    ];
  }, [msgStats]);

  const todayEntries = useMemo(() => {
    const now = Date.now();
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;
    const todays = entryLogs.filter((l) => (l.date || '').startsWith(todayKey) || l.date === todayKey);
    const recent = entryLogs
      .map((log) => ({ log, at: parseLogInstant(log) }))
      .filter(({ at }) => at && at.getTime() >= twoHoursAgo)
      .sort((a, b) => b.at - a.at)
      .slice(0, 6)
      .map(({ log, at }) => ({
        ...log,
        timeLabel: at.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
      }));
    const list = todays.length ? todays : entryLogs.slice(0, 4);
    return {
      list: list.slice(0, 3),
      recent,
      granted: list.filter((l) => l.status === 'granted' || l.status === 'ok').length,
      denied: list.filter((l) => l.status === 'denied' || l.status === 'blocked').length,
      todayTotal: todays.length,
    };
  }, [entryLogs, todayKey]);

  const activeAlerts = useMemo(
    () => (alerts || []).filter((a) => isAlertVisible(a)).slice(0, 4),
    [alerts],
  );

  const hasOpenConcessionAlerts = useMemo(
    () => filterAlertsForRole(alerts, userRole).some((a) => (
      (a.source === 'concession_expiry' || a.source === 'concession_docs')
      && !isAlertAcknowledged(a, alertAcks)
    )),
    [alerts, alertAcks, userRole],
  );

  const nextEvent = useMemo(() => {
    const now = Date.now();
    return [...(clubEvents || [])]
      .filter((e) => e.status !== 'cancelled' && new Date(e.startsAt).getTime() >= now - 86400000)
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))[0] || null;
  }, [clubEvents]);

  const featuredNews = useMemo(() => {
    const list = Array.isArray(latestNews) ? latestNews : [];
    const published = list.filter(isNewsPublished);
    const pool = published.length ? published : list;
    return pool[0] || null;
  }, [latestNews]);

  const { weather, status: weatherStatus } = useSedeWeather({ isZondaActive });
  const weatherClosed = weather?.outdoor === 'closed';
  const weatherCaution = weather?.outdoor === 'caution';

  const hrPending = useMemo(
    () => (staffHrRecords || []).filter((r) => r.status === 'pending').length,
    [staffHrRecords],
  );

  const activeStaff = staffMembers.filter((s) => s.status === 'active').length;
  const household = useMemo(
    () => buildPadronHouseholdStats(members, { tierCatalog }),
    [members, tierCatalog]
  );
  const adherentsCount = household.integrantes
    || members.reduce((n, m) => n + (m.adherents?.length || 0), 0);
  const membersWithApp = members.filter((m) => m.hasApp || m.appInstalled).length;
  const padronTop = useMemo(() => {
    const top = household.byTier.slice(0, 5);
    const rest = household.byTier.slice(5);
    const restCount = rest.reduce((n, t) => n + t.count, 0);
    const restCats = rest.length;
    const max = top[0]?.count || 1;
    return { top, rest, restCount, restCats, max };
  }, [household.byTier]);

  const monthLabel = new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  const monthLabelCap = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

  const finance = useMemo(
    () => buildOpsFinanceSnapshot({
      members,
      journalEntries,
      chartOfAccounts,
      getAccountBalance,
    }),
    [members, journalEntries, chartOfAccounts, getAccountBalance]
  );

  const cashToday = finance.cashToday;
  const collectedMonth = finance.collectedMonth;
  const liveCollectionRate = finance.collectionRate || paymentCollectionRate || 0;
  const collectionTone = liveCollectionRate >= 80 ? 'ok' : liveCollectionRate >= 50 ? 'mid' : 'low';
  const debtTotal = finance.debtTotal || totalOutstanding || 0;
  const monthProgress = finance.expectedMonth > 0
    ? Math.min(100, Math.round((collectedMonth / finance.expectedMonth) * 100))
    : 0;

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
    return {
      altas: Number(snap.altas) || 0,
      bajas: Number(snap.bajas) || 0,
      from: snap.periodFrom,
      to: snap.periodTo,
      recent: [
        ...altas.map((row) => ({ ...row, move: 'alta' })),
        ...bajas.map((row) => ({ ...row, move: 'baja' })),
      ]
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 4),
    };
  }, [movesSeed]);

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
      hint: featuredNews ? featuredNews.title : 'Publicar nota',
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

  const link = (label, onClick) => (
    <button type="button" className="ops-dash-link" onClick={onClick}>
      {String(label).replace(/\s*>+\s*$/, '')}
    </button>
  );

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
              {bookings.todayCount > 0 ? (
                <span className="ops-today-badge">{bookings.todayCount}</span>
              ) : null}
            </header>
            {bookings.todayList.length === 0 ? (
              <p className="ops-muted ops-today-empty">
                Sin turnos para hoy
                {bookings.pastConfirmed > 0 ? ` · ${bookings.pastConfirmed} históricas en el libro` : ''}.
              </p>
            ) : (
              <ul className="ops-today-list">
                {bookings.todayList.map((res) => (
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
            <ul className="ops-week" aria-label="Turnos de los próximos 7 días">
              {bookings.week.map((d) => (
                <li key={d.key} className={d.key === todayKey ? 'is-today' : undefined}>
                  <span>{d.label}</span>
                  <b className="tabular-nums">{d.count}</b>
                  <small className="tabular-nums">{d.day}</small>
                </li>
              ))}
            </ul>
            {bookings.next.length > 0 ? (
              <>
                <p className="ops-today-next-label">Próximos</p>
                <ul className="ops-today-list ops-today-list--next">
                  {bookings.next.slice(0, 3).map((res) => (
                    <li key={res.id || `${reservationDay(res)}-${res.time || res.time_slot}`}>
                      <span className="ops-today-time tabular-nums">
                        {String(res.time || res.time_slot || '—').slice(0, 5)}
                      </span>
                      <span className="ops-today-copy">
                        <strong>{res.facilityName || res.facilityId}</strong>
                        <small>
                          {formatMoveDay(reservationDay(res))}
                          {res.memberName ? ` · ${res.memberName}` : ''}
                          {res.status === 'pending' ? ' · por confirmar' : ''}
                        </small>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
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
            {bookings.todayList.length === 0 && bookings.pastList.length > 0 ? (
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

          <article className="ops-today-pane ops-today-pane--alerts">
            <header className="ops-today-pane-head">
              <BellRing size={15} aria-hidden="true" />
              <h3>Alertas</h3>
              {activeAlerts.length > 0 ? (
                <span className="ops-today-badge">{activeAlerts.length}</span>
              ) : null}
            </header>
            {activeAlerts.length === 0 ? (
              <p className="ops-muted ops-today-empty">Sin alertas vigentes.</p>
            ) : (
              <ul className="ops-today-alerts">
                {activeAlerts.slice(0, 4).map((a) => {
                  const sev = a.severity || 'info';
                  const Icon = sev === 'critical'
                    ? ShieldAlert
                    : sev === 'warning'
                      ? AlertTriangle
                      : BellRing;
                  return (
                    <li key={a.id} className={`ops-today-alert-item sev-${sev}`}>
                      <span className="ops-today-alert-icon" aria-hidden="true">
                        <Icon size={16} strokeWidth={2.2} />
                      </span>
                      <span className="ops-today-alert-body">
                        <em className="ops-today-alert-sev">
                          {ALERT_SEVERITY[sev]?.label || 'Alerta'}
                        </em>
                        <strong>{a.title}</strong>
                        {a.body ? <small>{a.body}</small> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="ops-today-pane-foot">
              {permittedTabs.includes('claims') && pendingClaimsCount > 0 ? (
                <p className="ops-muted" style={{ margin: 0 }}>
                  {pendingClaimsCount} reclamos abiertos
                </p>
              ) : null}
              {permittedTabs.includes('alerts') && (
                <Link to="/panel/alerts" className="ops-dash-link">
                  Ver alertas
                </Link>
              )}
            </div>
          </article>
        </div>
      </section>

      {/* ESCENARIO PRINCIPAL: 3 columnas desiguales */}
      <section className={`ops-dash-main ${!hasAccounting ? 'ops-dash-main--ops' : ''}`}>
        {/* IZQUIERDA — Comunicar / trabajo del día */}
        <div className="ops-dash-col ops-dash-col--left">
          {hasMessaging ? (
            <article className="glass-card ops-card ops-card--tall ops-tile ops-tile--comms">
              <header className="ops-card-head ops-card-head--split">
                <div>
                  <MessageSquare size={16} color="var(--primary-gold)" />
                  <h3>Comunicaciones</h3>
                </div>
                {msgStats.attention > 0 ? (
                  <span className="ops-comms-badge">{msgStats.attention}</span>
                ) : null}
              </header>

              <div className="ops-donut-wrap">
                <OpsSegmentRing
                  segments={commsSegments}
                  value={msgStats.total}
                  caption="msgs"
                  title={`${msgStats.total} mensajes · ${msgStats.attention} para atender`}
                />
                <div className="ops-comms-hero">
                  <strong>Bandeja del club</strong>
                  <span>
                    {msgStats.attention > 0
                      ? `${msgStats.attention} para atender`
                      : msgStats.total > 0
                        ? 'Nada pendiente'
                        : 'Todavía no hay mensajes'}
                  </span>
                </div>
              </div>

              <div className="ops-comms-pills" aria-label="Estado de la bandeja">
                <button type="button" className="ops-comms-pill tone-wait" onClick={() => navigate('/mensajes')}>
                  <b className="tabular-nums">{msgStats.unanswered}</b>
                  <span>Sin responder</span>
                </button>
                <button type="button" className="ops-comms-pill tone-read" onClick={() => navigate('/mensajes')}>
                  <b className="tabular-nums">{msgStats.unread}</b>
                  <span>Sin leer</span>
                </button>
                <button type="button" className="ops-comms-pill tone-ok" onClick={() => navigate('/mensajes')}>
                  <b className="tabular-nums">{msgStats.inProgress}</b>
                  <span>En curso</span>
                </button>
              </div>

              {msgStats.recent.length > 0 ? (
                <ul className="ops-comms-mail" aria-label="Últimos mensajes">
                  {msgStats.recent.map((m) => (
                    <li key={m.id || `${m.subject}-${m.date}`}>
                      <button type="button" onClick={() => navigate('/mensajes')}>
                        <strong>{m.subject || 'Sin asunto'}</strong>
                        <small>
                          {m.sender || 'Club'}
                          {m.date ? ` · ${formatMoveDay(String(m.date).slice(0, 10))}` : ''}
                          {!m.isRead ? ' · nuevo' : ''}
                        </small>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="ops-card-foot">
                {link('Abrir bandeja', () => navigate('/mensajes'))}
                <div className="ops-btn-pair">
                  {permittedTabs.includes('surveys') && (
                    <button type="button" className="ops-outline-btn" onClick={() => goToTab('surveys')}>+ Encuesta</button>
                  )}
                  <button type="button" className="ops-outline-btn" onClick={() => goToTab('messaging')}>+ Comunicación</button>
                </div>
              </div>
            </article>
          ) : (
            <article className="glass-card ops-card ops-card--tall ops-tile ops-tile--comms">
              <header className="ops-card-head">
                <ClipboardList size={16} color="var(--primary-gold)" />
                <h3>Trabajo del día</h3>
              </header>

              {permittedTabs.includes('claims') && (
                <div className="ops-block">
                  <div className="ops-block-title">Reclamos abiertos · {pendingClaimsCount}</div>
                  {pendingClaimsCount === 0 ? (
                    <p className="ops-muted">Sin reclamos pendientes.</p>
                  ) : (
                    claims.filter((c) => c.status !== 'resolved').slice(0, 4).map((clm) => (
                      <div key={clm.id} className="ops-row">
                        <span>{clm.title}</span>
                        <span style={{ color: clm.status === 'pending' ? '#f59e0b' : 'var(--primary-gold)' }}>
                          {clm.status === 'pending' ? 'Pendiente' : 'En curso'}
                        </span>
                      </div>
                    ))
                  )}
                  {link('Gestionar reclamos >', () => goToTab('claims'))}
                </div>
              )}

              {permittedTabs.includes('bookings') && (
                <div className="ops-block">
                  <div className="ops-block-title">
                    Reservas · {bookings.confirmedUpcoming} próximas · {bookings.pendingUpcoming} pend.
                  </div>
                  {bookings.next.length === 0 ? (
                    <p className="ops-muted">Sin turnos próximos.</p>
                  ) : (
                    bookings.next.map((res) => (
                      <div key={res.id || `${reservationDay(res)}-${res.time}`} className="ops-row ops-row--stack">
                        <strong>{res.facilityName || res.facilityId}</strong>
                        <span className="ops-muted">{reservationDay(res)} · {res.time || res.time_slot || '—'} hs · {res.memberName}</span>
                      </div>
                    ))
                  )}
                  {link('Ver agenda >', () => goToTab('bookings'))}
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
                  {todayEntries.todayTotal} hoy · últimas 2 h
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
              {(todayEntries.recent.length ? todayEntries.recent : todayEntries.list).map((log) => (
                <div key={log.id || `${log.memberName}-${log.time || log.timeLabel}`} className="ops-row">
                  <span className="ops-ellipsis">{log.memberName || 'Visitante'}</span>
                  <span className={`ops-gate-tag ${(log.status === 'denied' || log.status === 'blocked') ? 'denied' : 'ok'}`}>
                    {log.timeLabel || log.time || '—'}
                  </span>
                </div>
              ))}
              {todayEntries.recent.length === 0 && todayEntries.list.length === 0 && (
                <p className="ops-muted" style={{ margin: '0.25rem 0 0.5rem' }}>Sin ingresos recientes.</p>
              )}
              <button type="button" className="ops-primary-btn" onClick={() => navigate('/acceso')}>
                Abrir control QR
              </button>
              {permittedTabs.includes('pool') && (
                <button type="button" className="ops-primary-btn" onClick={() => navigate('/entrada-pileta')}>
                  Abrir entrada pileta
                </button>
              )}
              {permittedTabs.includes('access') && (
                <div style={{ marginTop: '0.55rem' }}>
                  {link('Ver registro de ingresos >', () => goToTab('access'))}
                </div>
              )}
            </article>
          )}

          {permittedTabs.includes('staff') && (
            <article className="glass-card ops-floor-card ops-tile ops-tile--staff">
              <header className="ops-card-head">
                <ClipboardList size={16} color="var(--primary-gold)" />
                <h3>Personal</h3>
              </header>
              <p><strong>{activeStaff}</strong> en servicio</p>
              <p className="ops-muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Clock size={13} /> {hrPending} permisos pendientes
              </p>
              {link('Legajos y RR.HH. >', () => goToTab('staff'))}
            </article>
          )}

          {permittedTabs.includes('bookings') && (hasMessaging || hasAccounting) && (
            <article className="glass-card ops-floor-card ops-tile ops-tile--book">
              <header className="ops-card-head">
                <Calendar size={16} color="var(--primary-gold)" />
                <h3>Reservas de canchas</h3>
              </header>
              <div className="ops-floor-nums">
                <div>
                  <b style={{ color: 'var(--emerald-accent)' }}>{bookings.confirmedUpcoming}</b>
                  <span>próximas OK</span>
                </div>
                <div>
                  <b style={{ color: '#f59e0b' }}>{bookings.pendingUpcoming}</b>
                  <span>por confirmar</span>
                </div>
                <div>
                  <b style={{ color: 'var(--primary-gold)' }}>{bookings.todayCount}</b>
                  <span>hoy</span>
                </div>
              </div>
              {bookings.next.length === 0 ? (
                <p className="ops-muted" style={{ margin: '0.55rem 0 0' }}>
                  No hay turnos desde hoy en adelante
                  {bookings.pastConfirmed > 0 ? ` · ${bookings.pastConfirmed} históricas` : ''}.
                </p>
              ) : (
                <div style={{ marginTop: '0.55rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  {bookings.next.map((res) => (
                    <div key={res.id || `${reservationDay(res)}-${res.time}`} className="ops-row ops-row--stack">
                      <strong>{res.facilityName || res.facilityId}</strong>
                      <span className="ops-muted">
                        {reservationDay(res)} · {res.time || res.time_slot || '—'} hs · {res.memberName || 'Socio'}
                        {res.status === 'pending' ? ' · pend.' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {link('Abrir agenda >', () => goToTab('bookings'))}
            </article>
          )}
        </div>

        {/* CENTRO — Dinero + acceso físico (el bloque más ancho) */}
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
                    <h3>{userRole === 'cashier' ? 'Caja' : 'Contabilidad'}</h3>
                  </div>
                  <span className="ops-month">{monthLabelCap}</span>
                </header>

                <div className="ops-money-hero">
                  <OpsProgressRing
                    value={liveCollectionRate}
                    tone={collectionTone}
                    title={`${finance.alDia} de ${finance.activeMembers} socios al día`}
                  />
                  <div>
                    <div className="ops-money-big" style={{ color: debtTotal > 0 ? '#ef4444' : 'var(--text-strong)' }}>
                      {formatCurrency(debtTotal)}
                    </div>
                    <div className="ops-muted">Deuda de cuotas pendiente</div>

                    <div className="ops-money-green">{formatCurrency(collectedMonth)}</div>
                    <div className="ops-muted" style={{ color: 'var(--emerald-accent)' }}>
                      Recaudado en {monthLabelCap}
                    </div>

                    <div className="ops-money-liquid">{formatCurrency(finance.expectedMonth || 0)}</div>
                    <div className="ops-muted">
                      Liquidado del mes
                      {finance.expectedMonth > 0 && collectedMonth < finance.expectedMonth ? (
                        <span>
                          {' · '}resta {formatCurrency(Math.max(0, finance.expectedMonth - collectedMonth))}
                        </span>
                      ) : null}
                    </div>

                    <div className="ops-muted" style={{ marginTop: '0.25rem', fontSize: '0.78rem' }}>
                      Hoy: <strong style={{ color: finance.collectedToday > 0 ? 'var(--emerald-accent)' : 'inherit' }}>
                        {formatCurrency(finance.collectedToday || 0)}
                      </strong>
                    </div>
                    <div className="ops-muted" style={{ marginTop: '0.35rem', fontSize: '0.72rem' }}>
                      {finance.alDia}/{finance.activeMembers} socios al día
                    </div>
                  </div>
                </div>

                <button type="button" className="ops-cash-banner" onClick={() => goToTab('accounting', 'cash')}>
                  <span className="ops-cash-ico"><DollarSign size={20} /></span>
                  <span>
                    <strong>{formatCurrency(cashToday)}</strong>
                    <small>Saldo Caja + Cantina + Banco (asientos)</small>
                  </span>
                  <span className="ops-cash-go">Ver</span>
                </button>

                {cashSplit.length > 0 ? (
                  <div className="ops-cash-split" aria-label="Saldos por caja">
                    {cashSplit.map((row) => (
                      <div key={row.id}>
                        <b className="tabular-nums">{formatCurrency(row.amount)}</b>
                        <span>{row.label}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {finance.expectedMonth > 0 ? (
                  <div className="ops-month-progress">
                    <div className="ops-block-title ops-block-title--split">
                      <span>Avance de cuotas · {monthLabelCap}</span>
                      <strong>{monthProgress}%</strong>
                    </div>
                    <div className="ops-month-progress-track" aria-hidden="true">
                      <span style={{ width: `${Math.max(collectedMonth > 0 ? 6 : 0, monthProgress)}%` }} />
                    </div>
                    <p className="ops-muted">
                      {formatCurrency(collectedMonth)} cobrado de {formatCurrency(finance.expectedMonth)} liquidado
                    </p>
                  </div>
                ) : null}

                {finance.todayIncomes.length > 0 ? (
                  <div className="ops-block" style={{ marginTop: '0.85rem' }}>
                    <div className="ops-block-title ops-block-title--split">
                      <span>Ingresos de hoy</span>
                      <strong style={{ color: 'var(--emerald-accent)' }}>
                        {formatCurrency(finance.collectedToday)}
                      </strong>
                    </div>
                    {finance.todayIncomes.map((row) => (
                      <div key={`today-${row.id}`} className="ops-row">
                        <span className="ops-ellipsis">{row.label}</span>
                        <strong style={{ color: 'var(--emerald-accent)' }}>{formatCurrency(row.amount)}</strong>
                      </div>
                    ))}
                  </div>
                ) : null}

                {finance.recentIncomes.length > 0 ? (
                  <div className="ops-block" style={{ marginTop: '0.85rem' }}>
                    <div className="ops-block-title">Últimos ingresos · {monthLabelCap}</div>
                    {finance.recentIncomes.map((row) => (
                      <div key={row.id} className="ops-row">
                        <span className="ops-ellipsis">
                          <span className="ops-muted" style={{ marginRight: 6 }}>{row.date.slice(8, 10)}/{row.date.slice(5, 7)}</span>
                          {row.label}
                        </span>
                        <strong style={{ color: 'var(--emerald-accent)' }}>{formatCurrency(row.amount)}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="ops-muted" style={{ margin: '0.7rem 0 0' }}>
                    Todavía no hay cobros cargados en {monthLabelCap}.
                  </p>
                )}

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

                <div className="ops-btn-pair" style={{ marginTop: '1rem' }}>
                  {hasMembers && (
                    <button type="button" className="ops-outline-btn" onClick={() => goToTab('members')}>+ Socios</button>
                  )}
                  <Link to="/registro?tramite=alta" className="ops-outline-btn">
                    Inscribirse
                  </Link>
                  <button type="button" className="ops-outline-btn" onClick={() => goToTab('accounting', 'suppliers')}>+ Proveedores</button>
                </div>
              </article>

              {hasOpenConcessionAlerts ? (
                <div className="ops-tile ops-tile--concessions">
                  <AlertsBanner
                    alerts={alerts}
                    alertAcks={alertAcks}
                    userRole={userRole}
                    onAck={onAckAlert}
                    onlySources={['concession_expiry', 'concession_docs']}
                    maxItems={5}
                    style={{ marginBottom: 0, marginTop: 0 }}
                  />
                  <Link to="/concesiones" className="ops-dash-link">
                    Gestionar concesiones
                  </Link>
                </div>
              ) : null}
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
                  <span className="ops-padron-total">{household.titulares.toLocaleString('es-AR')}</span>
                </header>
                <div className="ops-padron-kpis" aria-label="Resumen de hogares">
                  <div>
                    <b>{household.titulares.toLocaleString('es-AR')}</b>
                    <span>Titulares</span>
                  </div>
                  <div>
                    <b>{household.gruposFamiliares.toLocaleString('es-AR')}</b>
                    <span>Grupos</span>
                  </div>
                  <div>
                    <b>{household.integrantes.toLocaleString('es-AR')}</b>
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

              <div className="glass-card ops-tile ops-tile--stats" aria-label="Atajos de padrón">
                <p className="ops-stats-kicker">Atajos del padrón</p>
                <div className="ops-stats-grid">
                  <button type="button" className="ops-stat ops-stat--a" onClick={() => goToTab('members')}>
                    <Users size={15} strokeWidth={2.1} aria-hidden="true" />
                    <b className="tabular-nums">{household.titulares.toLocaleString('es-AR')}</b>
                    <span>Titulares</span>
                  </button>
                  <button type="button" className="ops-stat ops-stat--b" onClick={() => goToTab('members')}>
                    <Users size={15} strokeWidth={2.1} aria-hidden="true" />
                    <b className="tabular-nums">{adherentsCount.toLocaleString('es-AR')}</b>
                    <span>Grupo familiar</span>
                  </button>
                  <button type="button" className="ops-stat ops-stat--d" onClick={() => goToTab('system')}>
                    <UserRound size={15} strokeWidth={2.1} aria-hidden="true" />
                    <b className="tabular-nums">{registeredUsersCount.toLocaleString('es-AR')}</b>
                    <span>Con usuario</span>
                  </button>
                  <button
                    type="button"
                    className={`ops-stat ops-stat--e${pendingMembershipApps > 0 ? ' is-wait' : ''}`}
                    onClick={() => goToTab('members')}
                  >
                    <UserPlus size={15} strokeWidth={2.1} aria-hidden="true" />
                    <b className="tabular-nums">{pendingMembershipApps.toLocaleString('es-AR')}</b>
                    <span>Solicitudes</span>
                  </button>
                  {membersWithApp > 0 ? (
                    <button type="button" className="ops-stat ops-stat--c" onClick={() => goToTab('members')}>
                      <UserCircle2 size={15} strokeWidth={2.1} aria-hidden="true" />
                      <b className="tabular-nums">{membersWithApp.toLocaleString('es-AR')}</b>
                      <span>Con app</span>
                    </button>
                  ) : null}
                </div>
                <Link to="/registro?tramite=alta" className="ops-public-join">
                  <ExternalLink size={14} aria-hidden="true" />
                  Formulario público para asociarse
                </Link>
              </div>
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

          {permittedTabs.includes('surveys') && surveys.length > 0 && (
            <button type="button" className="ops-chip ops-tile ops-tile--revista" onClick={() => goToTab('surveys')}>
              <CheckCircle2 size={15} /> {surveys.length} encuestas
            </button>
          )}

          {(permittedTabs.includes('news') || (permittedTabs.includes('events') && nextEvent && hasAccounting) || (permittedTabs.includes('claims') && hasAccounting)) && (
            <article className="glass-card ops-floor-card ops-tile ops-tile--revista">
              {permittedTabs.includes('news') && (
                <div className="ops-floor-section">
                  <header className="ops-card-head">
                    <Newspaper size={16} color="var(--primary-gold)" />
                    <h3>Revista</h3>
                  </header>
                  {featuredNews ? (
                    <button
                      type="button"
                      className="ops-news-teaser ops-news-teaser--compact"
                      onClick={() => goToTab('news')}
                    >
                      {featuredNews.image ? (
                        <img src={featuredNews.image} alt="" className="ops-news-thumb" />
                      ) : (
                        <span className="ops-news-thumb ops-news-thumb--empty" aria-hidden="true" />
                      )}
                      <span className="ops-news-meta">
                        <em>{newsCategoryLabel(featuredNews.category)}</em>
                        <strong>{featuredNews.title}</strong>
                        <small>{featuredNews.excerpt || featuredNews.date || 'Última publicación'}</small>
                      </span>
                      <ExternalLink size={14} aria-hidden="true" />
                    </button>
                  ) : (
                    <p className="ops-muted">Todavía no hay notas en la revista digital.</p>
                  )}
                  {link('Abrir CMS >', () => goToTab('news'))}
                </div>
              )}

              {permittedTabs.includes('events') && nextEvent && hasAccounting && (
                <div className="ops-floor-section">
                  <header className="ops-card-head">
                    <PartyPopper size={16} color="var(--primary-gold)" />
                    <h3>Próxima fiesta</h3>
                  </header>
                  <strong style={{ fontSize: '0.88rem' }}>{nextEvent.title}</strong>
                  <p className="ops-muted" style={{ margin: '0.25rem 0 0.5rem' }}>
                    {new Date(nextEvent.startsAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
                  </p>
                  {link('Eventos >', () => goToTab('events'))}
                </div>
              )}

              {permittedTabs.includes('claims') && hasAccounting && (
                <button type="button" className="ops-chip ops-chip--block" onClick={() => goToTab('claims')}>
                  <MessageSquare size={15} /> {pendingClaimsCount} reclamos abiertos
                </button>
              )}
            </article>
          )}
        </div>
      </section>

    </div>
  );
}
