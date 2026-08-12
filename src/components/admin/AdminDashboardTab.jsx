import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Calendar, DollarSign, Activity, MessageSquare, ClipboardList,
  CheckCircle2, UserPlus, BookOpen, Shield, ShieldAlert, BellRing,
  PartyPopper, Copy, Share2, Clock, UserCircle2,
} from 'lucide-react';
import { canAccessQrGate } from '../../domain/auth/roles';
import { isAlertVisible } from '../../domain/alerts/alerts';
import { AlertsBanner } from '../erp/AlertsPanel';

const CLUB_CODE = 'JCSJ2026';

function pct(part, total) {
  if (!total) return '0.00';
  return ((part / total) * 100).toFixed(2);
}

function firstName(fullName = '') {
  const part = String(fullName).trim().split(/\s+/)[0];
  return part || 'equipo';
}

function formatLongDate(d = new Date()) {
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Mesa de control asimétrica:
 * 1) saludo + atajos | promo
 * 2) comunicaciones | caja+cuotas+portería | padrón
 * 3) franja operativa (reservas / personal / alertas-eventos)
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
  totalMembers,
  paymentCollectionRate,
  totalActivos,
  totalIngresos,
  overdueMembersCount = 0,
  upcomingDuesCount = 0,
  totalOutstanding = 0,
  pendingClaimsCount = 0,
  activeBookingsCount = 0,
  pendingBookingsCount = 0,
  formatCurrency,
  getAccountBalance,
}) {
  const navigate = useNavigate();
  const [codeCopied, setCodeCopied] = useState(false);
  const showGate = canAccessQrGate(userRole);
  const todayKey = new Date().toISOString().slice(0, 10);
  const hasAccounting = permittedTabs.includes('accounting');
  const hasMessaging = permittedTabs.includes('messaging');
  const hasMembers = permittedTabs.includes('members');

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
    const todays = entryLogs.filter((l) => (l.date || '').startsWith(todayKey) || l.date === todayKey);
    const list = todays.length ? todays : entryLogs.slice(0, 4);
    return {
      list: list.slice(0, 3),
      granted: list.filter((l) => l.status === 'granted' || l.status === 'ok').length,
      denied: list.filter((l) => l.status === 'denied' || l.status === 'blocked').length,
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

  const hrPending = useMemo(
    () => (staffHrRecords || []).filter((r) => r.status === 'pending').length,
    [staffHrRecords],
  );

  const activeStaff = staffMembers.filter((s) => s.status === 'active').length;
  const adherentsCount = members.reduce((n, m) => n + (m.adherents?.length || 0), 0);
  const membersWithApp = members.filter((m) => m.hasApp || m.appInstalled).length
    || Math.min(members.length, Math.round(members.length * 0.35));

  const monthLabel = new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  const monthLabelCap = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
  const cashToday = getAccountBalance('Caja General') + getAccountBalance('Caja Cantina') + getAccountBalance('Banco Nación');
  const collected = getAccountBalance('Cuotas Sociales') + getAccountBalance('Caja General') + getAccountBalance('Banco Nación');

  const quickActions = [
    { tab: 'messaging', icon: <MessageSquare size={22} color="var(--primary-gold)" />, label: 'Nuevo Mensaje' },
    { tab: 'surveys', icon: <CheckCircle2 size={22} color="var(--primary-gold)" />, label: 'Nueva Encuesta' },
    { tab: 'reports', icon: <Activity size={22} color="var(--primary-gold)" />, label: 'Nuevo Reporte' },
    { tab: 'dues', icon: <ShieldAlert size={22} color="var(--primary-gold)" />, label: 'Control Cuotas' },
    { tab: 'members', icon: <UserPlus size={22} color="var(--primary-gold)" />, label: 'Socios' },
    { tab: 'accounting', focus: 'cash', icon: <DollarSign size={22} color="var(--primary-gold)" />, label: 'Arqueo de Caja', roles: ['cashier'] },
    { tab: 'bookings', icon: <Calendar size={22} color="var(--primary-gold)" />, label: 'Reservas' },
    { tab: 'claims', icon: <ClipboardList size={22} color="var(--primary-gold)" />, label: 'Reclamos' },
  ]
    .filter((a) => permittedTabs.includes(a.tab) && (!a.roles || a.roles.includes(userRole)))
    .slice(0, 4);

  const copyClubCode = async () => {
    try {
      await navigator.clipboard.writeText(CLUB_CODE);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1800);
    } catch { /* ignore */ }
  };

  const shareWhatsApp = () => {
    const text = encodeURIComponent(`Unite al Jockey Club San Juan con el código ${CLUB_CODE}`);
    window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener,noreferrer');
  };

  const link = (label, onClick) => (
    <button type="button" className="ops-dash-link" onClick={onClick}>{label}</button>
  );

  return (
    <div className="fade-in ops-dash">
      <section className="ops-dash-hero ops-dash-hero--solo">
        <div className="ops-dash-hero-main">
          <p className="ops-dash-greet">¡Hola nuevamente {firstName(userName)}!</p>
          <h2 className="ops-dash-brand">Jockey Club San Juan</h2>
          <div className="ops-dash-actions">
            {quickActions.map((action) => (
              <button
                type="button"
                key={`${action.tab}-${action.label}`}
                className="ops-dash-action"
                onClick={() => goToTab(action.tab, action.focus || null)}
              >
                {action.icon}
                <span>{action.label}</span>
              </button>
            ))}
          </div>
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
                    Reservas · {activeBookingsCount} ok · {pendingBookingsCount} pend.
                  </div>
                  {reservations.filter((r) => r.status === 'confirmed' || r.status === 'pending').slice(0, 3).map((res) => (
                    <div key={res.id} className="ops-row ops-row--stack">
                      <strong>{res.facilityName}</strong>
                      <span className="ops-muted">{res.date} · {res.time} hs · {res.memberName}</span>
                    </div>
                  ))}
                  {link('Ver agenda >', () => goToTab('bookings'))}
                </div>
              )}
            </article>
          )}

          {showGate && (
            <article className="glass-card ops-card ops-card--gate">
              <header className="ops-card-head ops-card-head--split">
                <div>
                  <Shield size={16} color="var(--primary-gold)" />
                  <h3>Portería</h3>
                </div>
                <span className="ops-muted" style={{ fontSize: '0.75rem' }}>{formatLongDate()}</span>
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
                <div key={log.id} className="ops-row">
                  <span className="ops-ellipsis">{log.memberName}</span>
                  <span className="ops-muted">{log.time || '—'}</span>
                </div>
              ))}
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
                  <b style={{ color: 'var(--emerald-accent)' }}>{activeBookingsCount}</b>
                  <span>confirmadas</span>
                </div>
                <div>
                  <b style={{ color: '#f59e0b' }}>{pendingBookingsCount}</b>
                  <span>pendientes</span>
                </div>
              </div>
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
                  <div className="ops-ring">{paymentCollectionRate}%</div>
                  <div>
                    <div className="ops-money-big">{formatCurrency(totalActivos)}</div>
                    <div className="ops-muted">Liquidado en {monthLabelCap}</div>
                    <div className="ops-money-green">{formatCurrency(collected)}</div>
                    <div className="ops-muted" style={{ color: 'var(--emerald-accent)' }}>Recaudado en {monthLabelCap}</div>
                  </div>
                </div>

                <button type="button" className="ops-cash-banner" onClick={() => goToTab('accounting', 'cash')}>
                  <span className="ops-cash-ico"><DollarSign size={20} /></span>
                  <span>
                    <strong>{formatCurrency(cashToday)}</strong>
                    <small>Total en caja al día de hoy</small>
                  </span>
                  <span className="ops-cash-go">Ver</span>
                </button>

                <div className="ops-block" style={{ marginTop: '1rem' }}>
                  <div className="ops-block-title">Últimos ingresos</div>
                  <div className="ops-row">
                    <span className="ops-muted">Movimientos del período</span>
                    <strong>{formatCurrency(totalIngresos)}</strong>
                  </div>
                </div>

                {permittedTabs.includes('dues') && (
                  <div className="ops-dues-strip">
                    <div>
                      <strong style={{ color: '#ef4444' }}>{overdueMembersCount}</strong>
                      <span>con deuda</span>
                    </div>
                    <div>
                      <strong style={{ color: '#f59e0b' }}>{upcomingDuesCount}</strong>
                      <span>a vencer</span>
                    </div>
                    <div className="ops-dues-total">
                      <strong>{formatCurrency(totalOutstanding)}</strong>
                      <span>pendiente</span>
                    </div>
                    {link('Cobranzas >', () => goToTab('dues'))}
                  </div>
                )}

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
              <article className="glass-card ops-card">
                <header className="ops-card-head">
                  <Users size={16} color="var(--primary-gold)" />
                  <h3>Socios</h3>
                </header>
                <p className="ops-muted" style={{ marginBottom: '0.75rem' }}>¡Comparte el código de tu club!</p>
                <div className="ops-code-box">
                  <span>{codeCopied ? '¡Copiado!' : CLUB_CODE}</span>
                  <div>
                    <Share2 size={15} onClick={shareWhatsApp} title="WhatsApp" />
                    <Copy size={15} onClick={copyClubCode} title="Copiar" />
                  </div>
                </div>
              </article>

              <button type="button" className="ops-stat ops-stat--a" onClick={() => goToTab('members')}>
                <Users size={18} />
                <span><b>{totalMembers}</b> Socios activos</span>
              </button>
              <button type="button" className="ops-stat ops-stat--b" onClick={() => goToTab('members')}>
                <UserCircle2 size={18} />
                <span><b>{membersWithApp}</b> Socios con la app</span>
              </button>
              <button type="button" className="ops-stat ops-stat--c" onClick={() => goToTab('members')}>
                <Users size={18} />
                <span><b>{adherentsCount}</b> Adherentes</span>
              </button>
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

          {(permittedTabs.includes('alerts') || (permittedTabs.includes('events') && nextEvent && hasAccounting) || (permittedTabs.includes('claims') && hasAccounting)) && (
            <article className="glass-card ops-floor-card ops-floor-card--pulse">
              {permittedTabs.includes('alerts') && (
                <div className="ops-floor-section">
                  <header className="ops-card-head">
                    <BellRing size={16} color="var(--primary-gold)" />
                    <h3>Alertas</h3>
                  </header>
                  {activeAlerts.length === 0 ? (
                    <p className="ops-muted">Sin alertas vigentes.</p>
                  ) : (
                    activeAlerts.map((a) => (
                      <div key={a.id} className="ops-row">
                        <span style={{
                          color: a.severity === 'critical' ? '#ef4444' : a.severity === 'warning' ? '#f59e0b' : 'var(--text-secondary)',
                          fontWeight: 600,
                          fontSize: '0.82rem',
                        }}
                        >
                          {a.title}
                        </span>
                      </div>
                    ))
                  )}
                  {link('Ver alertas >', () => goToTab('alerts'))}
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
