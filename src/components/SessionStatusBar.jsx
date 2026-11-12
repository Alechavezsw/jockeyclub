import { ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS } from '../domain/auth/roles';

/** Barra de sesión: quién está logueado y sede. Sin buscador global. */
export default function SessionStatusBar() {
  const { user, role } = useAuth();

  const now = new Date().toLocaleString('es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div className="session-status-bar">
      <span className="session-status-bar__meta">
        <ShieldCheck size={13} className="session-status-bar__shield" aria-hidden="true" />
        Sesión:{' '}
        <strong>{user?.fullName}</strong>
        <span> · {ROLE_LABELS[role] || role}</span>
      </span>

      <span className="session-status-bar__seat">Sede Rivadavia · {now}</span>
    </div>
  );
}
