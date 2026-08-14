import { useState } from 'react';
import { Sun, Moon, Shield, User, Menu, X, Bell, LogOut, Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { navItemsForRole, ROLE_LABELS, sessionGreetLabel } from '../domain/auth/roles';

function formatHeaderDate(d = new Date()) {
  const raw = d.toLocaleDateString('es-AR', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export default function Navbar({
  currentView,
  setCurrentView,
  theme,
  toggleTheme,
  notifications = [],
  unreadMessages = 0,
  onOpenNotification,
  onDismissNotification,
  onMarkAllNotificationsRead,
}) {
  const { user, role, logout, roleLabel } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);

  const visibleItems = navItemsForRole(role || 'member');
  const headerDate = formatHeaderDate();
  const greetName = sessionGreetLabel(user?.fullName || '', role);

  const handleNavClick = (viewId) => {
    setCurrentView(viewId);
    setIsOpen(false);
    setShowNotifs(false);
  };

  const handleLogout = async () => {
    await logout();
    setCurrentView('dashboard');
    setIsOpen(false);
  };

  return (
    <nav className="glass-panel nav-bar-shell" style={{
      position: 'sticky',
      top: 0,
      zIndex: 100,
      margin: '0 0 1rem 0',
      borderRadius: '0 0 var(--radius-md) var(--radius-md)',
      borderTop: 'none',
      borderLeft: 'none',
      borderRight: 'none',
      background: 'color-mix(in srgb, var(--bg-secondary) 92%, transparent)',
    }}>
      <div className="nav-inner-bar" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '1rem 1.25rem',
        maxWidth: '1400px',
        margin: '0 auto',
        width: '100%',
        boxSizing: 'border-box',
        gap: '0.5rem',
      }}>
        <div className="nav-brand-block">
          <button
            type="button"
            onClick={() => handleNavClick('dashboard')}
            aria-label="Ir al inicio · Jockey Club San Juan"
            className="nav-brand-btn"
          >
            <img
              src="/logo-jockey-club.png"
              alt=""
              width={42}
              height={42}
              fetchPriority="high"
              className="nav-brand-logo"
            />
            <span className="serif-font nav-brand-text">
              Jockey Club
            </span>
          </button>
          <time className="nav-header-date" dateTime={new Date().toISOString().slice(0, 10)}>
            {headerDate}
          </time>
        </div>

        <div style={{ display: 'none', gap: '1.5rem', alignItems: 'center' }} className="desktop-menu-container">
          <style>{`
            @media (min-width: 1024px) {
              .desktop-menu-container { display: flex !important; }
              .mobile-toggle { display: none !important; }
            }
            @media (max-width: 480px) {
              .nav-brand-text { display: none !important; }
              .nav-inner-bar { padding: 0.75rem 1rem !important; }
            }
          `}</style>

          {visibleItems.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNavClick(item.id)}
              aria-current={currentView === item.id ? 'page' : undefined}
              style={{
                background: 'transparent',
                border: 'none',
                color: currentView === item.id ? 'var(--primary-gold)' : 'var(--text-secondary)',
                fontFamily: 'inherit',
                fontSize: '0.95rem',
                fontWeight: '600',
                cursor: 'pointer',
                padding: '0.5rem 0.75rem',
                position: 'relative',
                transition: 'color 0.15s ease, background-color 0.15s ease'
              }}
            >
              {item.label}
              {currentView === item.id && (
                <div style={{
                  position: 'absolute',
                  bottom: 0,
                  left: '0.75rem',
                  right: '0.75rem',
                  height: '2px',
                  backgroundColor: 'var(--primary-gold)',
                  borderRadius: '2px'
                }} />
              )}
            </button>
          ))}
        </div>

        <div className="desktop-menu-container" style={{ display: 'none', alignItems: 'center', gap: '0.75rem' }}>
          <button
            type="button"
            onClick={() => handleNavClick('messages')}
            title="Mensajería interna"
            aria-label={unreadMessages > 0 ? `Mensajes, ${unreadMessages} sin leer` : 'Mensajes'}
            style={{
              background: currentView === 'messages' ? 'rgba(207,161,58,0.12)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${currentView === 'messages' ? 'rgba(207,161,58,0.4)' : 'var(--border-glass)'}`,
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
            {unreadMessages > 0 && (
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
                {unreadMessages > 9 ? '9+' : unreadMessages}
              </span>
            )}
          </button>

          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setShowNotifs((v) => !v)}
              title="Notificaciones"
              aria-label={notifications.length > 0 ? `Notificaciones, ${notifications.length} pendientes` : 'Notificaciones'}
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
              {notifications.length > 0 && (
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
                  {notifications.length > 9 ? '9+' : notifications.length}
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
                      {notifications.length === 0 ? 'Al día' : `${notifications.length} pendientes`}
                    </span>
                    {notifications.length > 0 && typeof onMarkAllNotificationsRead === 'function' && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ fontSize: '0.68rem', padding: '0.2rem 0.45rem' }}
                        onClick={() => onMarkAllNotificationsRead()}
                      >
                        Marcar leídas
                      </button>
                    )}
                  </div>
                </div>
                {notifications.length === 0 ? (
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1.25rem 0.5rem' }}>
                    Sin novedades por ahora.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.5rem' }}>
                    {notifications.map((n) => (
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
                            setShowNotifs(false);
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
                            onClick={() => onDismissNotification(n.id)}
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
                ? (currentView === 'profile' ? 'rgba(207, 161, 58, 0.22)' : 'rgba(207, 161, 58, 0.1)')
                : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              border: `1px solid ${role === 'member' ? 'rgba(207, 161, 58, 0.3)' : 'transparent'}`,
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
          className="mobile-toggle"
          aria-label={isOpen ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={isOpen}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            padding: '0.5rem'
          }}
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
          <time className="nav-header-date nav-header-date--mobile" dateTime={new Date().toISOString().slice(0, 10)}>
            {headerDate}
          </time>

          {visibleItems.map(item => (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.id)}
              style={{
                background: currentView === item.id ? 'rgba(207, 161, 58, 0.05)' : 'transparent',
                border: 'none',
                borderLeft: currentView === item.id ? '3px solid var(--primary-gold)' : '3px solid transparent',
                color: currentView === item.id ? 'var(--primary-gold)' : 'var(--text-secondary)',
                fontFamily: 'inherit',
                fontSize: '1rem',
                fontWeight: '600',
                cursor: 'pointer',
                padding: '0.75rem 1rem',
                textAlign: 'left',
                width: '100%',
              }}
            >
              {item.label}
            </button>
          ))}

          <button
            type="button"
            onClick={() => handleNavClick('messages')}
            style={{
              background: currentView === 'messages' ? 'rgba(207, 161, 58, 0.05)' : 'transparent',
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
            {unreadMessages > 0 && (
              <span style={{
                marginLeft: 'auto',
                background: 'var(--primary-gold)',
                color: '#060e0a',
                borderRadius: 10,
                padding: '0.1rem 0.45rem',
                fontSize: '0.72rem',
                fontWeight: 800,
              }}>
                {unreadMessages}
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

          <button type="button" className="btn btn-secondary" onClick={handleLogout} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <LogOut size={16} /> Cerrar sesión
          </button>
        </div>
      )}
    </nav>
  );
}
