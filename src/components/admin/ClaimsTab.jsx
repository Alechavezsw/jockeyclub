import { useState } from 'react';

/** Buzón de pedidos y reclamos de socios, con asignación al personal de guardia. */
export default function ClaimsTab({ claims, setClaims, staffMembers, setStaffMembers }) {
  const [editingClaimId, setEditingClaimId] = useState(null);
  const [claimResponseText, setClaimResponseText] = useState('');
  const [claimAssignStaff, setClaimAssignStaff] = useState('');

  // Al asignar personal, registra la actividad en la bitácora del empleado
  const handleAssignAndResolveClaim = (claimId, newStatus) => {
    const claim = claims.find(c => c.id === claimId);
    if (!claim) return;

    const assignedEmpName = claimAssignStaff || claim.assignedStaff;
    const response = claimResponseText.trim() || claim.response;

    if (assignedEmpName && assignedEmpName !== claim.assignedStaff) {
      const targetEmp = staffMembers.find(s => s.name === assignedEmpName);
      if (targetEmp) {
        const newActivity = {
          id: Date.now(),
          time: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
          date: new Date().toISOString().split('T')[0],
          description: `Asignación de reclamo #${claim.id}: "${claim.title}" por Administración.`
        };

        setStaffMembers(staffMembers.map(s => {
          if (s.id === targetEmp.id) {
            return {
              ...s,
              currentTask: `Atendiendo: ${claim.title.slice(0, 30)}...`,
              activities: [newActivity, ...(s.activities || [])]
            };
          }
          return s;
        }));
      }
    }

    setClaims(claims.map(c => {
      if (c.id === claimId) {
        return {
          ...c,
          status: newStatus,
          assignedStaff: assignedEmpName,
          response: response
        };
      }
      return c;
    }));

    setEditingClaimId(null);
    setClaimResponseText('');
    setClaimAssignStaff('');
  };

  return (
    <div className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <h3 className="serif-font" style={{ fontSize: '1.4rem', margin: 0 }}>Buzón Ejecutivo de Pedidos, Solicitudes y Reclamos</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
          Gestione y asigne las solicitudes enviadas por los socios al personal técnico o guardas de área.
        </p>
      </div>

      {claims.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '3rem 1.5rem' }}>
          No existen solicitudes registradas de los socios de momento.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {claims.map(clm => (
            <div
              key={clm.id}
              className="glass-panel"
              style={{
                padding: '1.25rem',
                background: 'rgba(255,255,255,0.01)',
                borderColor: editingClaimId === clm.id ? 'var(--primary-gold)' : 'var(--border-glass)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.6rem'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className={`badge-tier ${clm.type === 'Mantenimiento' ? 'gold' : clm.type === 'Gourmet' ? 'royal' : 'platinum'}`} style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}>
                    {clm.type}
                  </span>
                  <strong style={{ fontSize: '1rem', color: 'var(--text-strong)' }}>{clm.title}</strong>
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Enviado: {clm.date}</span>
              </div>

              <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                <strong>Socio:</strong> {clm.memberName} (ID: {clm.memberId.slice(0, 8)}...)
              </p>

              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic', background: 'rgba(0,0,0,0.1)', padding: '0.5rem', borderRadius: '4px' }}>
                "{clm.description}"
              </p>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '0.6rem', fontSize: '0.82rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span>
                    <strong>Estado:</strong>{' '}
                    <span style={{
                      color: clm.status === 'pending' ? 'var(--warning-accent)' : clm.status === 'in_progress' ? '#3b82f6' : 'var(--emerald-accent)',
                      fontWeight: '600'
                    }}>
                      {clm.status === 'pending' ? 'Pendiente' : clm.status === 'in_progress' ? 'En Proceso' : 'Resuelto'}
                    </span>
                  </span>

                  <span>
                    <strong>Asignado a:</strong>{' '}
                    <span style={{ color: 'var(--text-gold)' }}>
                      {clm.assignedStaff || 'Nadie de Guardia'}
                    </span>
                  </span>
                </div>

                {editingClaimId !== clm.id ? (
                  <button
                    onClick={() => {
                      setEditingClaimId(clm.id);
                      setClaimResponseText(clm.response || '');
                      setClaimAssignStaff(clm.assignedStaff || '');
                    }}
                    className="btn btn-secondary btn-sm"
                    style={{ padding: '0.25rem 0.65rem' }}
                  >
                    Gestionar / Responder
                  </button>
                ) : (
                  <button
                    onClick={() => setEditingClaimId(null)}
                    className="btn btn-danger btn-sm"
                    style={{ padding: '0.25rem 0.65rem' }}
                  >
                    Cancelar
                  </button>
                )}
              </div>

              {/* Bloque de Edición / Asignación */}
              {editingClaimId === clm.id && (
                <div className="glass-panel fade-in" style={{ padding: '1rem', background: 'rgba(0,0,0,0.15)', marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1rem' }} className="responsive-form-grid">
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.72rem' }}>Asignar Tarea a Empleado de Guardia</label>
                      <select
                        className="form-input"
                        style={{ padding: '0.45rem', fontSize: '0.8rem' }}
                        value={claimAssignStaff}
                        onChange={(e) => setClaimAssignStaff(e.target.value)}
                      >
                        <option value="">-- No asignar a nadie --</option>
                        {staffMembers.map(emp => (
                          <option key={emp.id} value={emp.name} style={{ background: 'var(--bg-secondary)' }}>
                            {emp.name} ({emp.role} - {emp.status === 'active' ? 'EN GUARDIA' : 'Fuera de Servicio'})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.72rem' }}>Respuesta Oficial del Club</label>
                      <input
                        type="text"
                        className="form-input"
                        style={{ padding: '0.45rem', fontSize: '0.8rem' }}
                        placeholder="Ej: Se ha derivado al Greenkeeper para soldar la contención."
                        value={claimResponseText}
                        onChange={(e) => setClaimResponseText(e.target.value)}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                    <button
                      onClick={() => handleAssignAndResolveClaim(clm.id, 'in_progress')}
                      className="btn btn-secondary btn-sm"
                      style={{ fontSize: '0.75rem', borderColor: '#3b82f6', color: '#3b82f6' }}
                    >
                      Marcar "En Proceso"
                    </button>
                    <button
                      onClick={() => handleAssignAndResolveClaim(clm.id, 'resolved')}
                      className="btn btn-primary btn-sm"
                      style={{ fontSize: '0.75rem', background: 'var(--emerald-accent)', color: '#060e0a' }}
                    >
                      Resolver e Informar
                    </button>
                  </div>
                </div>
              )}

              {clm.response && (
                <div style={{ fontSize: '0.8rem', background: 'rgba(16, 185, 129, 0.04)', border: '1px solid rgba(16, 185, 129, 0.1)', padding: '0.5rem 0.75rem', borderRadius: '4px', marginTop: '0.2rem' }}>
                  <strong style={{ color: 'var(--emerald-accent)' }}>Respuesta del Club:</strong> "{clm.response}"
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
