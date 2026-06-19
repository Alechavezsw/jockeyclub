import React, { useState } from 'react';
import { Sun, Moon, Shield, User, Menu, X, Bell } from 'lucide-react';

export default function Navbar({ currentView, setCurrentView, userRole, setUserRole, theme, toggleTheme }) {
  const [isOpen, setIsOpen] = useState(false);

  const navItems = [
    { id: 'dashboard', label: 'Inicio', roles: ['member', 'admin'] },
    { id: 'reservations', label: 'Reservar Canchas', roles: ['member'] },
    { id: 'news', label: 'Revista Digital', roles: ['member', 'admin'] },
    { id: 'admin', label: 'Administración', roles: ['admin'] }
  ];

  const handleNavClick = (viewId) => {
    setCurrentView(viewId);
    setIsOpen(false);
  };

  const toggleRole = () => {
    const nextRole = userRole === 'member' ? 'admin' : 'member';
    setUserRole(nextRole);
    // Redirigir a inicio al cambiar de rol para evitar inconsistencias
    if (nextRole === 'member' && currentView === 'admin') {
      setCurrentView('dashboard');
    } else if (nextRole === 'admin' && currentView === 'reservations') {
      setCurrentView('admin');
    }
  };

  // Filtrar ítems de navegación según el rol activo
  const visibleItems = navItems.filter(item => item.roles.includes(userRole));

  return (
    <nav className="glass-panel" style={{
      position: 'sticky',
      top: 0,
      zIndex: 100,
      margin: '0 0 1rem 0',
      borderRadius: '0 0 var(--radius-md) var(--radius-md)',
      borderTop: 'none',
      borderLeft: 'none',
      borderRight: 'none'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '1rem 2rem',
        maxWidth: '1400px',
        margin: '0 auto',
        width: '100%'
      }}>
        {/* Marca / Logotipo */}
        <div 
          onClick={() => handleNavClick('dashboard')} 
          style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}
        >
          <img 
            src="/Gemini_Generated_Image_n1d2h3n1d2h3n1d2.png" 
            alt="Logo" 
            style={{ 
              width: '46px', 
              height: '46px', 
              borderRadius: '50%', 
              objectFit: 'cover', 
              border: '2px solid var(--primary-gold)',
              boxShadow: '0 0 10px rgba(207, 161, 58, 0.4)'
            }} 
          />
          <span className="serif-font" style={{
            fontSize: '1.4rem',
            fontWeight: '700',
            letterSpacing: '0.15em',
            color: 'var(--text-primary)',
            textTransform: 'uppercase'
          }}>
            Jockey Club
          </span>
        </div>

        {/* Enlaces de Navegación Escritorio */}
        <div style={{ display: 'none', gap: '1.5rem', alignItems: 'center', WebkitBoxAlign: 'center' }} className="desktop-menu-container">
          <style>{`
            @media (min-width: 768px) {
              .desktop-menu-container { display: flex !important; }
              .mobile-toggle { display: none !important; }
            }
          `}</style>
          
          {visibleItems.map(item => (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.id)}
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
                transition: 'var(--transition-fast)'
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

        {/* Controles de Configuración y Cambio de Rol */}
        <div className="desktop-menu-container" style={{ display: 'none', alignItems: 'center', gap: '1rem' }}>
          {/* Indicador de Notificaciones */}
          <button style={{
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
          }}>
            <Bell size={18} />
            <div style={{
              position: 'absolute',
              top: '8px',
              right: '8px',
              width: '8px',
              height: '8px',
              backgroundColor: 'var(--primary-gold)',
              borderRadius: '50%'
            }} />
          </button>

          {/* Toggle Claro/Oscuro */}
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
              color: 'var(--text-primary)',
              transition: 'var(--transition-fast)'
            }}
            title={theme === 'dark' ? 'Modo Claro' : 'Modo Oscuro'}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {/* Selector de Rol Dinámico */}
          <button 
            onClick={toggleRole}
            className="btn"
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.85rem',
              borderRadius: '20px',
              background: userRole === 'admin' ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'rgba(207, 161, 58, 0.1)',
              border: `1px solid ${userRole === 'admin' ? 'transparent' : 'rgba(207, 161, 58, 0.3)'}`,
              color: userRole === 'admin' ? '#ffffff' : 'var(--primary-gold)',
              boxShadow: userRole === 'admin' ? '0 4px 10px rgba(16, 185, 129, 0.2)' : 'none'
            }}
          >
            {userRole === 'admin' ? (
              <>
                <Shield size={14} /> Administrador
              </>
            ) : (
              <>
                <User size={14} /> Socio
              </>
            )}
          </button>
        </div>

        {/* Botón de Menú Móvil */}
        <button 
          onClick={() => setIsOpen(!isOpen)}
          className="mobile-toggle"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            padding: '0.5rem'
          }}
        >
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Menú Desplegable Móvil */}
      {isOpen && (
        <div className="glass-panel" style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          borderLeft: 'none',
          borderRight: 'none',
          borderRadius: `0 0 var(--radius-md) var(--radius-md)`,
          padding: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          zIndex: 99
        }}>
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
                transition: 'var(--transition-fast)'
              }}
            >
              {item.label}
            </button>
          ))}

          <hr style={{ border: 'none', borderTop: '1px solid var(--border-glass)', margin: '0.5rem 0' }} />

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

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Rol de Acceso:</span>
            <button 
              onClick={toggleRole}
              className="btn btn-sm"
              style={{
                borderRadius: '20px',
                background: userRole === 'admin' ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'rgba(207, 161, 58, 0.1)',
                border: `1px solid ${userRole === 'admin' ? 'transparent' : 'rgba(207, 161, 58, 0.3)'}`,
                color: userRole === 'admin' ? '#ffffff' : 'var(--primary-gold)'
              }}
            >
              {userRole === 'admin' ? 'Administrador' : 'Socio'}
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
