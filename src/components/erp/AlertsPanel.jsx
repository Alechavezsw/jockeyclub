import { useState } from 'react';
import { BellRing, Megaphone, ShieldAlert } from 'lucide-react';
import { ALERT_SEVERITY, filterAlertsForRole, isAlertVisible } from '../../domain/alerts/alerts';

export function AlertsBanner({ alerts, alertAcks, userRole = 'member', onAck }) {
  const visible = filterAlertsForRole(alerts, userRole).filter((a) => {
    if (!a.requiresAck) return true;
    return !alertAcks.some((ack) => ack.alertId === a.id);
  });

  if (visible.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
      {visible.slice(0, 3).map((alert) => {
        const sev = ALERT_SEVERITY[alert.severity] || ALERT_SEVERITY.info;
        return (
          <div
            key={alert.id}
            role="alert"
            style={{
              border: `1px solid ${sev.color}`,
              background: 'rgba(0,0,0,0.25)',
              borderRadius: 12,
              padding: '0.85rem 1rem',
              display: 'flex',
              gap: '0.75rem',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', gap: '0.65rem' }}>
              <ShieldAlert size={18} style={{ color: sev.color, marginTop: 2, flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 700, color: sev.color }}>{alert.title}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{alert.body}</div>
              </div>
            </div>
            {alert.requiresAck && (
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => onAck?.(alert.id)}>
                Entendido
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function AlertsPanel({ alerts, publishAlert, deactivateAlert }) {
  const [form, setForm] = useState({
    title: '',
    body: '',
    severity: 'warning',
    audience: 'all',
    requiresAck: false,
  });
  const [msg, setMsg] = useState('');

  const active = alerts.filter((a) => isAlertVisible(a));

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <h4 className="serif-font" style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <BellRing size={18} /> Centro de Alertas
        </h4>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Alertas operativas, institucionales y automáticas (Zonda). Visibles según audiencia.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          publishAlert(form);
          setForm({ title: '', body: '', severity: 'warning', audience: 'all', requiresAck: false });
          setMsg('Alerta publicada.');
        }}
        style={{ border: '1px solid var(--border-glass)', borderRadius: 12, padding: '1rem', display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
      >
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">Título</label>
          <input className="form-input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">Mensaje</label>
          <textarea className="form-input" required rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </div>
        <div>
          <label className="form-label">Severidad</label>
          <select className="form-input" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
            <option value="info">Informativa</option>
            <option value="warning">Advertencia</option>
            <option value="critical">Crítica</option>
          </select>
        </div>
        <div>
          <label className="form-label">Audiencia</label>
          <select className="form-input" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
            <option value="all">Todos</option>
            <option value="members">Socios</option>
            <option value="staff">Personal</option>
            <option value="admin">Administración</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'end' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
            <input type="checkbox" checked={form.requiresAck} onChange={(e) => setForm({ ...form, requiresAck: e.target.checked })} />
            Requiere acuse
          </label>
        </div>
        <div>
          <button type="submit" className="btn btn-primary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Megaphone size={14} /> Publicar alerta
          </button>
        </div>
      </form>

      {msg && <p style={{ color: 'var(--emerald-accent)' }}>{msg}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
        {alerts.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>Sin alertas.</p>}
        {alerts.map((alert) => {
          const sev = ALERT_SEVERITY[alert.severity] || ALERT_SEVERITY.info;
          const live = active.some((a) => a.id === alert.id);
          return (
            <div key={alert.id} style={{ border: '1px solid var(--border-glass)', borderRadius: 12, padding: '0.85rem 1rem', opacity: live ? 1 : 0.55 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <strong style={{ color: sev.color }}>{alert.title}</strong>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{alert.body}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    {alert.source} · {alert.audience} · {live ? 'ACTIVA' : 'Inactiva'}
                  </div>
                </div>
                {live && (
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => deactivateAlert(alert.id)}>
                    Desactivar
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
