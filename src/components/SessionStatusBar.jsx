import { useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS } from '../domain/auth/roles';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import * as repos from '../data/repos';
import ChangePasswordDialog from './ChangePasswordDialog';

const INSTITUTIONAL_MAIL_RE = /@(?:jockey\.sj|jockeyclubsj\.com(?:\.ar)?|lila-jockey)\b/i;

function isDeliverablePasswordMail(email) {
  const value = String(email || '').trim();
  if (!value.includes('@')) return false;
  if (INSTITUTIONAL_MAIL_RE.test(value)) return false;
  return true;
}

/** Destino real para avisar la clave (solo casilla entregable). */
export function mailTargetForUser(user) {
  const contact = String(user?.contactEmail || '').trim();
  const login = String(user?.email || '').trim();
  if (isDeliverablePasswordMail(contact)) return contact;
  if (isDeliverablePasswordMail(login)) return login;
  return '';
}

/** Barra de sesión: quién está logueado, sede y cambio de clave. */
export default function SessionStatusBar() {
  const { user, role } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const now = new Date().toLocaleString('es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const saveOwnPassword = async ({ password }) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (!isSupabaseConfigured || !supabase) {
        throw new Error('El cambio de clave requiere la nube.');
      }
      if (!user?.id) throw new Error('Sesión no válida.');

      const { error: authError } = await supabase.auth.updateUser({ password });
      if (authError) throw new Error(authError.message || 'No se pudo actualizar la clave.');

      const to = mailTargetForUser(user);
      let mailNote = '';
      if (to && typeof repos.sendAccessInviteEmail === 'function') {
        try {
          await repos.sendAccessInviteEmail({
            to,
            name: user.fullName || '',
            username: user.username || String(user.email || '').split('@')[0] || '',
            loginEmail: user.email || to,
            password,
            kind: 'password_changed',
          });
          mailNote = ` Mail enviado a ${to}.`;
        } catch (mailErr) {
          mailNote = ` La clave quedó guardada, pero el mail falló: ${mailErr?.message || 'error'}.`;
        }
      } else {
        mailNote = ' La clave quedó guardada; falta un mail real de contacto para avisar.';
      }

      setOpen(false);
      setNotice(`Clave actualizada.${mailNote}`);
    } catch (err) {
      setError(err?.message || 'No se pudo cambiar la clave.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="session-status-bar">
        <span className="session-status-bar__meta">
          <ShieldCheck size={13} className="session-status-bar__shield" aria-hidden="true" />
          Sesión:{' '}
          <strong>{user?.fullName}</strong>
          <span> · {ROLE_LABELS[role] || role}</span>
        </span>

        <span className="session-status-bar__actions">
          <button
            type="button"
            className="session-status-bar__btn"
            onClick={() => {
              setError('');
              setNotice('');
              setOpen(true);
            }}
          >
            <KeyRound size={12} aria-hidden="true" />
            Cambiar clave
          </button>
          <span className="session-status-bar__seat">Sede Rivadavia · {now}</span>
        </span>
      </div>

      {notice ? (
        <p className="session-status-bar__notice" role="status">{notice}</p>
      ) : null}

      <ChangePasswordDialog
        open={open}
        onClose={() => (!busy ? setOpen(false) : null)}
        title="Cambiar tu clave"
        subtitle="Mínimo 6 caracteres."
        confirmLabel="Guardar Clave"
        busy={busy}
        error={error}
        onSubmit={saveOwnPassword}
      />
    </>
  );
}
