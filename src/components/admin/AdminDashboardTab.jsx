import {
  Users, Calendar, DollarSign, Activity, MessageSquare, Phone, ClipboardList,
  CheckCircle2, UserPlus, BookOpen
} from 'lucide-react';

/**
 * Dashboard interno del panel operativo. Las tarjetas y accesos rápidos
 * se filtran según los tabs permitidos para el rol.
 */
export default function AdminDashboardTab({
  userRole,
  permittedTabs,
  goToTab,
  members,
  reservations,
  claims,
  totalMembers,
  paymentCollectionRate,
  totalActivos,
  totalIngresos,
  pendingClaimsCount,
  formatCurrency,
  getAccountBalance,
}) {
  return (
    <div className="fade-in">

      {/* Botonera Rápida Superior (solo accesos permitidos por rol) */}
      <div className="action-buttons-row">
        {[
          { tab: 'messaging', icon: <MessageSquare size={24} color="var(--primary-gold)" />, label: 'Nuevo Mensaje' },
          { tab: 'surveys', icon: <CheckCircle2 size={24} color="var(--primary-gold)" />, label: 'Nueva Encuesta' },
          { tab: 'reports', icon: <Activity size={24} color="var(--primary-gold)" />, label: 'Nuevo Reporte' },
          { tab: 'members', icon: <UserPlus size={24} color="var(--primary-gold)" />, label: 'Socios' },
          { tab: 'accounting', focus: 'cash', icon: <DollarSign size={24} color="var(--primary-gold)" />, label: 'Arqueo de Caja', roles: ['cashier'] },
          { tab: 'accounting', icon: <BookOpen size={24} color="var(--primary-gold)" />, label: 'Contabilidad' },
          { tab: 'bookings', icon: <Calendar size={24} color="var(--primary-gold)" />, label: 'Reservas' },
          { tab: 'claims', icon: <ClipboardList size={24} color="var(--primary-gold)" />, label: 'Reclamos' },
        ]
          .filter((action) => permittedTabs.includes(action.tab) && (!action.roles || action.roles.includes(userRole)))
          .slice(0, 4)
          .map((action) => (
            <div key={`${action.tab}-${action.label}`} className="btn" onClick={() => goToTab(action.tab, action.focus || null)}>
              {action.icon}
              <span style={{ fontSize: '0.85rem' }}>{action.label}</span>
            </div>
          ))}
      </div>

      {/* Grilla Principal */}
      <div className="admin-dashboard-grid">

        {/* TARJETA 1: COMUNICACIONES (requiere acceso a mensajería) */}
        {permittedTabs.includes('messaging') && (
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-glass)' }}>
            <MessageSquare size={16} color="var(--primary-gold)" />
            <h3 style={{ fontSize: '1rem', fontWeight: '600' }}>Comunicaciones</h3>
          </div>

          <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
            <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>5 Mensajes</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '2rem', position: 'relative' }}>
            <div className="donut-chart">
               <div className="donut-hole"></div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div style={{ width: 12, height: 12, background: '#ef4444', borderRadius: 2 }}></div> 0 No respondida</div>
              <span style={{ color: 'var(--text-muted)' }}>0.00 %</span>
              <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', borderRadius: 4 }}>Ver {'>'}</button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div style={{ width: 12, height: 12, background: '#eab308', borderRadius: 2 }}></div> 0 No leída</div>
              <span style={{ color: 'var(--text-muted)' }}>0.00 %</span>
              <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', borderRadius: 4 }}>Ver {'>'}</button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div style={{ width: 12, height: 12, background: 'var(--emerald-accent)', borderRadius: 2 }}></div> 5 En progreso</div>
              <span style={{ color: 'var(--text-muted)' }}>100.00 %</span>
              <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', borderRadius: 4 }}>Ver {'>'}</button>
            </div>
          </div>

          <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--primary-gold)', cursor: 'pointer' }} onClick={() => goToTab('messaging')}>Ver todas las comunicaciones &gt;</span>
          </div>
        </div>
        )}

        {/* TARJETA OPERATIVA: TRABAJO DEL DÍA (roles sin acceso contable, ej. Personal) */}
        {!permittedTabs.includes('accounting') && (
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-glass)' }}>
            <ClipboardList size={16} color="var(--primary-gold)" />
            <h3 style={{ fontSize: '1rem', fontWeight: '600' }}>Trabajo del Día</h3>
          </div>

          <div>
            <div style={{ fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>Reclamos abiertos ({pendingClaimsCount})</div>
            {pendingClaimsCount === 0 ? (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Sin reclamos pendientes de resolución.</p>
            ) : (
              claims.filter(c => c.status !== 'resolved').slice(0, 3).map(clm => (
                <div key={clm.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.82rem', padding: '0.5rem 0', borderBottom: '1px solid var(--border-glass)' }}>
                  <span style={{ color: 'var(--text-primary)' }}>{clm.title}</span>
                  <span style={{ color: clm.status === 'pending' ? '#f59e0b' : '#818cf8', flexShrink: 0 }}>
                    {clm.status === 'pending' ? 'Pendiente' : 'En proceso'}
                  </span>
                </div>
              ))
            )}
            {permittedTabs.includes('claims') && (
              <div style={{ textAlign: 'right', marginTop: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--primary-gold)', cursor: 'pointer' }} onClick={() => goToTab('claims')}>Gestionar reclamos &gt;</span>
              </div>
            )}
          </div>

          <div>
            <div style={{ fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>Próximas reservas confirmadas</div>
            {reservations.filter(r => r.status === 'confirmed').length === 0 ? (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Sin reservas confirmadas en agenda.</p>
            ) : (
              reservations.filter(r => r.status === 'confirmed').slice(0, 3).map(res => (
                <div key={res.id} style={{ fontSize: '0.82rem', padding: '0.5rem 0', borderBottom: '1px solid var(--border-glass)' }}>
                  <div style={{ color: 'var(--text-primary)', fontWeight: '600' }}>{res.facilityName}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{res.date} · {res.time} hs · {res.memberName}</div>
                </div>
              ))
            )}
            {permittedTabs.includes('bookings') && (
              <div style={{ textAlign: 'right', marginTop: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--primary-gold)', cursor: 'pointer' }} onClick={() => goToTab('bookings')}>Ver agenda completa &gt;</span>
              </div>
            )}
          </div>
        </div>
        )}

        {/* TARJETA 2: CONTABILIDAD (requiere acceso contable) */}
        {permittedTabs.includes('accounting') && (
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-glass)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <BookOpen size={16} color="var(--primary-gold)" />
              <h3 style={{ fontSize: '1rem', fontWeight: '600' }}>Contabilidad</h3>
            </div>
            <span style={{ fontSize: '0.8rem', color: 'var(--primary-gold)' }}>Mayo del 2026 ▾</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '1.5rem' }}>
            <div style={{ width: 90, height: 90, borderRadius: '50%', border: '6px solid var(--border-glass)', borderTopColor: 'var(--emerald-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', fontWeight: 'bold' }}>
              {paymentCollectionRate}%
            </div>
            <div>
              <div style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>{formatCurrency(totalActivos)}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Liquidado en Mayo 2026</div>

              <div style={{ fontSize: '1rem', fontWeight: 'bold', marginTop: '0.5rem' }}>{formatCurrency(getAccountBalance('Cuotas Sociales') + getAccountBalance('Caja General') + getAccountBalance('Banco Nación'))}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--emerald-accent)' }}>Recaudado en Mayo 2026</div>
            </div>
          </div>

          <div style={{ background: 'var(--emerald-accent)', borderRadius: '8px', padding: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#000', cursor: 'pointer', transition: 'transform 0.2s' }} className="hover-scale" onClick={() => goToTab('accounting')}>
            <div style={{ background: 'rgba(255,255,255,0.3)', padding: '0.5rem', borderRadius: '8px' }}>
              <DollarSign size={24} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>{formatCurrency(getAccountBalance('Caja General') + getAccountBalance('Caja Cantina') + getAccountBalance('Banco Nación'))}</div>
              <div style={{ fontSize: '0.75rem' }}>Total en caja al día de hoy</div>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.1)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem' }}>
              Ver &gt;
            </div>
          </div>

          <div style={{ marginTop: '1.5rem' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '1rem' }}>Últimos ingresos al día de hoy</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '0.5rem 0', borderBottom: '1px solid var(--border-glass)' }}>
              <span style={{ color: 'var(--text-muted)' }}>14 (Trx Diarias)</span>
              <span>{formatCurrency(totalIngresos)}</span>
            </div>
          </div>

          <div style={{ textAlign: 'right', marginTop: '1rem', marginBottom: '1rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--primary-gold)', cursor: 'pointer' }} onClick={() => goToTab('members')}>Ver todas las deudas &gt;</span>
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginTop: 'auto' }}>
            {permittedTabs.includes('members') && (
              <button className="btn" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', background: 'transparent', border: '1px solid var(--border-glass)' }} onClick={() => goToTab('members')}>+ Socios</button>
            )}
            <button className="btn" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', background: 'transparent', border: '1px solid var(--border-glass)' }} onClick={() => goToTab('accounting')}>+ Proveedores</button>
          </div>
        </div>
        )}

        {/* COLUMNA 3: SOCIOS Y NOTIFICACIONES (requiere gestión de socios) */}
        {permittedTabs.includes('members') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* Tarjeta de Compartir Código */}
          <div className="glass-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <Users size={16} color="var(--primary-gold)" />
              <h3 style={{ fontSize: '1rem', fontWeight: '600' }}>Socios</h3>
            </div>
            <p style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>¡Comparte el código de tu club!</p>
            <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '0.75rem 1rem', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#fca5a5', fontWeight: 'bold', letterSpacing: '2px' }}>JCSJ2026</span>
              <div style={{ display: 'flex', gap: '0.5rem', color: '#fca5a5' }}>
                <Phone size={16} style={{ cursor: 'pointer' }} />
                <ClipboardList size={16} style={{ cursor: 'pointer' }} />
              </div>
            </div>
          </div>

          {/* Resumen Padron */}
          <div style={{ background: 'rgba(139, 92, 246, 0.5)', borderRadius: '8px', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => goToTab('members')}>
            <div style={{ border: '1px solid rgba(255,255,255,0.5)', padding: '0.5rem', borderRadius: '8px' }}>
              <Users size={20} color="white" />
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'white' }}>{totalMembers}</span>
              <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.8)', marginLeft: '0.5rem' }}>Socios activos</span>
            </div>
          </div>

          <div style={{ background: 'rgba(99, 102, 241, 0.5)', borderRadius: '8px', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => goToTab('members')}>
            <div style={{ border: '1px solid rgba(255,255,255,0.5)', padding: '0.5rem', borderRadius: '8px' }}>
              <Activity size={20} color="white" />
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'white' }}>{members.filter(m => m.outstandingBalance === 0).length}</span>
              <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.8)', marginLeft: '0.5rem' }}>Socios al día</span>
            </div>
          </div>

          {/* Tarjetas de Pendientes */}
          <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ background: 'rgba(255,255,255,0.1)', padding: '0.5rem', borderRadius: '8px' }}>
                <UserPlus size={16} />
              </div>
              <span style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>0 Solicitudes de socios</span>
            </div>
            <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', borderRadius: 4 }}>Ver {'>'}</button>
          </div>

          <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ background: 'rgba(255,255,255,0.1)', padding: '0.5rem', borderRadius: '8px' }}>
                <Users size={16} />
              </div>
              <span style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>0 Adherentes pendientes</span>
            </div>
            <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', borderRadius: 4 }}>Ver {'>'}</button>
          </div>

        </div>
        )}
      </div>
    </div>
  );
}
