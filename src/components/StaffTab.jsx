import { useState, useEffect } from 'react';
import { Clock, Plus, Search, ClipboardList, Activity, ToggleLeft, ToggleRight, Sparkles, Send, ShieldAlert, BadgeCheck } from 'lucide-react';

import StaffHrPanel from './admin/StaffHrPanel';

export default function StaffTab({ staffMembers, setStaffMembers, onOpenProfile, hrRecords = [], setHrRecords }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState('all');
  
  // Estado para el formulario de registrar actividad
  const [activeEmployeeId, setActiveEmployeeId] = useState(staffMembers[0]?.id || '');
  const [newActivityDesc, setNewActivityDesc] = useState('');
  const [newActivityTime, setNewActivityTime] = useState(new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }));
  const [formSuccess, setFormSuccess] = useState(false);

  const [showHireForm, setShowHireForm] = useState(false);
  const [hireForm, setHireForm] = useState({
    name: '',
    role: '',
    specialty: '',
    department: 'Operaciones',
    phone: '',
  });
  const [hireError, setHireError] = useState('');

  const handleHireEmployee = (e) => {
    e.preventDefault();
    setHireError('');
    if (!hireForm.name.trim() || !hireForm.role.trim()) {
      setHireError('Nombre y cargo son obligatorios.');
      return;
    }
    const initials = hireForm.name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || '')
      .join('');
    const employee = {
      id: `emp-${Date.now()}`,
      employeeNumber: `E-${String(staffMembers.length + 1).padStart(3, '0')}`,
      name: hireForm.name.trim(),
      role: hireForm.role.trim(),
      specialty: hireForm.specialty.trim() || hireForm.role.trim(),
      department: hireForm.department,
      phone: hireForm.phone.trim(),
      status: 'active',
      currentTask: 'Esperando asignación...',
      avatar: initials || 'EM',
      hireDate: new Date().toISOString().split('T')[0],
      contractType: 'Relación de dependencia',
      workShift: 'A definir',
      nationality: 'Argentina',
      activities: [
        {
          id: 1,
          time: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
          date: new Date().toISOString().split('T')[0],
          description: 'Alta de empleado en el registro institucional.',
        },
      ],
      attendance: [],
      documents: [],
    };
    setStaffMembers((prev) => [employee, ...prev]);
    setHireForm({ name: '', role: '', specialty: '', department: 'Operaciones', phone: '' });
    setShowHireForm(false);
  };

  // Estado para cambiar tarea actual de empleado
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [newTaskText, setNewTaskText] = useState('');

  // Sincronizar el ID del empleado activo del formulario si la lista cambia
  useEffect(() => {
    if (staffMembers.length > 0 && !activeEmployeeId) {
      setActiveEmployeeId(staffMembers[0].id);
    }
  }, [staffMembers, activeEmployeeId]);

  // Alternar el estado de guardia del empleado ("En Guardia" / "Fuera de Servicio")
  const toggleDutyStatus = (id) => {
    setStaffMembers(prev => prev.map(emp => {
      if (emp.id === id) {
        const nextStatus = emp.status === 'active' ? 'inactive' : 'active';
        const systemMessage = nextStatus === 'active' 
          ? 'Inició turno de guardia operativa.' 
          : 'Finalizó turno de guardia. Fuera de servicio.';
        
        // Agregar log automático de cambio de estado
        const newLog = {
          id: Date.now(),
          time: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
          date: new Date().toISOString().split('T')[0],
          description: systemMessage
        };

        return {
          ...emp,
          status: nextStatus,
          currentTask: nextStatus === 'active' ? 'Esperando asignación...' : 'Ninguna (Fuera de Servicio)',
          activities: [newLog, ...emp.activities]
        };
      }
      return emp;
    }));
  };

  // Guardar nueva actividad manual en la bitácora
  const handleAddActivity = (e) => {
    e.preventDefault();
    if (!newActivityDesc.trim() || !activeEmployeeId) return;

    setStaffMembers(prev => prev.map(emp => {
      if (emp.id === activeEmployeeId) {
        const newLog = {
          id: Date.now(),
          time: newActivityTime,
          date: new Date().toISOString().split('T')[0],
          description: newActivityDesc.trim()
        };
        return {
          ...emp,
          // Si estaba inactivo, lo pasa a activo porque está realizando una tarea
          status: 'active',
          currentTask: newActivityDesc.trim(),
          activities: [newLog, ...emp.activities]
        };
      }
      return emp;
    }));

    setNewActivityDesc('');
    setNewActivityTime(new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }));
    setFormSuccess(true);
    setTimeout(() => setFormSuccess(false), 2500);
  };

  // Iniciar edición de la tarea rápida
  const startEditingTask = (emp) => {
    setEditingTaskId(emp.id);
    setNewTaskText(emp.currentTask === 'Esperando asignación...' || emp.currentTask === 'Ninguna (Fuera de Servicio)' ? '' : emp.currentTask);
  };

  // Guardar tarea rápida
  const saveQuickTask = (id) => {
    if (!newTaskText.trim()) return;

    setStaffMembers(prev => prev.map(emp => {
      if (emp.id === id) {
        const newLog = {
          id: Date.now(),
          time: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
          date: new Date().toISOString().split('T')[0],
          description: `Se le asignó nueva tarea: "${newTaskText.trim()}".`
        };
        return {
          ...emp,
          status: 'active', // Al asignarle tarea, se asume activo
          currentTask: newTaskText.trim(),
          activities: [newLog, ...emp.activities]
        };
      }
      return emp;
    }));

    setEditingTaskId(null);
    setNewTaskText('');
  };

  // Filtrar empleados en base a búsqueda por nombre o rol
  const filteredStaff = staffMembers.filter(emp => {
    return emp.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
           emp.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
           emp.specialty.toLowerCase().includes(searchTerm.toLowerCase());
  });

  // Consolidar TODAS las actividades de TODOS los empleados en un solo feed cronológico
  const getGlobalActivities = () => {
    let globalList = [];
    staffMembers.forEach(emp => {
      emp.activities.forEach(act => {
        globalList.push({
          ...act,
          employeeName: emp.name,
          employeeRole: emp.role,
          employeeAvatar: emp.avatar,
          employeeId: emp.id
        });
      });
    });

    // Ordenar por fecha (descendente) y hora (descendente)
    return globalList.sort((a, b) => {
      const dateTimeA = `${a.date}T${a.time}`;
      const dateTimeB = `${b.date}T${b.time}`;
      return dateTimeB.localeCompare(dateTimeA);
    });
  };

  const allActivities = getGlobalActivities();
  const filteredActivities = selectedStaffId === 'all' 
    ? allActivities 
    : allActivities.filter(act => act.employeeId === selectedStaffId);

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <h4 className="serif-font" style={{ fontSize: '1.25rem', margin: 0 }}>Registro de Empleados</h4>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>Altas, bitácora y estado de guardia operativa.</p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowHireForm((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={14} /> Alta de empleado
        </button>
      </div>

      {showHireForm && (
        <form onSubmit={handleHireEmployee} className="glass-card" style={{ padding: '1rem', display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <div>
            <label className="form-label">Nombre completo</label>
            <input className="form-input" required value={hireForm.name} onChange={(e) => setHireForm({ ...hireForm, name: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Cargo</label>
            <input className="form-input" required value={hireForm.role} onChange={(e) => setHireForm({ ...hireForm, role: e.target.value })} placeholder="Greenkeeper / Cajero..." />
          </div>
          <div>
            <label className="form-label">Especialidad</label>
            <input className="form-input" value={hireForm.specialty} onChange={(e) => setHireForm({ ...hireForm, specialty: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Área</label>
            <select className="form-input" value={hireForm.department} onChange={(e) => setHireForm({ ...hireForm, department: e.target.value })}>
              <option>Operaciones</option>
              <option>Administración</option>
              <option>Hípica</option>
              <option>Deportes</option>
              <option>Gastronomía</option>
              <option>Seguridad</option>
            </select>
          </div>
          <div>
            <label className="form-label">Teléfono</label>
            <input className="form-input" value={hireForm.phone} onChange={(e) => setHireForm({ ...hireForm, phone: e.target.value })} placeholder="+549264..." />
          </div>
          {hireError && <p style={{ color: '#ef4444', gridColumn: '1 / -1', margin: 0 }}>{hireError}</p>}
          <div>
            <button type="submit" className="btn btn-primary btn-sm">Registrar empleado</button>
          </div>
        </form>
      )}

      <StaffHrPanel
        staffMembers={staffMembers}
        hrRecords={hrRecords}
        setHrRecords={setHrRecords}
      />
      
      {/* Sección Superior: Resumen de Estado */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1.5rem' }} className="responsive-staff-grid">
        <style>{`
          .responsive-staff-grid {
            display: grid;
          }
          @media (max-width: 992px) {
            .responsive-staff-grid {
              grid-template-columns: 1fr !important;
            }
          }
          .staff-card {
            background: rgba(255, 255, 255, 0.01);
            border: 1px solid var(--border-glass);
            border-radius: 12px;
            padding: 1.25rem;
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
            position: relative;
            transition: all 0.3s ease;
          }
          .staff-card:hover {
            border-color: var(--primary-gold);
            transform: translateY(-2px);
            background: rgba(255, 255, 255, 0.02);
            box-shadow: var(--shadow-premium);
          }
          .staff-card.active {
            border-left: 3px solid var(--emerald-accent);
          }
          .staff-card.inactive {
            border-left: 3px solid var(--text-muted);
            opacity: 0.75;
          }
          .activity-timeline {
            position: relative;
            padding-left: 1.5rem;
            border-left: 1px solid rgba(255, 255, 255, 0.05);
            display: flex;
            flex-direction: column;
            gap: 1.25rem;
          }
          .activity-item {
            position: relative;
          }
          .activity-item::before {
            content: '';
            position: absolute;
            left: -1.85rem;
            top: 0.25rem;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--primary-gold);
            border: 2px solid var(--bg-primary);
            box-shadow: 0 0 0 2px rgba(207, 161, 58, 0.15);
          }
          .activity-item.system::before {
            background: var(--text-muted);
            box-shadow: none;
          }
          .status-pulse-led {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            display: inline-block;
          }
          .status-pulse-led.active {
            background-color: var(--emerald-accent);
            box-shadow: 0 0 8px var(--emerald-accent);
            animation: pulse-green 2s infinite;
          }
          .status-pulse-led.inactive {
            background-color: #6b7280;
          }
          @keyframes pulse-green {
            0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
            70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
            100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
          }
        `}</style>
        
        {/* PANEL IZQUIERDO: DIRECTORIO DE PERSONAL */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <h3 className="serif-font" style={{ fontSize: '1.35rem', color: 'var(--text-primary)' }}>Personal de Operaciones Jockey Club</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Mantenimiento, Caballos, Cocina y Seguridad</p>
            </div>
            
            {/* Buscador de Personal */}
            <div style={{ position: 'relative', width: '100%', maxWidth: 280, minWidth: 0 }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Buscar personal..."
                className="form-input"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ padding: '0.4rem 0.5rem 0.4rem 2rem', fontSize: '0.8rem', width: '100%', borderRadius: '8px' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {filteredStaff.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem 1rem' }} className="glass-panel">
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No se encontraron empleados con ese criterio.</p>
              </div>
            ) : (
              filteredStaff.map(emp => {
                const isActive = emp.status === 'active';
                return (
                  <div key={emp.id} className={`staff-card ${isActive ? 'active' : 'inactive'}`}>
                    
                    {/* Header Tarjeta */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        <div className="member-avatar" style={{ 
                          width: '40px', 
                          height: '40px', 
                          fontSize: '0.95rem',
                          background: isActive ? 'rgba(207, 161, 58, 0.1)' : 'rgba(255,255,255,0.03)',
                          border: isActive ? '1px solid var(--primary-gold)' : '1px solid var(--border-glass)',
                          color: isActive ? 'var(--text-gold)' : 'var(--text-muted)'
                        }}>
                          {emp.avatar}
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <button
                              type="button"
                              onClick={() => onOpenProfile?.(emp.id)}
                              title="Ver legajo completo"
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                                textAlign: 'left',
                              }}
                            >
                              <strong style={{
                                color: 'var(--text-primary)',
                                fontSize: '0.95rem',
                                textDecoration: 'underline',
                                textDecorationColor: 'rgba(207,161,58,0.4)',
                                textUnderlineOffset: 3,
                              }}>
                                {emp.name}
                              </strong>
                            </button>
                            <span className={`status-pulse-led ${isActive ? 'active' : 'inactive'}`} title={isActive ? 'En Guardia' : 'Fuera de Turno'} />
                          </div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--primary-gold)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {emp.role}
                          </span>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                            {emp.employeeNumber || emp.id} · Ver legajo
                          </div>
                        </div>
                      </div>

                      {/* Botón de Guardia */}
                      <button
                        onClick={() => toggleDutyStatus(emp.id)}
                        style={{ 
                          background: 'none', 
                          border: 'none', 
                          color: isActive ? 'var(--emerald-accent)' : 'var(--text-muted)', 
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          fontSize: '0.75rem',
                          fontWeight: '600'
                        }}
                        title={isActive ? "Marcar Fuera de Servicio" : "Activar Guardia Operativa"}
                      >
                        {isActive ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                        <span style={{ fontSize: '0.7rem' }}>{isActive ? 'EN GUARDIA' : 'FUERA'}</span>
                      </button>
                    </div>

                    {/* Especialidad del Personal */}
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      <strong>Especialidad:</strong> {emp.specialty}
                    </div>

                    {/* Tarea Actual */}
                    <div style={{ 
                      background: 'rgba(255,255,255,0.02)', 
                      padding: '0.5rem 0.75rem', 
                      borderRadius: '6px', 
                      border: '1px solid var(--border-glass)',
                      fontSize: '0.85rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', width: '70%' }}>
                        <Activity size={12} style={{ color: isActive ? 'var(--emerald-accent)' : 'var(--text-muted)', flexShrink: 0 }} />
                        {editingTaskId === emp.id ? (
                          <input 
                            type="text" 
                            className="form-input" 
                            value={newTaskText}
                            onChange={(e) => setNewTaskText(e.target.value)}
                            placeholder="Escriba la nueva tarea..."
                            style={{ padding: '0.2rem 0.4rem', fontSize: '0.8rem', width: '100%', borderRadius: '4px' }}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveQuickTask(emp.id);
                              if (e.key === 'Escape') setEditingTaskId(null);
                            }}
                          />
                        ) : (
                          <span style={{ 
                            textOverflow: 'ellipsis', 
                            overflow: 'hidden', 
                            whiteSpace: 'nowrap',
                            color: isActive ? 'var(--text-primary)' : 'var(--text-muted)' 
                          }}>
                            {emp.currentTask}
                          </span>
                        )}
                      </div>

                      {editingTaskId === emp.id ? (
                        <div style={{ display: 'flex', gap: '0.25rem' }}>
                          <button 
                            onClick={() => saveQuickTask(emp.id)} 
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem', borderColor: 'var(--emerald-accent)', color: 'var(--emerald-accent)' }}
                          >
                            OK
                          </button>
                          <button 
                            onClick={() => setEditingTaskId(null)} 
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem' }}
                          >
                            X
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEditingTask(emp)}
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem', opacity: isActive ? 1 : 0.4 }}
                          disabled={!isActive}
                        >
                          Asignar Tarea
                        </button>
                      )}
                    </div>

                    {/* Última Actividad Realizada */}
                    {emp.activities.length > 0 && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <Clock size={10} />
                        <span>Último log ({emp.activities[0].time}): "{emp.activities[0].description}"</span>
                      </div>
                    )}

                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* PANEL DERECHO: FORMULARIO DE LOG OPERATIVO */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="glass-card" style={{ padding: '1.25rem', height: '100%', background: 'rgba(255, 255, 255, 0.01)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '1.25rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-gold)', marginBottom: '0.5rem' }}>
                <Sparkles size={16} />
                <h4 className="serif-font" style={{ fontSize: '1.15rem', margin: 0 }}>Log Manual de Trazabilidad</h4>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Genere un registro inmediato de actividades operativas en el club. Al cargar una actividad, el empleado pasará automáticamente a estado "En Guardia" con dicha actividad como su tarea en curso.
              </p>
            </div>

            {formSuccess ? (
              <div style={{ textAlign: 'center', padding: '1.5rem 0.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                <BadgeCheck size={36} style={{ color: 'var(--emerald-accent)' }} />
                <div>
                  <h5 style={{ fontSize: '0.95rem', color: 'var(--text-primary)', margin: 0 }}>Actividad Registrada</h5>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                    La bitácora de trazabilidad ha sido actualizada en tiempo real.
                  </p>
                </div>
              </div>
            ) : (
              <form onSubmit={handleAddActivity} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Empleado</label>
                  <select
                    className="form-input"
                    value={activeEmployeeId}
                    onChange={(e) => setActiveEmployeeId(e.target.value)}
                    style={{ padding: '0.5rem', fontSize: '0.85rem' }}
                    required
                  >
                    {staffMembers.map(emp => (
                      <option key={emp.id} value={emp.id} style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                        {emp.name} ({emp.role})
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: '0.5rem' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>Descripción de Tarea Realizada</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Ej: Finalizó corte de green en hoyo 9"
                      value={newActivityDesc}
                      onChange={(e) => setNewActivityDesc(e.target.value)}
                      style={{ padding: '0.5rem', fontSize: '0.85rem' }}
                      required
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>Hora</label>
                    <input
                      type="text"
                      className="form-input"
                      value={newActivityTime}
                      onChange={(e) => setNewActivityTime(e.target.value)}
                      style={{ padding: '0.5rem', fontSize: '0.85rem', textAlign: 'center' }}
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '0.55rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontSize: '0.85rem', marginTop: '0.5rem' }}
                >
                  <Send size={14} /> Registrar en Bitácora
                </button>
              </form>
            )}

            <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-glass)', padding: '0.75rem', borderRadius: '8px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', color: 'var(--text-gold)', fontWeight: '600', marginBottom: '0.2rem' }}>
                <ClipboardList size={12} />
                <span>Impacto en Portal de Socios</span>
              </div>
              El estado operativo se sincroniza con el panel de socios. Si un Greenkeeper realiza trabajos de campo, se refleja dinámicamente en el clima y aforo del club.
            </div>
          </div>
        </div>

      </div>

      {/* Sección Inferior: Bitácora de Trazabilidad Completa */}
      <div className="glass-card" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h4 className="serif-font" style={{ fontSize: '1.25rem', color: 'var(--text-primary)' }}>Bitácora de Trazabilidad Operativa (Audit Trail)</h4>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Seguimiento histórico de incidentes y mantenimiento del Jockey Club</p>
          </div>

          {/* Filtro por Empleado */}
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Filtrar por:</span>
            <select
              className="form-input"
              value={selectedStaffId}
              onChange={(e) => setSelectedStaffId(e.target.value)}
              style={{ padding: '0.35rem 0.5rem', fontSize: '0.8rem', borderRadius: '8px', width: '180px' }}
            >
              <option value="all" style={{ background: 'var(--bg-secondary)' }}>Todo el Personal</option>
              {staffMembers.map(emp => (
                <option key={emp.id} value={emp.id} style={{ background: 'var(--bg-secondary)' }}>
                  {emp.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Línea de Tiempo de Bitácora */}
        {filteredActivities.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 1rem' }} className="glass-panel">
            <ShieldAlert size={30} style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }} />
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No hay registros de actividades para este filtro.</p>
          </div>
        ) : (
          <div className="activity-timeline" style={{ paddingLeft: '2rem' }}>
            {filteredActivities.map((act) => {
              const isSystem = act.description.startsWith('Se le asignó') || act.description.includes('turno de guardia');
              return (
                <div key={`${act.employeeId}-${act.id}`} className={`activity-item ${isSystem ? 'system' : ''} fade-in`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                    
                    {/* Descripción y Empleado */}
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                      <div className="member-avatar" style={{ 
                        width: '28px', 
                        height: '28px', 
                        fontSize: '0.7rem', 
                        background: 'rgba(255,255,255,0.03)', 
                        border: '1px solid var(--border-glass)',
                        color: 'var(--text-primary)',
                        flexShrink: 0 
                      }}>
                        {act.employeeAvatar}
                      </div>
                      <div>
                        <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', margin: 0, fontWeight: '500' }}>
                          {act.description}
                        </p>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.15rem' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--primary-gold)', fontWeight: '600' }}>
                            {act.employeeName}
                          </span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            | {act.employeeRole}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Fecha y Hora */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      <strong style={{ color: 'var(--text-primary)' }}>{act.time} hs</strong>
                      <span>{act.date}</span>
                    </div>

                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
