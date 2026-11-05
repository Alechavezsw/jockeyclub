import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Sun, Moon, Shield, User, Menu, X, Bell, LogOut, Mail, LayoutDashboard,
  Home, CalendarDays, Wallet, Newspaper, ClipboardCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { navItemsForRole, ROLE_LABELS, sessionGreetLabel } from '../domain/auth/roles';
import { formatLongDateAR, todayISODateAR } from '../lib/arDate';
import { preventButtonScroll } from '../lib/scrollPage';
import { APP_NAME } from '../domain/system/appBrand';
import { JockeyWordmark } from './brand/JockeyBrand';

const NAV_ICONS = {
  dashboard: Home,
  reservations: CalendarDays,
  payments: Wallet,
  news: Newspaper,
  attendance: ClipboardCheck,
};

export default function Navbar({
  currentView,
  setCurrentView,
  theme,
  toggleTheme,
  notifications = [],
  unreadMessages = 0,
  duesOverdue = false,
  duesDueSoon = false,
  onOpenNotification,
  onDismissNotification,
  onMarkAllNotificationsRead,
  membersCanViewCurrentAccounts = true,
}) {
  const { user, role, logout, roleLabel, canAccessAdmin: sessionCanAccessAdmin, roles, isDualDesk, desk, switchDesk } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  // Snapshot al abrir: se puede leer el listado aunque ya se marquen leídas (badge a 0).
  const [notifSnapshot, setNotifSnapshot] = useState([]);

  const isOperative = Boolean(sessionCanAccessAdmin);
  const isTeacher = role === 'teacher' || (roles || []).some((r) => r.roleKey === 'teacher');
  const visibleItems = navItemsForRole(role || 'member', { membersCanViewCurrentAccounts });
  const deskSwitch = isDualDesk && desk
    ? {
      label: desk === 'ops' ? 'Entrar como socio' : 'Entrar a administración',
      next: desk === 'ops' ? 'member' : 'ops',
    }
    : null;
  const headerDate = formatLongDateAR();
  const headerDateISO = todayISODateAR();
  const greetName = sessionGreetLabel(user?.fullName || '', role);
  const isPanelHome = isOperative && (
    /^\/panel\/?$/.test(location.pathname)
    || location.pathname === '/panel/dashboard'
  );

  const visibleNotifs = showNotifs ? notifSnapshot : notifications;
  const pendingCount = notifications.length;

  const closeNotifs = () => {
    setShowNotifs(false);
    setNotifSnapshot([]);
  };

  const openNotifs = () => {
    const snapshot = [...notifications];
    setNotifSnapshot(snapshot);
    setShowNotifs(true);
    if (snapshot.length > 0 && typeof onMarkAllNotificationsRead === 'function') {
      onMarkAllNotificationsRead();
    }
  };

  const toggleNotifs = () => {
    if (showNotifs) closeNotifs();
    else openNotifs();
  };

  useEffect(() => {
    if (!showNotifs) return undefined;
    const onDocClick = (e) => {
      const root = e.target?.closest?.('[data-notif-panel-root]');
      if (!root) closeNotifs();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') closeNotifs();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [showNotifs]);

  const handleNavClick = (viewId) => {
    setCurrentView(viewId);
    setIsOpen(false);
    closeNotifs();
  };

  const goHome = () => {
    if (isOperative) navigate('/panel/dashboard');
    else if (isTeacher) navigate('/asistencia');
    else handleNavClick('dashboard');
    setIsOpen(false);
    closeNotifs();
  };

  const handleLogout = async () => {
    await logout();
    setCurrentView('dashboard');
    setIsOpen(false);
    closeNotifs();
  };

  return (
    <nav className="glass-panel nav-bar-shell">
      <div className="nav-inner-bar">
        <div className="nav-brand-block">
          <button
            type="button"
            onClick={goHome}
            aria-label={`Ir al inicio · ${APP_NAME}`}
            className="nav-brand-btn"
          >
            <img
              src="/logo-jockey-club.png?v=clavos-blancos"
              alt="Escudo Jockey Club San Juan"
              width={64}
              height={64}
              fetchPriority="high"
              className="club-mark nav-brand-logo"
            />
            <span className="nav-brand-copy">
              <span className="nav-brand-text"><JockeyWordmark /></span>
              <time className="nav-header-date" dateTime={headerDateISO}>
                {headerDate}
              </time>
            </span>
          </button>
          {isOperative && (
            <button
              type="button"
              onClick={goHome}
              aria-current={isPanelHome ? 'page' : undefined}
              className={`nav-panel-home-btn${isPanelHome ? ' is-active' : ''}`}
            >
              <LayoutDashboard size={16} strokeWidth={isPanelHome ? 2.4 : 2} aria-hidden="true" />
              Inicio
            </button>
          )}
        </div>

        {visibleItems.length > 0 ? (
          <div className="nav-links-rail desktop-menu-container" role="navigation" aria-label="Secciones">
            {visibleItems.map((item) => {
              const Icon = NAV_ICONS[item.id];
              const active = currentView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`nav-rail-link${active ? ' is-active' : ''}`}
                  onMouseDown={preventButtonScroll}
                  onClick={() => handleNavClick(item.id)}
                  aria-current={active ? 'page' : undefined}
                >
                  {Icon ? <Icon size={15} strokeWidth={active ? 2.4 : 2} aria-hidden="true" /> : null}
                  <span className="nav-rail-label">{item.label}</span>
                  <span className="nav-rail-label-short">{item.shortLabel || item.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="nav-actions desktop-menu-container">
          <button
            type="button"
            onClick={() => handleNavClick('messages')}
            title={
              duesOverdue
                ? 'Mensajería interna · cuota en mora'
                : duesDueSoon
                  ? 'Mensajería interna · cuota por vencer'
                  : 'Mensajería interna'
            }
            aria-label={
              duesOverdue
                ? (unreadMessages > 0 ? `Mensajes, ${unreadMessages} sin leer y cuota en mora` : 'Mensajes, cuota en mora')
                : duesDueSoon
                  ? (unreadMessages > 0 ? `Mensajes, ${unreadMessages} sin leer y cuota por vencer` : 'Mensajes, cuota por vencer')
                  : unreadMessages > 0
                    ? `Mensajes, ${unreadMessages} sin leer`
                    : 'Mensajes'
            }
            style={{
              background: currentView === 'messages' ? 'rgba(var(--primary-gold-rgb),0.12)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${currentView === 'messages' ? 'rgba(var(--primary-gold-rgb),0.4)' : 'var(--border-glass)'}`,
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: currentView === 'messages' ? 'var(--primary-gold)' : 'var(--text-primary)',
              position: 'relative'
            }}
          >
            <Mail size={18} aria-hidden="true" />
            {(unreadMessages > 0 || duesOverdue || duesDueSoon) && (
              <span style={{
                position: 'absolute',
                top: '-4px',
                right: '-4px',
                minWidth: '18px',
                height: '18px',
                borderRadius: '9px',
                background: duesOverdue ? '#CA390C' : 'var(--primary-gold)',
                color: duesOverdue ? '#fff' : '#060e0a',
                fontSize: '0.68rem',
                fontWeight: '800',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 4px',
                border: '2px solid var(--bg-primary, #060e0a)'
              }}>
                {unreadMessages > 0 ? (unreadMessages > 9 ? '9+' : unreadMessages) : '!'}
              </span>
            )}
          </button>

          <div style={{ position: 'relative' }} data-notif-panel-root>
            <button
              type="button"
              onClick={toggleNotifs}
              title="Notificaciones"
              aria-label={pendingCount > 0 ? `Notificaciones, ${pendingCount} pendientes` : 'Notificaciones'}
              aria-expanded={showNotifs}
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--border-glass)',
                borderRadius: '50%',
                width: '40px',
                height: '40px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'var(--text-primary)',
                position: 'relative'
              }}
            >
              <Bell size={18} aria-hidden="true" />
              {pendingCount > 0 && (
                <span style={{
                  position: 'absolute',
                  top: '-4px',
                  right: '-4px',
                  minWidth: '18px',
                  height: '18px',
                  borderRadius: '9px',
                  background: 'var(--primary-gold)',
                  color: '#060e0a',
                  fontSize: '0.68rem',
                  fontWeight: '800',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 4px',
                  border: '2px solid var(--bg-primary, #060e0a)'
                }}>
                  {pendingCount > 9 ? '9+' : pendingCount}
                </span>
              )}
            </button>

            {showNotifs && (
              <div className="glass-panel" style={{
                position: 'absolute',
                top: 'calc(100% + 10px)',
                right: 0,
                width: '340px',
                maxHeight: '420px',
                overflowY: 'auto',
                borderRadius: '14px',
                padding: '0.75rem',
                zIndex: 200,
                boxShadow: '0 18px 50px rgba(0,0,0,0.55)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.25rem 0.5rem 0.6rem', borderBottom: '1px solid var(--border-glass)', gap: 8 }}>
                  <strong style={{ fontSize: '0.9rem' }}>Notificaciones</strong>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {visibleNotifs.length === 0 ? 'Al día' : `${visibleNotifs.length} avisos`}
                    </span>
                  </div>
                </div>
                {visibleNotifs.length === 0 ? (
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1.25rem 0.5rem' }}>
                    Sin novedades por ahora.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.5rem' }}>
                    {visibleNotifs.map((n) => (
                      <div
                        key={n.id}
                        style={{
                          display: 'flex',
                          gap: 6,
                          alignItems: 'stretch',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (typeof onOpenNotification === 'function') onOpenNotification(n);
                            else handleNavClick(n.view || 'dashboard');
                            closeNotifs();
                          }}
                          style={{
                            flex: 1,
                            background: 'rgba(255,255,255,0.02)',
                            border: '1px solid var(--border-glass)',
                            borderRadius: '10px',
                            padding: '0.6rem 0.75rem',
                            textAlign: 'left',
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            color: 'var(--text-primary)',
                          }}
                        >
                          <div style={{ fontSize: '0.82rem', fontWeight: '600', marginBottom: '0.15rem' }}>{n.title}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{n.detail}</div>
                        </button>
                        {typeof onDismissNotification === 'function' && (
                          <button
                            type="button"
                            title="Descartar"
                            aria-label={`Descartar ${n.title}`}
                            onClick={() => {
                              onDismissNotification(n.id);
                              setNotifSnapshot((prev) => prev.filter((x) => String(x.id) !== String(n.id)));
                            }}
                            style={{
                              width: 34,
                              borderRadius: 10,
                              border: '1px solid var(--border-glass)',
                              background: 'rgba(255,255,255,0.03)',
                              color: 'var(--text-muted)',
                              cursor: 'pointer',
                            }}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid var(--border-glass)',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'var(--text-primary)',
            }}
            title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
            aria-label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'}
          >
            {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
          </button>

          <button
            type="button"
            className="btn"
            onClick={() => {
              if (role === 'member') handleNavClick('profile');
            }}
            style={{
              padding: '0.45rem 0.85rem',
              fontSize: '0.8rem',
              borderRadius: '20px',
              background: role === 'member'
                ? (currentView === 'profile' ? 'rgba(var(--primary-gold-rgb), 0.22)' : 'rgba(var(--primary-gold-rgb), 0.1)')
                : 'linear-gradient(135deg, var(--emerald-accent) 0%, #064d3f 100%)',
              border: `1px solid ${role === 'member' ? 'rgba(var(--primary-gold-rgb), 0.3)' : 'transparent'}`,
              color: role === 'member' ? 'var(--primary-gold)' : '#fff',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              maxWidth: 220,
              cursor: role === 'member' ? 'pointer' : 'default',
            }}
            title={role === 'member' ? 'Ver mis datos de socio' : user?.email}
          >
            {role === 'member' ? <User size={14} /> : <Shield size={14} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Hola, {greetName}
            </span>
          </button>

          {deskSwitch && (
            <button
              type="button"
              className="btn btn-secondary btn-sm nav-desk-switch"
              onClick={() => switchDesk(deskSwitch.next)}
              title={deskSwitch.label}
            >
              {desk === 'ops' ? <User size={14} /> : <Shield size={14} />}
              {deskSwitch.label}
            </button>
          )}

          <button
            type="button"
            onClick={handleLogout}
            className="btn btn-secondary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 20 }}
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
          >
            <LogOut size={14} /> Salir
          </button>
        </div>

        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="nav-mobile-toggle"
          aria-label={isOpen ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={isOpen}
        >
          {isOpen ? <X size={24} aria-hidden="true" /> : <Menu size={24} aria-hidden="true" />}
        </button>
      </div>

      {isOpen && (
        <div className="nav-mobile-menu" style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          borderLeft: 'none',
          borderRight: 'none',
          borderTop: '1px solid var(--border-glass)',
          borderRadius: `0 0 var(--radius-md) var(--radius-md)`,
          padding: '1.25rem 1.5rem 1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.85rem',
          zIndex: 120,
          background: 'var(--bg-secondary)',
          boxShadow: '0 18px 40px rgba(0,0,0,0.55)',
        }}>
          <time className="nav-header-date nav-header-date--mobile" dateTime={headerDateISO}>
            {headerDate}
          </time>

          {isOperative && (
            <button
              type="button"
              onClick={goHome}
              aria-current={isPanelHome ? 'page' : undefined}
              style={{
                background: isPanelHome ? 'rgba(var(--primary-gold-rgb), 0.05)' : 'transparent',
                border: 'none',
                borderLeft: isPanelHome ? '3px solid var(--primary-gold)' : '3px solid transparent',
                color: isPanelHome ? 'var(--primary-gold)' : 'var(--text-secondary)',
                fontFamily: 'inherit',
                fontSize: '1rem',
                fontWeight: '600',
                cursor: 'pointer',
                padding: '0.75rem 1rem',
                textAlign: 'left',
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <LayoutDashboard size={16} aria-hidden="true" /> Inicio
            </button>
          )}

          {visibleItems.map((item) => {
            const Icon = NAV_ICONS[item.id];
            const active = currentView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-mobile-link${active ? ' is-active' : ''}`}
                onMouseDown={preventButtonScroll}
                onClick={() => handleNavClick(item.id)}
                aria-current={active ? 'page' : undefined}
              >
                {Icon ? <Icon size={16} aria-hidden="true" /> : null}
                {item.label}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => handleNavClick('messages')}
            style={{
              background: currentView === 'messages' ? 'rgba(var(--primary-gold-rgb), 0.05)' : 'transparent',
              border: 'none',
              borderLeft: currentView === 'messages' ? '3px solid var(--primary-gold)' : '3px solid transparent',
              color: currentView === 'messages' ? 'var(--primary-gold)' : 'var(--text-secondary)',
              fontFamily: 'inherit',
              fontSize: '1rem',
              fontWeight: '600',
              cursor: 'pointer',
              padding: '0.75rem 1rem',
              textAlign: 'left',
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Mail size={16} /> Mensajes
            {(unreadMessages > 0 || duesOverdue || duesDueSoon) && (
              <span style={{
                marginLeft: 'auto',
                background: duesOverdue ? '#CA390C' : 'var(--primary-gold)',
                color: duesOverdue ? '#fff' : '#060e0a',
                borderRadius: 10,
                padding: '0.1rem 0.45rem',
                fontSize: '0.72rem',
                fontWeight: 800,
              }}>
                {unreadMessages > 0
                  ? unreadMessages
                  : duesOverdue
                    ? 'Mora'
                    : duesDueSoon
                      ? 'Vence'
                      : unreadMessages}
              </span>
            )}
          </button>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border-glass)', margin: '0.5rem 0' }} />

          <button
            type="button"
            onClick={() => {
              if (role === 'member') handleNavClick('profile');
            }}
            style={{
              fontSize: '0.85rem',
              color: 'var(--text-secondary)',
              background: 'transparent',
              border: 'none',
              padding: 0,
              textAlign: 'left',
              cursor: role === 'member' ? 'pointer' : 'default',
              fontFamily: 'inherit',
            }}
          >
            Hola, {greetName}
            {role === 'member' && (
              <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-gold)', marginTop: 2 }}>
                Ver mis datos →
              </span>
            )}
            {role !== 'member' && (
              <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                {roleLabel || ROLE_LABELS[role]}
              </span>
            )}
          </button>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Tema:</span>
            <button
              onClick={toggleTheme}
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--border-glass)',
                borderRadius: '50%',
                width: '40px',
                height: '40px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'var(--text-primary)'
              }}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>

          {deskSwitch && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => switchDesk(deskSwitch.next)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              {desk === 'ops' ? <User size={16} /> : <Shield size={16} />}
              {deskSwitch.label}
            </button>
          )}

          <button type="button" className="btn btn-secondary" onClick={handleLogout} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <LogOut size={16} /> Cerrar sesión
          </button>
        </div>
      )}
    </nav>
  );
}
