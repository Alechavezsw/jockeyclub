import React from 'react';
import VirtualCard from '../components/VirtualCard';
import { Calendar, CreditCard, Award, MapPin, CloudSun, Compass, ShieldAlert, ArrowRight, UserCheck } from 'lucide-react';

export default function DashboardView({ member, reservations, cancelReservation, setCurrentView, latestNews }) {
  // Filtrar reservas del socio actual
  const memberReservations = reservations.filter(res => res.memberId === member.memberId);
  const activeReservationsCount = memberReservations.filter(res => res.status !== 'cancelled').length;

  // Formatear dinero
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(amount);
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Bienvenido, {member.name}</h1>
          <p className="page-subtitle">Portal exclusivo de socios del Jockey Club • Membresía Activa</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(16, 185, 129, 0.1)', padding: '0.5rem 1rem', borderRadius: '20px', border: '1px solid rgba(16,185,129,0.2)' }}>
          <UserCheck size={16} style={{ color: 'var(--emerald-accent)' }} />
          <span style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--emerald-accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Acceso Autorizado
          </span>
        </div>
      </div>

      <div className="dashboard-grid">
        {/* Panel Lateral - Credencial y Clima */}
        <div className="side-panel">
          <h3 className="serif-font" style={{ fontSize: '1.2rem', color: 'var(--text-gold)', marginBottom: '0.5rem' }}>Credencial Digital</h3>
          <VirtualCard member={member} />

          {/* Widget del Clima & Estado de Campos */}
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 className="serif-font" style={{ fontSize: '1.1rem', color: 'var(--text-primary)' }}>Clima en Sede</h4>
              <CloudSun style={{ color: 'var(--primary-gold)' }} />
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span style={{ fontSize: '2.5rem', fontWeight: '700', lineHeight: 1 }}>19°C</span>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: '600' }}>Soleado</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Humedad: 62% • Viento: 8 km/h</span>
              </div>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border-glass)' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                <Compass size={16} style={{ color: 'var(--emerald-accent)', marginTop: '2px', flexShrink: 0 }} />
                <div style={{ fontSize: '0.85rem' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>Campo de Golf:</strong> Habilitado sin restricciones.
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                <Compass size={16} style={{ color: 'var(--emerald-accent)', marginTop: '2px', flexShrink: 0 }} />
                <div style={{ fontSize: '0.85rem' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>Pistas de Hípica:</strong> Arena en condiciones óptimas.
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                <ShieldAlert size={16} style={{ color: 'var(--warning-accent)', marginTop: '2px', flexShrink: 0 }} />
                <div style={{ fontSize: '0.85rem' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>Tenis (Arcilla):</strong> Canchas 1 a 6 habilitadas; 7 y 8 en mantenimiento.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Panel Principal - Resumen e Historial */}
        <div className="main-panel">
          {/* Métricas Rápidas */}
          <div className="stat-widget-grid">
            <div className="glass-card stat-widget">
              <div className="stat-icon">
                <CreditCard size={20} />
              </div>
              <div className="stat-info">
                <h4>Estado Contable</h4>
                <div className="stat-value" style={{ color: member.outstandingBalance > 0 ? 'var(--warning-accent)' : 'var(--emerald-accent)' }}>
                  {member.outstandingBalance > 0 ? formatCurrency(member.outstandingBalance) : 'Al Día'}
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
                  {member.outstandingBalance > 0 ? 'Pago pendiente de cuota' : 'Próximo cobro automático: 01/06'}
                </p>
              </div>
            </div>

            <div className="glass-card stat-widget">
              <div className="stat-icon">
                <Calendar size={20} />
              </div>
              <div className="stat-info">
                <h4>Próximos Turnos</h4>
                <div className="stat-value">{activeReservationsCount}</div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
                  Reservas de instalaciones deportivas
                </p>
              </div>
            </div>

            <div className="glass-card stat-widget">
              <div className="stat-icon">
                <Award size={20} />
              </div>
              <div className="stat-info">
                <h4>Nivel Club</h4>
                <div className="stat-value" style={{ color: 'var(--primary-gold)', textTransform: 'capitalize' }}>
                  {member.tier}
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
                  Antigüedad: {member.yearsActive} años como socio
                </p>
              </div>
            </div>
          </div>

          {/* Sección de Próximas Reservas */}
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="serif-font" style={{ fontSize: '1.4rem' }}>Tus Turnos Confirmados</h3>
              {activeReservationsCount > 0 && (
                <button 
                  onClick={() => setCurrentView('reservations')} 
                  className="btn btn-secondary btn-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                >
                  Nuevo Turno <ArrowRight size={14} />
                </button>
              )}
            </div>

            {memberReservations.filter(res => res.status !== 'cancelled').length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem 1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                <Calendar size={48} style={{ color: 'var(--text-muted)', strokeWidth: 1 }} />
                <div>
                  <h4 className="serif-font" style={{ fontSize: '1.2rem', marginBottom: '0.25rem' }}>No tienes reservas programadas</h4>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Reserva canchas de tenis, golf, polo o una mesa en el restaurante gourmet del club.</p>
                </div>
                <button 
                  onClick={() => setCurrentView('reservations')} 
                  className="btn btn-primary"
                  style={{ marginTop: '0.5rem' }}
                >
                  Reservar Cancha / Instalación
                </button>
              </div>
            ) : (
              <div className="activity-list">
                {memberReservations.filter(res => res.status !== 'cancelled').map(res => (
                  <div key={res.id} className="activity-item">
                    <div className="activity-details">
                      <div className={`activity-badge ${res.status === 'pending' ? 'pending' : ''}`}>
                        <Calendar size={18} />
                      </div>
                      <div className="activity-text">
                        <h5>{res.facilityName}</h5>
                        <p style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.1rem' }}>
                          <MapPin size={12} style={{ color: 'var(--primary-gold)' }} /> {res.date} • {res.time} hs
                        </p>
                        {res.guests > 0 && (
                          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
                            Acompañantes: {res.guests} {res.guests === 1 ? 'persona' : 'personas'}
                          </p>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <span className={`status-tag ${res.status}`}>
                        {res.status === 'confirmed' ? 'Confirmado' : 'Pendiente'}
                      </span>
                      <button 
                        onClick={() => cancelReservation(res.id)}
                        className="btn btn-danger btn-sm"
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Últimos Anuncios / Noticias Cortas */}
          {latestNews && latestNews.length > 0 && (
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 className="serif-font" style={{ fontSize: '1.3rem' }}>Anuncios del Club</h3>
                <button 
                  onClick={() => setCurrentView('news')} 
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                >
                  Ver Todos
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {latestNews.slice(0, 2).map(item => (
                  <div 
                    key={item.id}
                    onClick={() => setCurrentView('news')}
                    style={{ 
                      padding: '1rem', 
                      borderRadius: 'var(--radius-sm)', 
                      background: 'rgba(255, 255, 255, 0.01)', 
                      border: '1px solid var(--border-glass)',
                      cursor: 'pointer',
                      transition: 'var(--transition-fast)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border-glass-hover)';
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border-glass)';
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.01)';
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--primary-gold)', fontWeight: '600', textTransform: 'uppercase' }}>
                        {item.category}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{item.date}</span>
                    </div>
                    <h4 className="serif-font" style={{ fontSize: '1.05rem', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                      {item.title}
                    </h4>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {item.excerpt}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
