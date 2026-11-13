import { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, RefreshCw } from 'lucide-react';
import ModalDialog from './ModalDialog';
import { generatePassword } from '../domain/auth/credentials';

/**
 * Diálogo para regenerar o fijar una clave nueva.
 * onSubmit({ password }) debe persistir y, si aplica, avisar por Resend.
 */
export default function ChangePasswordDialog({
  open,
  onClose,
  title = 'Cambiar clave',
  subtitle = 'Podés regenerar una clave o escribir una propia. Se envía por mail.',
  confirmLabel = 'Guardar y enviar mail',
  busy = false,
  error = '',
  onSubmit,
}) {
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(true);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    setPassword(generatePassword());
    setVisible(true);
    setLocalError('');
    return undefined;
  }, [open]);

  if (!open) return null;

  const submit = async (event) => {
    event.preventDefault();
    const next = String(password || '').trim();
    if (next.length < 6) {
      setLocalError('La clave debe tener al menos 6 caracteres.');
      return;
    }
    setLocalError('');
    await onSubmit?.({ password: next });
  };

  return (
    <ModalDialog
      open={open}
      onClose={busy ? undefined : onClose}
      labelledBy="change-password-title"
      contentClassName="modal-content glass-panel change-password-modal"
      contentStyle={{
        width: 'min(440px, 94vw)',
        maxWidth: 440,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-glass)',
        padding: 0,
      }}
    >
      <form onSubmit={submit}>
        <div className="modal-header">
          <h2 id="change-password-title" className="modal-title">
            <KeyRound size={16} aria-hidden="true" /> {title}
          </h2>
          <button type="button" className="modal-close" onClick={onClose} disabled={busy} aria-label="Cerrar">
            ×
          </button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gap: '0.85rem' }}>
          <p className="ops-muted" style={{ margin: 0, fontSize: '0.86rem' }}>{subtitle}</p>
          <label className="form-group" style={{ margin: 0 }}>
            <span className="form-label">Nueva clave</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="form-input"
                type={visible ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                disabled={busy}
                required
                minLength={6}
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                title={visible ? 'Ocultar' : 'Mostrar'}
                onClick={() => setVisible((v) => !v)}
                disabled={busy}
              >
                {visible ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                title="Regenerar"
                onClick={() => {
                  setPassword(generatePassword());
                  setVisible(true);
                }}
                disabled={busy}
              >
                <RefreshCw size={14} /> Regenerar
              </button>
            </div>
          </label>
          {(localError || error) ? (
            <p className="ig-error" role="alert" style={{ margin: 0 }}>{localError || error}</p>
          ) : null}
        </div>
        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || String(password || '').trim().length < 6}>
            {busy ? 'Guardando…' : confirmLabel}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
