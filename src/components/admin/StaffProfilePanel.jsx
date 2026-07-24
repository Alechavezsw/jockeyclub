import { useMemo, useState } from 'react';
import {
  ArrowLeft, Briefcase, ClipboardList, Activity, FileText,
  Phone, Mail, MapPin, IdCard, CalendarDays, BellRing,
} from 'lucide-react';
import { formatShortDate } from '../../domain/members/dues';
import { HR_RECORD_TYPES, HR_STATUS, filterHrByEmployee } from '../../domain/staff/hr';

const SECTIONS = [
  { id: 'legajo', label: 'Legajo', icon: IdCard },
  { id: 'laboral', label: 'Laboral', icon: Briefcase },
  { id: 'bitacora', label: 'Bitácora', icon: ClipboardList },
  { id: 'asistencia', label: 'Asistencia', icon: CalendarDays },
  { id: 'rrhh', label: 'RR.HH.', icon: BellRing },
  { id: 'docs', label: 'Documentación', icon: FileText },
  { id: 'trazabilidad', label: 'Trazabilidad', icon: Activity },
];

function Field({ label, value }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: '0.68rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)', wordBreak: 'break-word' }}>
        {value || '—'}
      </div>
    </div>
  );
}

function Empty({ text }) {
  return (
    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
      {text}
    </p>
  );
}

/** Perfil / legajo completo de un operario del club. */
export default function StaffProfilePanel({ employee, onBack, hrRecords = [] }) {
  const [section, setSection] = useState('legajo');

  const activities = useMemo(() => {
    if (!employee) return [];
    return [...(employee.activities || [])].sort((a, b) =>
      `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`)
    );
  }, [employee]);

  const attendance = useMemo(() => {
    if (!employee) return [];
    return (employee.attendance || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [employee]);

  const documents = useMemo(() => employee?.documents || [], [employee]);

  const employeeHr = useMemo(() => {
    if (!employee) return [];
    return filterHrByEmployee(hrRecords, employee.id)
      .filter((r) => r.employeeId === employee.id)
      .slice()
      .sort((a, b) => `${b.date}${b.time || ''}`.localeCompare(`${a.date}${a.time || ''}`));
  }, [hrRecords, employee]);

  const timeline = useMemo(() => {
    if (!employee) return [];
    const items = [];
    if (employee.hireDate) {
      items.push({
        when: formatShortDate(employee.hireDate),
        title: 'Ingreso al club',
        detail: `${employee.role} · Legajo ${employee.employeeNumber || employee.id}`,
        sort: employee.hireDate,
      });
    }
    activities.forEach((a) => {
      items.push({
        when: `${formatShortDate(a.date)} ${a.time || ''}`.trim(),
        title: a.description,
        detail: 'Bitácora operativa',
        sort: `${a.date}T${a.time || '00:00'}`,
      });
    });
    attendance.forEach((a) => {
      items.push({
        when: formatShortDate(a.date),
        title: `Asistencia · ${a.status === 'present' ? 'Presente' : a.status === 'absent' ? 'Ausente' : a.status}`,
        detail: [a.checkIn, a.checkOut].filter(Boolean).join(' → ') || a.notes,
        sort: a.date,
      });
    });
    documents.forEach((d) => {
      items.push({
        when: formatShortDate(d.date),
        title: `Documento · ${d.name}`,
        detail: d.status || d.type,
        sort: d.date || '1970-01-01',
      });
    });
    employeeHr.forEach((r) => {
      items.push({
        when: formatShortDate(r.date),
        title: `${HR_RECORD_TYPES[r.type]?.label || 'RR.HH.'} · ${r.title}`,
        detail: HR_STATUS[r.status] || r.status,
        sort: `${r.date}T${r.time || '00:00'}`,
      });
    });
    return items.sort((a, b) => String(b.sort).localeCompare(String(a.sort)));
  }, [employee, activities, attendance, documents, employeeHr]);

  if (!employee) {
    return (
      <div className="glass-card fade-in" style={{ padding: '1.5rem' }}>
        <Empty text="Operario no encontrado." />
        <button type="button" className="btn btn-secondary" onClick={onBack} style={{ marginTop: '1rem' }}>
          Volver a Personal
        </button>
      </div>
    );
  }

  const onDuty = employee.status === 'active';

  return (
    <div className="glass-card fade-in staff-profile" style={{ padding: '1.25rem 1.5rem' }}>
      <style>{`
        @media (max-width: 640px) {
          .staff-profile .sp-row { grid-template-columns: 1fr !important; }
          .staff-profile { padding: 1rem !important; }
          .staff-profile .section-chips { overflow-x: auto; flex-wrap: nowrap !important; -webkit-overflow-scrolling: touch; }
          .staff-profile .section-chips .btn { flex: 0 0 auto; white-space: nowrap; }
        }
      `}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: '1.1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', minWidth: 0 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onBack}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
          >
            <ArrowLeft size={14} /> Personal
          </button>
          <div style={{
            width: 64,
            height: 64,
            borderRadius: 14,
            overflow: 'hidden',
            border: '1px solid var(--border-glass)',
            background: 'rgba(207,161,58,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            fontWeight: 800,
            color: 'var(--text-gold)',
            fontSize: '1.1rem',
          }}>
            {employee.photo ? (
              <img src={employee.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              employee.avatar || (employee.name || '?').split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 className="serif-font" style={{ margin: 0, fontSize: '1.45rem', color: 'var(--text-gold)' }}>
              {employee.name}
            </h3>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 4 }}>
              Legajo {employee.employeeNumber || employee.id} · {employee.role}
              {' · '}
              <span style={{ color: onDuty ? 'var(--emerald-accent)' : 'var(--text-muted)' }}>
                {onDuty ? '● En guardia' : '○ Fuera de servicio'}
              </span>
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Área
          </div>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {employee.department || 'Operaciones'}
          </div>
        </div>
      </div>

      <div className="section-chips" style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.15rem' }}>
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const active = section === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              className="btn btn-secondary btn-sm"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                borderColor: active ? 'var(--primary-gold)' : undefined,
                color: active ? 'var(--text-gold)' : undefined,
                background: active ? 'rgba(207,161,58,0.12)' : undefined,
              }}
            >
              <Icon size={13} /> {s.label}
            </button>
          );
        })}
      </div>

      <div className="glass-panel" style={{ padding: '1.15rem', border: '1px solid var(--border-glass)', borderRadius: 12 }}>
        {section === 'legajo' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <h5 style={{ margin: '0 0 0.75rem', fontSize: '0.78rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-gold)' }}>
                Datos personales
              </h5>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.9rem' }}>
                <Field label="N° legajo" value={employee.employeeNumber || employee.id} />
                <Field label="Documento" value={employee.documentNumber ? `${employee.documentType || 'DNI'} ${employee.documentNumber}` : null} />
                <Field label="CUIL" value={employee.cuil} />
                <Field label="Nacimiento" value={formatShortDate(employee.birthDate)} />
                <Field label="Nacionalidad" value={employee.nationality} />
                <Field label="Estado civil" value={employee.maritalStatus} />
              </div>
            </div>
            <div>
              <h5 style={{ margin: '0 0 0.75rem', fontSize: '0.78rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-gold)' }}>
                Contacto
              </h5>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.9rem' }}>
                <Field label="Teléfono" value={employee.phone ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Phone size={13} /> {employee.phone}</span> : null} />
                <Field label="Email" value={employee.email ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Mail size={13} /> {employee.email}</span> : null} />
                <Field label="Domicilio" value={employee.address ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><MapPin size={13} /> {employee.address}</span> : null} />
                <Field label="Emergencia" value={[employee.emergencyContact, employee.emergencyPhone].filter(Boolean).join(' · ')} />
              </div>
            </div>
            {employee.notes && (
              <div>
                <h5 style={{ margin: '0 0 0.5rem', fontSize: '0.78rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-gold)' }}>
                  Observaciones de RR.HH.
                </h5>
                <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>{employee.notes}</p>
              </div>
            )}
          </div>
        )}

        {section === 'laboral' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.9rem' }}>
            <Field label="Cargo" value={employee.role} />
            <Field label="Especialidad" value={employee.specialty} />
            <Field label="Departamento" value={employee.department} />
            <Field label="Fecha de ingreso" value={formatShortDate(employee.hireDate)} />
            <Field label="Tipo de contrato" value={employee.contractType} />
            <Field label="Jornada" value={employee.workShift} />
            <Field label="Reporta a" value={employee.reportsTo} />
            <Field label="Tarea actual" value={employee.currentTask} />
            <Field label="Estado operativo" value={onDuty ? 'En guardia' : 'Fuera de servicio'} />
          </div>
        )}

        {section === 'bitacora' && (
          <div>
            {activities.length === 0 ? (
              <Empty text="Sin actividades registradas en bitácora." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                {activities.map((a) => (
                  <div key={a.id} className="sp-row" style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '0.75rem', padding: '0.65rem 0', borderBottom: '1px solid var(--border-glass)', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{formatShortDate(a.date)} {a.time}</span>
                    <span style={{ color: 'var(--text-primary)' }}>{a.description}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {section === 'asistencia' && (
          <div>
            {attendance.length === 0 ? (
              <Empty text="Sin registros de asistencia / fichadas." />
            ) : (
              attendance.map((a) => (
                <div key={`${a.date}-${a.checkIn || a.id}`} className="sp-row" style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: '0.75rem', padding: '0.7rem 0', borderBottom: '1px solid var(--border-glass)', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{formatShortDate(a.date)}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {[a.checkIn, a.checkOut].filter(Boolean).join(' → ') || a.notes || '—'}
                  </span>
                  <strong style={{
                    color: a.status === 'present' ? 'var(--emerald-accent)'
                      : a.status === 'late' ? 'var(--warning-accent)'
                        : 'var(--danger-accent)',
                  }}>
                    {a.status === 'present' ? 'Presente' : a.status === 'late' ? 'Tarde' : a.status === 'absent' ? 'Ausente' : a.status}
                  </strong>
                </div>
              ))
            )}
          </div>
        )}

        {section === 'rrhh' && (
          <div>
            {employeeHr.length === 0 ? (
              <Empty text="Sin novedades RR.HH. (faltas, tardanzas, permisos o solicitudes) para este operario." />
            ) : (
              employeeHr.map((r) => (
                <div key={r.id} className="sp-row" style={{ display: 'grid', gridTemplateColumns: '100px 1fr auto', gap: '0.75rem', padding: '0.7rem 0', borderBottom: '1px solid var(--border-glass)', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{formatShortDate(r.date)}</span>
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>{r.title}</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {HR_RECORD_TYPES[r.type]?.label || r.type}
                      {r.detail ? ` · ${r.detail}` : ''}
                    </div>
                  </div>
                  <span style={{ color: 'var(--text-gold)', fontWeight: 650, fontSize: '0.75rem' }}>
                    {HR_STATUS[r.status] || r.status}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {section === 'docs' && (
          <div>
            {documents.length === 0 ? (
              <Empty text="Sin documentación cargada en el legajo." />
            ) : (
              documents.map((d, idx) => (
                <div key={d.id || idx} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0.75rem', padding: '0.7rem 0', borderBottom: '1px solid var(--border-glass)', fontSize: '0.85rem', alignItems: 'center' }}>
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>{d.name}</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{d.type}</div>
                  </div>
                  <span style={{ color: 'var(--text-secondary)' }}>{formatShortDate(d.date)}</span>
                  <span style={{ color: d.status === 'vigente' ? 'var(--emerald-accent)' : 'var(--warning-accent)' }}>
                    {d.status || '—'}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {section === 'trazabilidad' && (
          <div>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Línea de tiempo del legajo: ingreso, bitácora, asistencia y documentación.
            </p>
            {timeline.length === 0 ? (
              <Empty text="Sin eventos de trazabilidad." />
            ) : (
              timeline.map((item, idx) => (
                <div key={`${item.sort}-${idx}`} className="sp-row" style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '0.75rem', padding: '0.65rem 0', borderBottom: '1px solid var(--border-glass)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{item.when}</div>
                  <div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 650, color: 'var(--text-gold)' }}>{item.title}</div>
                    {item.detail && (
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2 }}>{item.detail}</div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
