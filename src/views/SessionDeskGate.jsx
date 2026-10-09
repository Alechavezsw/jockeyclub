import { Shield, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { SESSION_DESK } from '../domain/auth/sessionDesk';

export default function SessionDeskGate() {
  const { user, enterDesk, logout } = useAuth();
  const name = String(user?.fullName || user?.email || '').split(/\s+/)[0] || 'Hola';

  return (
    <div className="fade-in login-shell session-desk-gate">
      <section className="login-brand-panel" style={{ padding: '0.5rem 0.25rem' }}>
        <p className="session-desk-kicker">Rivadavia · San Juan</p>
        <h1 className="serif-font session-desk-title">
          Dos puertas.<br />Una sola sesión.
        </h1>
        <p className="session-desk-lead">
          {name}, este usuario es socio y también autoridad. Elegí por cuál entra esta pestaña.
          La otra no se abre acá.
        </p>
      </section>

      <div className="glass-card session-desk-card">
        <p className="session-desk-card-kicker">Elegí el acceso</p>
        <div className="session-desk-doors">
          <button
            type="button"
            className="session-desk-door is-member"
            onClick={() => enterDesk(SESSION_DESK.member)}
          >
            <span className="session-desk-door-icon" aria-hidden="true">
              <User size={22} />
            </span>
            <span className="session-desk-door-name serif-font">Portal de socio</span>
            <span className="session-desk-door-copy">
              Tu ficha, la cuota, las canchas. Sin padrón ni caja.
            </span>
          </button>
          <button
            type="button"
            className="session-desk-door is-ops"
            onClick={() => enterDesk(SESSION_DESK.ops)}
          >
            <span className="session-desk-door-icon" aria-hidden="true">
              <Shield size={22} />
            </span>
            <span className="session-desk-door-name serif-font">Administración</span>
            <span className="session-desk-door-copy">
              El libro del club. No entra tu cuenta personal.
            </span>
          </button>
        </div>
        <button type="button" className="session-desk-exit" onClick={() => logout()}>
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
