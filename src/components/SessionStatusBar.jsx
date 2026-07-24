import { ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS } from '../domain/auth/roles';

export default function SessionStatusBar() {
  const { user, role } = useAuth();
  const now = new Date().toLocaleString('es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div
      className="session-status-bar"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.75rem 1.25rem',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '1rem',
        padding: '0.55rem 0.9rem',
        borderRadius: 10,
        border: '1px solid var(--border-glass)',
        background: 'rgba(255,255,255,0.02)',
        fontSize: '0.75rem',
        color: 'var(--text-muted)',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <ShieldCheck size={13} style={{ color: 'var(--emerald-accent)' }} />
        Sesión: <strong style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{user?.fullName}</strong>
        <span>· {ROLE_LABELS[role] || role}</span>
      </span>
      <span>Sede Rivadavia · {now}</span>
    </div>
  );
}
