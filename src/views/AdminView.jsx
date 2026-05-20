import React, { useState } from 'react';
import { Users, Calendar, DollarSign, Activity, CreditCard, Check, X, ShieldAlert, Plus, Search, Filter } from 'lucide-react';

export default function AdminView({ 
  members, 
  reservations, 
  setMembers, 
  setReservations, 
  latestNews 
}) {
  const [activeTab, setActiveTab] = useState('members');
  const [tierFilter, setTierFilter] = useState('todos');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Estado para crear un nuevo socio
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTier, setNewTier] = useState('gold');

  // Calcular métricas
  const totalMembers = members.length;
  const activeBookingsCount = reservations.filter(res => res.status === 'confirmed').length;
  const pendingBookingsCount = reservations.filter(res => res.status === 'pending').length;
  
  // Porcentaje de cuotas pagadas (socios con saldo = 0)
  const paidMembers = members.filter(m => m.outstandingBalance === 0).length;
  const paymentCollectionRate = totalMembers > 0 ? Math.round((paidMembers / totalMembers) * 100) : 0;
  
  // Total de ingresos pendientes
  const totalOutstanding = members.reduce((sum, m) => sum + m.outstandingBalance, 0);

  // Formatear dinero
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(amount);
  };

  // Crear nuevo socio de prueba
  const handleAddMember = (e) => {
    e.preventDefault();
    if (!newName) return;

    // Generar ID único
    const randomNum = Math.floor(1000000000000000 + Math.random() * 9000000000000000);
    const newMember = {
      name: newName,
      memberId: randomNum.toString(),
      tier: newTier,
      outstandingBalance: 32000, // Comienza con deuda del mes en curso
      yearsActive: 1,
      status: 'active'
    };

    setMembers([newMember, ...members]);
    setNewName('');
    setShowAddForm(false);
  };

  // Cobrar cuota simulada de socio
  const handleCollectDues = (memberId) => {
    setMembers(members.map(m => {
      if (m.memberId === memberId) {
        return { ...m, outstandingBalance: 0 };
      }
      return m;
    }));
  };

  // Generar cuota/deuda simulada de socio (para prueba)
  const handleGenerateDues = (memberId) => {
    setMembers(members.map(m => {
      if (m.memberId === memberId) {
        return { ...m, outstandingBalance: m.outstandingBalance + 25000 };
      }
      return m;
    }));
  };

  // Gestionar estado de reserva (Aprobar/Cancelar)
  const handleUpdateReservationStatus = (resId, newStatus) => {
    setReservations(reservations.map(res => {
      if (res.id === resId) {
        return { ...res, status: newStatus };
      }
      return res;
    }));
  };

  // Filtrar socios por búsqueda y por nivel
  const filteredMembers = members.filter(m => {
    const matchesSearch = m.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          m.memberId.includes(searchQuery);
    const matchesTier = tierFilter === 'todos' || m.tier.toLowerCase() === tierFilter.toLowerCase();
    return matchesSearch && matchesTier;
  });

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Panel de Operaciones</h1>
          <p className="page-subtitle">Gestión interna, control de reservas deportivas e indicadores contables</p>
        </div>
      </div>

      {/* Tarjetas de Métricas de Administración */}
      <div className="admin-metrics">
        <div className="glass-card stat-widget">
          <div className="stat-icon" style={{ background: 'rgba(207, 161, 58, 0.1)', color: 'var(--primary-gold)' }}>
            <Users size={20} />
          </div>
          <div className="stat-info">
            <h4>Socios Registrados</h4>
            <div className="stat-value">{totalMembers}</div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Membresías activas en el sistema</p>
          </div>
        </div>

        <div className="glass-card stat-widget">
          <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--emerald-accent)' }}>
            <Calendar size={20} />
          </div>
          <div className="stat-info">
            <h4>Reservas Activas</h4>
            <div className="stat-value">{activeBookingsCount}</div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {pendingBookingsCount} reservas pendientes de revisión
            </p>
          </div>
        </div>

        <div className="glass-card stat-widget">
          <div className="stat-icon" style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}>
            <DollarSign size={20} />
          </div>
          <div className="stat-info">
            <h4>Recaudación Cuotas</h4>
            <div className="stat-value">{paymentCollectionRate}%</div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Deuda global: {formatCurrency(totalOutstanding)}
            </p>
          </div>
        </div>

        <div className="glass-card stat-widget">
          <div className="stat-icon" style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger-accent)' }}>
            <Activity size={20} />
          </div>
          <div className="stat-info">
            <h4>Aforo Canchas</h4>
            <div className="stat-value">Estable</div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Capacidad del club operando al 60%</p>
          </div>
        </div>
      </div>

      {/* Control de Pestañas (Socios / Reservas) */}
      <div className="glass-panel" style={{ padding: '0.5rem', display: 'flex', gap: '0.5rem', marginBottom: '2rem', borderRadius: '12px' }}>
        <button
          onClick={() => setActiveTab('members')}
          className="btn"
          style={{
            flex: 1,
            background: activeTab === 'members' ? 'var(--primary-gold)' : 'transparent',
            color: activeTab === 'members' ? '#060e0a' : 'var(--text-primary)',
            borderRadius: '8px',
            padding: '0.6rem 1rem',
            fontSize: '0.95rem'
          }}
        >
          <Users size={16} /> Gestión de Socios ({filteredMembers.length})
        </button>
        <button
          onClick={() => setActiveTab('bookings')}
          className="btn"
          style={{
            flex: 1,
            background: activeTab === 'bookings' ? 'var(--primary-gold)' : 'transparent',
            color: activeTab === 'bookings' ? '#060e0a' : 'var(--text-primary)',
            borderRadius: '8px',
            padding: '0.6rem 1rem',
            fontSize: '0.95rem'
          }}
        >
          <Calendar size={16} /> Control de Reservas ({reservations.length})
        </button>
      </div>

      {/* VISTA TABA 1: GESTIÓN DE SOCIOS */}
      {activeTab === 'members' && (
        <div className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Barra de Filtros e Ingreso */}
          <div className="admin-filters" style={{ width: '100%' }}>
            
            {/* Buscador */}
            <div style={{ position: 'relative', minWidth: '260px', flex: 1 }}>
              <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Buscar socio por nombre o credencial..."
                className="form-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ paddingLeft: '2.5rem', width: '100%' }}
              />
            </div>

            {/* Filtros por Nivel de Membresía */}
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <Filter size={16} style={{ color: 'var(--text-muted)' }} />
              <div className="filter-group">
                {['todos', 'royal', 'platinum', 'gold'].map(tier => (
                  <button
                    key={tier}
                    onClick={() => setTierFilter(tier)}
                    className={`filter-btn ${tierFilter === tier ? 'active' : ''}`}
                    style={{ textTransform: 'capitalize' }}
                  >
                    {tier}
                  </button>
                ))}
              </div>
            </div>

            {/* Botón de Alta Socio */}
            <button 
              onClick={() => setShowAddForm(!showAddForm)}
              className="btn btn-primary"
              style={{ padding: '0.5rem 1.25rem', fontSize: '0.85rem' }}
            >
              <Plus size={16} /> Registrar Socio
            </button>
          </div>

          {/* Formulario Ocultable para Agregar Socio */}
          {showAddForm && (
            <form onSubmit={handleAddMember} className="glass-panel fade-in" style={{ padding: '1.5rem', background: 'rgba(255, 255, 255, 0.01)', borderStyle: 'dashed', borderRadius: '12px' }}>
              <h4 className="serif-font" style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--text-gold)' }}>Formulario de Alta Directa</h4>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px 140px', gap: '1rem', alignItems: 'end' }} className="responsive-form-grid">
                <style>{`
                  @media (max-width: 768px) {
                    .responsive-form-grid { grid-template-columns: 1fr !important; }
                  }
                `}</style>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Nombre Completo del Socio</label>
                  <input
                    type="text"
                    placeholder="Ej: Marcelo T. de Alvear"
                    className="form-input"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Categoría Club</label>
                  <select
                    className="form-input"
                    value={newTier}
                    onChange={(e) => setNewTier(e.target.value)}
                    style={{ padding: '0.7rem' }}
                  >
                    <option value="gold" style={{ background: 'var(--bg-secondary)' }}>Gold (Estándar)</option>
                    <option value="platinum" style={{ background: 'var(--bg-secondary)' }}>Platinum (V.I.P.)</option>
                    <option value="royal" style={{ background: 'var(--bg-secondary)' }}>Royal (Exclusivo)</option>
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '0.65rem' }}>
                    Guardar
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setShowAddForm(false)} 
                    className="btn btn-secondary"
                    style={{ padding: '0.65rem' }}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Tabla de Socios */}
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Socio Titular</th>
                  <th>Credencial ID</th>
                  <th>Categoría</th>
                  <th>Antigüedad</th>
                  <th>Cuota / Saldo</th>
                  <th style={{ textAlign: 'right' }}>Acciones Administrativas</th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map(m => (
                  <tr key={m.memberId}>
                    <td>
                      <div className="member-profile-cell">
                        <div className="member-avatar">
                          {m.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                        </div>
                        <div>
                          <strong style={{ color: 'var(--text-primary)', fontSize: '0.95rem' }}>{m.name}</strong>
                          <div style={{ fontSize: '0.75rem', color: m.status === 'active' ? 'var(--emerald-accent)' : 'var(--text-muted)' }}>
                            {m.status === 'active' ? '● Cuenta Habilitada' : '○ Cuenta Suspendida'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      {m.memberId.replace(/(\d{4})/g, '$1 ').trim()}
                    </td>
                    <td>
                      <span className={`badge-tier ${m.tier.toLowerCase()}`}>
                        {m.tier}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                      {m.yearsActive} {m.yearsActive === 1 ? 'año' : 'años'}
                    </td>
                    <td>
                      <span style={{ 
                        fontWeight: '600',
                        color: m.outstandingBalance > 0 ? 'var(--warning-accent)' : 'var(--emerald-accent)'
                      }}>
                        {m.outstandingBalance > 0 ? formatCurrency(m.outstandingBalance) : 'Al Día'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                        {m.outstandingBalance > 0 && (
                          <button
                            onClick={() => handleCollectDues(m.memberId)}
                            className="btn btn-secondary btn-sm"
                            style={{ 
                              borderColor: 'var(--emerald-accent)', 
                              color: 'var(--emerald-accent)',
                              background: 'rgba(16, 185, 129, 0.03)',
                              padding: '0.35rem 0.75rem' 
                            }}
                            title="Cobrar Cuota Pendiente"
                          >
                            <Check size={14} /> Cobrar
                          </button>
                        )}
                        <button
                          onClick={() => handleGenerateDues(m.memberId)}
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                          title="Generar Deuda de Prueba"
                        >
                          Generar Deuda
                        </button>
                        <button
                          onClick={() => {
                            setMembers(members.map(item => {
                              if (item.memberId === m.memberId) {
                                return { ...item, status: item.status === 'active' ? 'suspended' : 'active' };
                              }
                              return item;
                            }));
                          }}
                          className="btn btn-danger btn-sm"
                          style={{ 
                            padding: '0.35rem 0.75rem', 
                            fontSize: '0.8rem',
                            background: m.status === 'active' ? 'rgba(239, 68, 68, 0.05)' : 'rgba(16, 185, 129, 0.05)',
                            borderColor: m.status === 'active' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                            color: m.status === 'active' ? 'var(--danger-accent)' : 'var(--emerald-accent)'
                          }}
                        >
                          {m.status === 'active' ? 'Suspender' : 'Habilitar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VISTA TABA 2: CONTROL DE RESERVAS */}
      {activeTab === 'bookings' && (
        <div className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <h3 className="serif-font" style={{ fontSize: '1.4rem' }}>Libro de Reservas Activo</h3>
          
          {reservations.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
              <ShieldAlert size={40} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
              <h4 className="serif-font" style={{ fontSize: '1.2rem' }}>No hay registros de reservas en el sistema</h4>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Las reservas cargadas por los socios aparecerán en esta sección.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Socio</th>
                    <th>Instalación</th>
                    <th>Fecha Reservada</th>
                    <th>Horario hs</th>
                    <th>Acompañantes</th>
                    <th>Estado de Turno</th>
                    <th style={{ textAlign: 'right' }}>Gestión de Turno</th>
                  </tr>
                </thead>
                <tbody>
                  {reservations.map(res => (
                    <tr key={res.id}>
                      <td>
                        <strong>{res.memberName}</strong>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ID: {res.memberId.slice(0, 8)}...</div>
                      </td>
                      <td>
                        <span style={{ color: 'var(--text-gold)', fontWeight: '600' }}>{res.facilityName}</span>
                      </td>
                      <td>{res.date}</td>
                      <td>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontWeight: '500' }}>
                          <Clock size={12} /> {res.time}
                        </span>
                      </td>
                      <td>
                        {res.guests > 0 ? (
                          <span title={res.guestNames} style={{ cursor: 'help', textDecoration: 'underline dotted var(--text-muted)' }}>
                            {res.guests} ({res.guestNames || 'Sin registrar'})
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>Solo</span>
                        )}
                      </td>
                      <td>
                        <span className={`status-tag ${res.status}`}>
                          {res.status === 'confirmed' ? 'Confirmado' : res.status === 'pending' ? 'Pendiente' : 'Cancelado'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                          {res.status === 'pending' && (
                            <button
                              onClick={() => handleUpdateReservationStatus(res.id, 'confirmed')}
                              className="btn btn-secondary btn-sm"
                              style={{ 
                                borderColor: 'var(--emerald-accent)', 
                                color: 'var(--emerald-accent)', 
                                background: 'rgba(16, 185, 129, 0.05)',
                                padding: '0.35rem 0.75rem'
                              }}
                            >
                              Aprobar
                            </button>
                          )}
                          {res.status !== 'cancelled' && (
                            <button
                              onClick={() => handleUpdateReservationStatus(res.id, 'cancelled')}
                              className="btn btn-danger btn-sm"
                              style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                            >
                              Anular
                            </button>
                          )}
                          {res.status === 'cancelled' && (
                            <button
                              onClick={() => handleUpdateReservationStatus(res.id, 'confirmed')}
                              className="btn btn-secondary btn-sm"
                              style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                            >
                              Reestablecer
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
