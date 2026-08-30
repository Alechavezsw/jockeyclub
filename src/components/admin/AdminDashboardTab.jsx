import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Calendar, DollarSign, Activity, MessageSquare, ClipboardList,
  Radio, BookOpen, ShieldAlert, BellRing, CheckCircle2,
  PartyPopper, Clock, UserCircle2, FileSpreadsheet, Wind, Newspaper,
  DoorOpen, ExternalLink, UserPlus, UserRound, ChevronRight,
} from 'lucide-react';
import { canAccessQrGate } from '../../domain/auth/roles';
import { isAlertVisible } from '../../domain/alerts/alerts';
import { buildOpsFinanceSnapshot } from '../../domain/accounting/opsFinanceSnapshot';
import { getOverdueMembers, toWhatsAppPhone, formatShortDate } from '../../domain/members/dues';
import { FACILITIES } from '../../domain/reservations/facilities';
import { isNewsPublished, newsCategoryLabel } from '../../domain/news/news';
import { buildPadronHouseholdStats } from '../../domain/members/households';
import { AlertsBanner } from '../erp/AlertsPanel';

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

function buildWhatsAppDuesUrl(member, formatCurrency) {
  const cleanPhone = toWhatsAppPhone(member.phone);
  if (!cleanPhone) return null;
  const dueLabel = formatShortDate(member.dueDate || member.nextDueDate);
  const msg = `Estimado/a ${member.name}, le saludamos del Jockey Club San Juan. Le recordamos que posee una cuota vencida de ${formatCurrency(member.amountDue)} (vencimiento ${dueLabel}). Puede regularizarla en administración o por transferencia. ¡Gracias!`;
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
}

function buildBookingsSnapshot(reservations = [], today = new Date()) {
  const todayKey = today.toISOString().slice(0, 10);
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
  return {
    confirmedUpcoming: confirmedUpcoming.length,
    pendingUpcoming: pendingUpcoming.length,
    todayCount: todayList.length,
    todayList: todayList.slice(0, 5),
    next,
    pastConfirmed: list.filter((r) => r.status === 'confirmed' && reservationDay(r) < todayKey).length,
  };
}

function pct(part, total) {
  if (!total) return '0.00';
  return ((part / total) * 100).toFixed(2);
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
}) {
  const navigate = useNavigate();
  const showGate = canAccessQrGate(userRole);
  const pendingMembershipApps = useMemo(
    () => (membershipApplications || []).filter((a) => a.status === 'pending').length,
    [membershipApplications]
  );
  const todayKey = new Date().toISOString().slice(0, 10);
  const hasAccounting = permittedTabs.includes('accounting');
  const hasMessaging = permittedTabs.includes('messaging');
  const hasMembers = permittedTabs.includes('members');

  const bookings = useMemo(() => buildBookingsSnapshot(reservations), [reservations]);

  const msgStats = useMemo(() => {
    const total = messages.length;
    const unread = messages.filter((m) => !m.isRead).length;
    const unanswered = messages.filter((m) => !m.isRead && !m.parentId && m.recipientId === 'ops').length;
    const inProgress = Math.max(0, total - unread);
    return { total, unread, unanswered, inProgress };
  }, [messages]);

  const donutGradient = useMemo(() => {
    const { total, unanswered, unread } = msgStats;
    if (!total) return 'conic-gradient(var(--border-glass) 0% 100%)';
    const a = (unanswered / total) * 100;
    const b = a + (unread / total) * 100;
    return `conic-gradient(#ef4444 0% ${a}%, #a855f7 ${a}% ${b}%, var(--emerald-accent) ${b}% 100%)`;
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
    () => (alerts || []).filter((a) => isAlertVisible(a)).slice(0, 2),
    [alerts],
  );

  const nextEvent = useMemo(() => {
    const now = Date.now();
    return [...(clubEvents || [])]
      .filter((e) => e.status !== 'cancelled' && new Date(e.startsAt).getTime() >= now - 86400000)
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))[0] || null;
  }, [clubEvents]);

  const overdueQueue = useMemo(
    () => getOverdueMembers(members).slice(0, 5),
    [members],
  );

  const featuredNews = useMemo(() => {
    const list = Array.isArray(latestNews) ? latestNews : [];
    const published = list.filter(isNewsPublished);
    const pool = published.length ? published : list;
    return pool[0] || null;
  }, [latestNews]);

  const outdoorFacilities = useMemo(
    () => FACILITIES.filter((f) => f.isOutdoor),
    [],
  );

  const liveAlert = activeAlerts[0] || null;

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
    const restCount = household.byTier.slice(5).reduce((n, t) => n + t.count, 0);
    const restCats = Math.max(0, household.byTier.length - 5);
    const max = top[0]?.count || 1;
    return { top, restCount, restCats, max };
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
  const debtTotal = finance.debtTotal || totalOutstanding || 0;

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
    <button type="button" className="ops-dash-link" onClick={onClick}>{label}</button>
  );

  const renderDuesQueue = () => {
    if (!permittedTabs.includes('dues')) return null;
    return (
      <article className="glass-card ops-card ops-dues-queue">
        <header className="ops-card-head ops-card-head--split">
          <div>
            <ShieldAlert size={16} color="#ef4444" />
            <h3>Cola de cobro</h3>
          </div>
          <span className="ops-muted" style={{ fontSize: '0.75rem' }}>
            {overdueQueue.length > 0 ? `${overdueMembersCount || overdueQueue.length} en mora` : 'Al día'}
          </span>
        </header>
        {overdueQueue.length === 0 ? (
          <p className="ops-muted" style={{ margin: 0 }}>Ningún socio con cuota vencida en el padrón.</p>
        ) : (
          <ul className="ops-dues-queue-list">
            {overdueQueue.map((m) => {
              const wa = buildWhatsAppDuesUrl(m, formatCurrency);
              return (
                <li key={m.id}>
                  <div className="ops-dues-queue-main">
                    <strong className="ops-ellipsis">{m.name}</strong>
                    <span className="ops-muted">
                      {formatCurrency(m.amountDue)}
                      {m.daysOverdue != null ? ` · ${m.daysOverdue}d` : ''}
                    </span>
                  </div>
                  <div className="ops-dues-queue-actions">
                    <button type="button" className="ops-mini-btn" onClick={() => goToTab('dues')}>
                      Cobrar
                    </button>
                    {wa ? (
                      <a
                        className="ops-mini-btn ops-mini-btn--wa"
                        href={wa}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        WA
                      </a>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="ops-card-foot" style={{ marginTop: '0.75rem' }}>
          {link('Abrir cobranza >', () => goToTab('dues'))}
        </div>
      </article>
    );
  };

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
              <p className="ops-muted ops-today-empty">Sin turnos confirmados o pendientes para hoy.</p>
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
            {liveAlert ? (
              <div className={`ops-today-alert sev-${liveAlert.severity || 'info'}`}>
                <BellRing size={14} aria-hidden="true" />
                <span>{liveAlert.title}</span>
              </div>
            ) : null}
            {permittedTabs.includes('bookings') && (
              <button type="button" className="ops-dash-link" onClick={() => goToTab('bookings')}>
                Ver agenda completa {'>'}
              </button>
            )}
          </article>

          <article className={`ops-today-pane ops-today-pane--weather ${isZondaActive ? 'is-zonda' : ''}`}>
            <header className="ops-today-pane-head">
              <Wind size={15} aria-hidden="true" />
              <h3>Clima operativo</h3>
            </header>
            <div className="ops-weather-status">
              <span className={`ops-weather-pill ${isZondaActive ? 'danger' : 'ok'}`}>
                {isZondaActive ? 'Zonda activo' : 'Condiciones normales'}
              </span>
              <p>
                {isZondaActive
                  ? `${outdoorFacilities.length} instalaciones exteriores suspendidas.`
                  : `${outdoorFacilities.length} canchas y pistas outdoor disponibles.`}
              </p>
            </div>
            <ul className="ops-weather-facilities">
              {outdoorFacilities.slice(0, 4).map((f) => (
                <li key={f.id} className={isZondaActive ? 'closed' : ''}>
                  <span className="ops-ellipsis">{f.name.replace(/ - .*$/, '')}</span>
                  <em>{isZondaActive ? 'Cerrado' : 'Abierto'}</em>
                </li>
              ))}
            </ul>
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
              <ul className="ops-today-list">
                {activeAlerts.slice(0, 4).map((a) => (
                  <li key={a.id}>
                    <span
                      className="ops-today-copy"
                      style={{
                        color: a.severity === 'critical' ? '#ef4444' : a.severity === 'warning' ? '#f59e0b' : undefined,
                        fontWeight: 600,
                      }}
                    >
                      {a.title}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {permittedTabs.includes('claims') && (
              <p className="ops-muted" style={{ margin: '0.35rem 0 0' }}>
                {pendingClaimsCount} reclamos abiertos
              </p>
            )}
            {permittedTabs.includes('alerts') && (
              <button type="button" className="ops-dash-link" onClick={() => goToTab('alerts')}>
                Ver alertas {'>'}
              </button>
            )}
          </article>
        </div>
      </section>

      {/* ESCENARIO PRINCIPAL: 3 columnas desiguales */}
      <section className={`ops-dash-main ${!hasAccounting ? 'ops-dash-main--ops' : ''}`}>
        {/* IZQUIERDA — Comunicar / trabajo del día */}
        <div className="ops-dash-col ops-dash-col--left">
          {hasMessaging ? (
            <article className="glass-card ops-card ops-card--tall">
              <header className="ops-card-head">
                <MessageSquare size={16} color="var(--primary-gold)" />
                <h3>Comunicaciones</h3>
              </header>

              <div className="ops-donut-wrap">
                <div className="donut-chart" style={{ background: donutGradient }}>
                  <div className="donut-hole" />
                </div>
                <strong>{msgStats.total} mensajes</strong>
              </div>

              <ul className="ops-status-list">
                {[
                  { color: '#ef4444', count: msgStats.unanswered, label: 'No respondida', p: pct(msgStats.unanswered, msgStats.total) },
                  { color: '#a855f7', count: msgStats.unread, label: 'No leída', p: pct(msgStats.unread, msgStats.total) },
                  { color: 'var(--emerald-accent)', count: msgStats.inProgress, label: 'En progreso', p: pct(msgStats.inProgress, msgStats.total) },
                ].map((row) => (
                  <li key={row.label}>
                    <span className="ops-status-dot" style={{ background: row.color }} />
                    <span className="ops-status-label">{row.count} {row.label}</span>
                    <span className="ops-status-pct">{row.p}%</span>
                    <button type="button" className="ops-mini-btn" onClick={() => navigate('/mensajes')}>Ver</button>
                  </li>
                ))}
              </ul>

              <div className="ops-card-foot">
                {link('Ver todas las comunicaciones >', () => navigate('/mensajes'))}
                <div className="ops-btn-pair">
                  {permittedTabs.includes('surveys') && (
                    <button type="button" className="ops-outline-btn" onClick={() => goToTab('surveys')}>+ Encuesta</button>
                  )}
                  <button type="button" className="ops-outline-btn" onClick={() => goToTab('messaging')}>+ Comunicación</button>
                </div>
              </div>
            </article>
          ) : (
            <article className="glass-card ops-card ops-card--tall">
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
                        <span style={{ color: clm.status === 'pending' ? '#f59e0b' : '#818cf8' }}>
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
            <article className="glass-card ops-card ops-card--gate">
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
              {permittedTabs.includes('access') && (
                <div style={{ marginTop: '0.55rem' }}>
                  {link('Ver registro de ingresos >', () => goToTab('access'))}
                </div>
              )}
            </article>
          )}

          {permittedTabs.includes('staff') && (
            <article className="glass-card ops-floor-card">
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
            <article className="glass-card ops-floor-card">
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
              <article className="glass-card ops-card">
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
                  <div className="ops-ring" title={`${finance.alDia} de ${finance.activeMembers} socios al día`}>
                    {liveCollectionRate}%
                  </div>
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

                <div className="ops-block" style={{ marginTop: '1rem' }}>
                  <div className="ops-block-title ops-block-title--split">
                    <span>Ingresos de hoy</span>
                    {finance.collectedToday > 0 ? (
                      <strong style={{ color: 'var(--emerald-accent)' }}>
                        {formatCurrency(finance.collectedToday)}
                      </strong>
                    ) : null}
                  </div>
                  {finance.todayIncomes.length === 0 ? (
                    <p className="ops-muted" style={{ margin: '0.35rem 0 0' }}>
                      Todavía no hay cobros registrados hoy.
                    </p>
                  ) : (
                    finance.todayIncomes.map((row) => (
                      <div key={`today-${row.id}`} className="ops-row">
                        <span className="ops-ellipsis">{row.label}</span>
                        <strong style={{ color: 'var(--emerald-accent)' }}>{formatCurrency(row.amount)}</strong>
                      </div>
                    ))
                  )}
                </div>

                <div className="ops-block" style={{ marginTop: '0.85rem' }}>
                  <div className="ops-block-title">Últimos ingresos · {monthLabelCap}</div>
                  {finance.recentIncomes.length === 0 ? (
                    <p className="ops-muted" style={{ margin: '0.35rem 0 0' }}>
                      Sin cobros ni asientos de ingreso registrados este mes.
                    </p>
                  ) : (
                    finance.recentIncomes.map((row) => (
                      <div key={row.id} className="ops-row">
                        <span className="ops-ellipsis">
                          <span className="ops-muted" style={{ marginRight: 6 }}>{row.date.slice(8, 10)}/{row.date.slice(5, 7)}</span>
                          {row.label}
                        </span>
                        <strong style={{ color: 'var(--emerald-accent)' }}>{formatCurrency(row.amount)}</strong>
                      </div>
                    ))
                  )}
                  {(finance.journalExpenseMonth > 0 || totalActivos > 0) && (
                    <div className="ops-row" style={{ marginTop: '0.35rem' }}>
                      <span className="ops-muted">Activos contables / gastos del mes</span>
                      <strong>
                        {formatCurrency(totalActivos)}
                        {finance.journalExpenseMonth > 0 ? ` · −${formatCurrency(finance.journalExpenseMonth)}` : ''}
                      </strong>
                    </div>
                  )}
                </div>

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

                {renderDuesQueue()}

                <div className="ops-btn-pair" style={{ marginTop: '1rem' }}>
                  {hasMembers && (
                    <button type="button" className="ops-outline-btn" onClick={() => goToTab('members')}>+ Socios</button>
                  )}
                  <button type="button" className="ops-outline-btn" onClick={() => goToTab('accounting', 'suppliers')}>+ Proveedores</button>
                </div>
              </article>

              <AlertsBanner
                alerts={alerts}
                alertAcks={alertAcks}
                userRole={userRole}
                onAck={onAckAlert}
                onlySources={['concession_expiry', 'concession_docs']}
                maxItems={5}
                style={{ marginBottom: 0, marginTop: 0 }}
              />
              {(alerts || []).some((a) => (
                (a.source === 'concession_expiry' || a.source === 'concession_docs')
                && a.isActive !== false
              )) && (
                <button
                  type="button"
                  className="ops-dash-link"
                  onClick={() => goToTab('concessions')}
                  style={{ alignSelf: 'flex-start' }}
                >
                  Gestionar concesiones {'>'}
                </button>
              )}
            </>
          ) : (
            <>
              {renderDuesQueue()}
              {permittedTabs.includes('events') && nextEvent && (
                <article className="glass-card ops-card">
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
              <article className="glass-card ops-card ops-padron-card">
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
                {padronTop.restCats > 0 ? (
                  <p className="ops-muted ops-padron-more">
                    +{padronTop.restCats} categorías · {padronTop.restCount.toLocaleString('es-AR')} titulares
                  </p>
                ) : null}
                {overdueMembersCount > 0 ? (
                  <p className="ops-padron-mora">
                    {overdueMembersCount} con cuota en mora
                  </p>
                ) : null}
                <button
                  type="button"
                  className="ops-padron-cta"
                  onClick={() => goToTab('members')}
                >
                  <span>Ver padrón</span>
                  <ChevronRight size={16} strokeWidth={2.25} />
                </button>
              </article>

              <button type="button" className="ops-stat ops-stat--a" onClick={() => goToTab('members')}>
                <Users size={18} />
                <span><b>{household.titulares}</b> Socios titulares</span>
              </button>
              <button type="button" className="ops-stat ops-stat--d" onClick={() => goToTab('system')}>
                <UserRound size={18} />
                <span><b>{registeredUsersCount}</b> Usuarios registrados</span>
              </button>
              <button type="button" className="ops-stat ops-stat--e" onClick={() => goToTab('system')}>
                <UserPlus size={18} />
                <span><b>{pendingMembershipApps}</b> Solicitudes de socio</span>
              </button>
              <button type="button" className="ops-stat ops-stat--b" onClick={() => goToTab('members')}>
                <Users size={18} />
                <span><b>{adherentsCount}</b> Grupo familiar</span>
              </button>
              {membersWithApp > 0 && (
                <button type="button" className="ops-stat ops-stat--c" onClick={() => goToTab('members')}>
                  <UserCircle2 size={18} />
                  <span><b>{membersWithApp}</b> Con app instalada</span>
                </button>
              )}
            </>
          ) : (
            <article className="glass-card ops-card">
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
            <button type="button" className="ops-chip" onClick={() => goToTab('surveys')}>
              <CheckCircle2 size={15} /> {surveys.length} encuestas
            </button>
          )}

          {(permittedTabs.includes('news') || (permittedTabs.includes('events') && nextEvent && hasAccounting) || (permittedTabs.includes('claims') && hasAccounting)) && (
            <article className="glass-card ops-floor-card">
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
