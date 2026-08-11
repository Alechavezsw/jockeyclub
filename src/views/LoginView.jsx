import { useMemo, useState } from 'react';
import { Lock, Mail, Shield } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { DEMO_USERS, DEMO_PASSWORD_HINT } from '../domain/auth/demoUsers';
import { ROLE_LABELS } from '../domain/auth/roles';

export default function LoginView() {
  const { login, authError, setAuthError, isSupabase, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showDemo, setShowDemo] = useState(false);

  const allowDemoPanel = useMemo(() => {
    if (isSupabase) return false;
    if (import.meta.env.VITE_SHOW_DEMO_LOGINS === 'false') return false;
    return import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO_LOGINS === 'true';
  }, [isSupabase]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setAuthError('');
    try {
      await login({ email, password });
    } catch {
      // error en contexto
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '70vh', display: 'grid', placeItems: 'center', color: 'var(--text-secondary)' }}>
        Verificando credenciales…
      </div>
    );
  }

  return (
    <div
      className="fade-in login-shell"
      style={{
        minHeight: '85vh',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.1fr) minmax(320px, 420px)',
        gap: '2rem',
        alignItems: 'center',
        padding: '2rem 1.25rem',
        maxWidth: 1100,
        margin: '0 auto',
      }}
    >
      <style>{`
        @media (max-width: 860px) {
          .login-shell { grid-template-columns: 1fr !important; gap: 1.5rem !important; padding: 0 !important; }
          .login-brand-panel { text-align: center; order: -1; }
          .login-brand-panel ul { align-items: center; }
        }
        @media (max-width: 480px) {
          .login-shell { padding: 0 !important; }
        }
      `}</style>

      <section className="login-brand-panel" style={{ padding: '0.5rem 0.25rem' }}>
        <p style={{
          fontSize: '0.72rem',
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: 'var(--text-gold)',
          marginBottom: '0.75rem',
        }}>
          Sede Rivadavia · San Juan
        </p>
        <h1 className="serif-font" style={{
          fontSize: 'clamp(2rem, 4vw, 2.75rem)',
          margin: '0 0 0.75rem',
          letterSpacing: '0.06em',
          lineHeight: 1.15,
        }}>
          Jockey Club<br />San Juan
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.02rem', maxWidth: 420, lineHeight: 1.55, margin: 0 }}>
          Portal institucional de socios y gestión
        </p>
        <ul style={{
          listStyle: 'none',
          padding: 0,
          margin: '1.5rem 0 0',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.55rem',
          color: 'var(--text-muted)',
          fontSize: '0.85rem',
        }}>
          <li>· Autogestión de reservas e instalaciones</li>
          <li>· Contabilidad, cajas y control de acceso</li>
          <li>· Alertas operativas y comunicaciones oficiales</li>
        </ul>
      </section>

      <div
        className="glass-card"
        style={{
          width: '100%',
          padding: '2rem 1.75rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.15rem',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <img
            src="/logo-jockey-club.png"
            alt="Escudo Jockey Club San Juan"
            style={{
              width: 68,
              height: 68,
              borderRadius: '50%',
              objectFit: 'cover',
              border: '2px solid var(--primary-gold)',
              marginBottom: '0.65rem',
            }}
          />
          <h2 className="serif-font" style={{ fontSize: '1.25rem', margin: 0, letterSpacing: '0.1em' }}>
            ACCESO SEGURO
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.35rem' }}>
            Ingrese con su cuenta institucional
          </p>
        </div>

        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <div>
            <label className="form-label" htmlFor="login-email">Correo electrónico</label>
            <div style={{ position: 'relative' }}>
              <Mail size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                id="login-email"
                className="form-input"
                type="email"
                required
                autoComplete="username"
                spellCheck={false}
                name="email"
                placeholder="usuario@jockeyclubsanjuan.org"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ paddingLeft: '2.4rem' }}
              />
            </div>
          </div>
          <div>
            <label className="form-label" htmlFor="login-password">Contraseña</label>
            <div style={{ position: 'relative' }}>
              <Lock size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                id="login-password"
                className="form-input"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ paddingLeft: '2.4rem' }}
              />
            </div>
          </div>

          {authError && (
            <div role="alert" aria-live="assertive" style={{ color: '#ef4444', fontSize: '0.85rem', display: 'flex', gap: 6, alignItems: 'center' }}>
              <Shield size={14} aria-hidden="true" /> {authError}
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={submitting} style={{ width: '100%', marginTop: '0.15rem' }}>
            {submitting ? 'Validando…' : 'Ingresar al portal'}
          </button>
        </form>

        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center', margin: 0, lineHeight: 1.45 }}>
          Uso exclusivo de socios, personal y autoridades del club.
          Toda actividad queda sujeta a políticas internas de acceso.
        </p>

        {allowDemoPanel && (
          <div style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '0.85rem' }}>
            <button
              type="button"
              onClick={() => setShowDemo((v) => !v)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: '0.75rem',
                cursor: 'pointer',
                textDecoration: 'underline',
                padding: 0,
              }}
            >
              {showDemo ? 'Ocultar accesos de prueba' : 'Entorno de desarrollo — mostrar accesos de prueba'}
            </button>
            {showDemo && (
              <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>
                  Clave de prueba: <code>{DEMO_PASSWORD_HINT}</code>
                </p>
                {DEMO_USERS.map((demo) => (
                  <button
                    key={demo.id}
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setEmail(demo.email);
                      setPassword(demo.password);
                      setAuthError('');
                    }}
                    style={{ justifyContent: 'space-between', display: 'flex', fontSize: '0.78rem' }}
                  >
                    <span>{demo.fullName}</span>
                    <span style={{ color: 'var(--text-gold)' }}>{ROLE_LABELS[demo.role]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
