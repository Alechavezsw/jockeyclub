import { useMemo, useState } from 'react';
import {
  BellRing, UserX, Clock3, CalendarOff, Inbox, Plus, Check, X,
} from 'lucide-react';
import {
  HR_RECORD_TYPES,
  HR_TYPE_ORDER,
  HR_STATUS,
  createHrRecord,
  filterHrByType,
  countHrByType,
} from '../../domain/staff/hr';
import { formatShortDate } from '../../domain/members/dues';

const TYPE_ICONS = {
  novedad: BellRing,
  falta: UserX,
  tardanza: Clock3,
  permiso: CalendarOff,
  solicitud: Inbox,
};

const TONE_COLOR = {
  gold: 'var(--text-gold)',
  danger: 'var(--danger-accent)',
  warn: 'var(--warning-accent)',
  ok: 'var(--emerald-accent)',
  neutral: 'var(--text-secondary)',
};

/** Panel RR.HH. de Personal: novedades, faltas, tardanzas, permisos, solicitudes. */
export default function StaffHrPanel({ staffMembers = [], hrRecords = [], setHrRecords }) {
  const [activeType, setActiveType] = useState('novedad');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    employeeId: '',
    date: new Date().toISOString().slice(0, 10),
    title: '',
    detail: '',
  });
  const [error, setError] = useState('');

  const counts = useMemo(() => countHrByType(hrRecords), [hrRecords]);
  const filtered = useMemo(
    () => filterHrByType(hrRecords, activeType).slice().sort((a, b) =>
      `${b.date}${b.time || ''}`.localeCompare(`${a.date}${a.time || ''}`)
    ),
    [hrRecords, activeType]
  );

  const meta = HR_RECORD_TYPES[activeType];
  const needsEmployee = activeType !== 'novedad';

  const resetForm = () => {
    setForm({
      employeeId: staffMembers[0]?.id || '',
      date: new Date().toISOString().slice(0, 10),
      title: '',
      detail: '',
    });
    setError('');
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    if (!form.title.trim()) {
      setError('El título / motivo es obligatorio.');
      return;
    }
    if (needsEmployee && !form.employeeId) {
      setError('Seleccione el operario.');
      return;
    }
    const emp = staffMembers.find((s) => s.id === form.employeeId);
    const record = createHrRecord({
      type: activeType,
      employeeId: needsEmployee ? form.employeeId : null,
      employeeName: needsEmployee ? emp?.name : 'General',
      date: form.date,
      title: form.title,
      detail: form.detail,
    });
    setHrRecords((prev) => [record, ...prev]);
    setShowForm(false);
    resetForm();
  };

  const setStatus = (id, status) => {
    setHrRecords((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
  };

  const removeRecord = (id) => {
    setHrRecords((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <div className="glass-card fade-in" style={{ padding: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: '1rem' }}>
        <div>
          <h4 className="serif-font" style={{ margin: 0, fontSize: '1.2rem', color: 'var(--text-gold)' }}>
            RR.HH. · Novedades de personal
          </h4>
          <p style={{ margin: '0.3rem 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            Novedades, faltas, tardanzas, permisos y solicitudes.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => { resetForm(); setShowForm((v) => !v); }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Plus size={14} /> Cargar {meta?.label?.slice(0, -1) || 'novedad'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {HR_TYPE_ORDER.map((type) => {
          const t = HR_RECORD_TYPES[type];
          const Icon = TYPE_ICONS[type];
          const active = activeType === type;
          return (
            <button
              key={type}
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => { setActiveType(type); setShowForm(false); setError(''); }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                borderColor: active ? 'var(--primary-gold)' : undefined,
                color: active ? 'var(--text-gold)' : undefined,
                background: active ? 'rgba(207,161,58,0.12)' : undefined,
              }}
            >
              <Icon size={13} /> {t.label}
              <span style={{
                marginLeft: 2,
                minWidth: 18,
                height: 18,
                borderRadius: 9,
                background: active ? 'var(--primary-gold)' : 'rgba(255,255,255,0.06)',
                color: active ? '#060e0a' : 'var(--text-muted)',
                fontSize: '0.68rem',
                fontWeight: 800,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 5px',
              }}>
                {counts[type] || 0}
              </span>
            </button>
          );
        })}
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '0.75rem',
            padding: '1rem',
            marginBottom: '1rem',
            borderRadius: 12,
            border: '1px solid var(--border-glass)',
            background: 'rgba(255,255,255,0.02)',
          }}
        >
          {needsEmployee && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Operario *</label>
              <select
                className="form-input"
                value={form.employeeId || staffMembers[0]?.id || ''}
                onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
              >
                {staffMembers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} · {s.role}</option>
                ))}
              </select>
            </div>
          )}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Fecha</label>
            <input
              type="date"
              className="form-input"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0, gridColumn: needsEmployee ? '1 / -1' : 'span 2' }}>
            <label className="form-label">
              {activeType === 'novedad' ? 'Título *' : 'Motivo *'}
            </label>
            <input
              className="form-input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={
                activeType === 'falta' ? 'Ej: Ausencia injustificada'
                  : activeType === 'tardanza' ? 'Ej: Ingreso 25 min tarde'
                    : activeType === 'permiso' ? 'Ej: Permiso médico medio día'
                      : activeType === 'solicitud' ? 'Ej: Solicitud de franco compensatorio'
                        : 'Ej: Cambio de turnos fin de semana'
              }
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
            <label className="form-label">Detalle</label>
            <textarea
              className="form-input"
              rows={2}
              value={form.detail}
              onChange={(e) => setForm({ ...form, detail: e.target.value })}
              placeholder="Observaciones internas..."
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>
          {error && <p style={{ gridColumn: '1 / -1', margin: 0, color: '#ef4444', fontSize: '0.85rem' }}>{error}</p>}
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>Cancelar</button>
            <button type="submit" className="btn btn-primary btn-sm">Registrar</button>
          </div>
        </form>
      )}

      {filtered.length === 0 ? (
        <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          No hay {meta.label.toLowerCase()} cargadas.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
          {filtered.map((r) => {
            const color = TONE_COLOR[HR_RECORD_TYPES[r.type]?.tone] || 'var(--text-gold)';
            const canDecide = r.status === 'pending' && (r.type === 'permiso' || r.type === 'solicitud');
            return (
              <div
                key={r.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: '0.75rem',
                  padding: '0.85rem 1rem',
                  borderRadius: 10,
                  border: '1px solid var(--border-glass)',
                  background: 'rgba(255,255,255,0.015)',
                }}
              >
                <div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
                    <strong style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>{r.title}</strong>
                    <span style={{ fontSize: '0.7rem', color, fontWeight: 700 }}>
                      {HR_STATUS[r.status] || r.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    {r.employeeName || 'General'} · {formatShortDate(r.date)}{r.time ? ` · ${r.time}` : ''}
                  </div>
                  {r.detail && (
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 4 }}>{r.detail}</div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                  {canDecide && (
                    <div style={{ display: 'inline-flex', gap: 4 }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        title="Aprobar"
                        onClick={() => setStatus(r.id, 'approved')}
                        style={{ color: 'var(--emerald-accent)', padding: '0.25rem 0.45rem' }}
                      >
                        <Check size={13} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        title="Rechazar"
                        onClick={() => setStatus(r.id, 'rejected')}
                        style={{ color: 'var(--danger-accent)', padding: '0.25rem 0.45rem' }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => removeRecord(r.id)}
                    style={{ fontSize: '0.7rem', color: '#f87171' }}
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
