import { useEffect, useMemo, useState } from 'react';
import { Copy, Eye, EyeOff, KeyRound, RefreshCw, X } from 'lucide-react';
import ModalDialog from '../ModalDialog';
import { buildCredentials, loginEmailFromUsername } from '../../domain/auth/credentials';
import {
  MEMBER_STATUS_REASONS,
  reasonLabel,
  splitMemberName,
} from '../../domain/members/memberAdminActions';

/**
 * Modal de motivo (suspender / activar / baja) — queda auditado.
 */
export function MemberLifecycleModal({
  open,
  member,
  action, // suspend | activate | delete
  busy = false,
  error = '',
  onClose,
  onConfirm,
}) {
  const reasons = MEMBER_STATUS_REASONS[action] || [];
  const [reasonId, setReasonId] = useState(reasons[0]?.id || 'otro');
  const [detail, setDetail] = useState('');

  if (!open || !member) return null;

  const titles = {
    suspend: 'Suspender socio',
    activate: 'Reactivar socio',
    delete: 'Dar de baja / eliminar del padrón activo',
  };
  const confirms = {
    suspend: 'Confirmar suspensión',
    activate: 'Confirmar reactivación',
    delete: 'Confirmar baja',
  };

  return (
    <ModalDialog
      onClose={busy ? undefined : onClose}
      labelledBy="member-lifecycle-title"
      contentStyle={{
        width: 'min(92vw, 440px)',
        padding: '1.25rem',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-glass)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: '0.85rem' }}>
        <div>
          <h4 id="member-lifecycle-title" className="serif-font" style={{ margin: 0, color: 'var(--text-gold)' }}>
            {titles[action] || 'Acción'}
          </h4>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {member.name} · Nº {member.memberId}
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={busy} aria-label="Cerrar">
          <X size={14} />
        </button>
      </div>

      <p style={{ margin: '0 0 0.75rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
        El motivo queda registrado en la ficha y en la auditoría del sistema.
      </p>

      <label className="form-group" style={{ display: 'block', marginBottom: '0.75rem' }}>
        <span className="form-label">Motivo *</span>
        <select
          className="form-input"
          value={reasonId}
          onChange={(e) => setReasonId(e.target.value)}
          disabled={busy}
        >
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>{r.label}</option>
          ))}
        </select>
      </label>

      <label className="form-group" style={{ display: 'block', marginBottom: '0.85rem' }}>
        <span className="form-label">Detalle / observaciones {action === 'delete' || reasonId === 'otro' ? '*' : ''}</span>
        <textarea
          className="form-input"
          rows={3}
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="Ej. resolución, expediente, fecha de notificación…"
          disabled={busy}
          style={{ resize: 'vertical' }}
        />
      </label>

      {error ? <p className="conc-error" role="alert">{error}</p> : null}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button
          type="button"
          className={action === 'delete' || action === 'suspend' ? 'btn btn-danger' : 'btn btn-primary'}
          disabled={busy}
          onClick={() => {
            const needsDetail = action === 'delete' || reasonId === 'otro';
            if (needsDetail && !String(detail || '').trim()) {
              onConfirm?.({ error: 'Completá el detalle para dejar trazabilidad.' });
              return;
            }
            onConfirm?.({
              reasonId,
              reasonLabel: reasonLabel(action, reasonId),
              detail: String(detail || '').trim(),
            });
          }}
        >
          {busy ? 'Guardando…' : confirms[action]}
        </button>
      </div>
    </ModalDialog>
  );
}

/**
 * Modal para generar / mostrar usuario y contraseña de portal.
 */
export function MemberCredentialsModal({
  open,
  member,
  busy = false,
  error = '',
  result = null,
  onClose,
  onGenerate,
}) {
  const seed = useMemo(() => {
    if (!member) return buildCredentials({});
    const { firstName, lastName } = splitMemberName(member);
    return buildCredentials({
      firstName,
      lastName,
      documentNumber: member.documentNumber,
    });
  }, [member]);

  const [creds, setCreds] = useState(seed);
  const [showPass, setShowPass] = useState(true);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    if (open && member && !result) setCreds(seed);
  }, [open, member?.memberId, seed, result]);

  if (!open || !member) return null;

  const shown = result?.creds || creds;

  const copy = async (value, label) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(''), 1600);
    } catch {
      setCopied('error');
    }
  };

  return (
    <ModalDialog
      onClose={busy ? undefined : onClose}
      labelledBy="member-creds-title"
      contentStyle={{
        width: 'min(92vw, 460px)',
        padding: '1.25rem',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-glass)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: '0.85rem' }}>
        <div>
          <h4 id="member-creds-title" className="serif-font" style={{ margin: 0, color: 'var(--text-gold)' }}>
            {result ? 'Acceso generado' : 'Generar usuario y contraseña'}
          </h4>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {member.name} · Nº {member.memberId}
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={busy} aria-label="Cerrar">
          <X size={14} />
        </button>
      </div>

      {!result ? (
        <p style={{ margin: '0 0 0.85rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          Se crea el usuario de portal con rol Socio y queda vinculado a esta ficha. La acción se audita.
        </p>
      ) : (
        <p style={{ margin: '0 0 0.85rem', fontSize: '0.82rem', color: 'var(--emerald-accent)' }}>
          Credenciales listas. Copiá y entregá al socio; la contraseña no se vuelve a mostrar completa en el listado.
        </p>
      )}

      <div className="member-creds-grid">
        <label>
          <span>Usuario</span>
          <div className="member-creds-row">
            <input className="form-input" value={shown.username} readOnly={Boolean(result)} onChange={(e) => !result && setCreds((c) => {
              const username = e.target.value;
              return { ...c, username, email: loginEmailFromUsername(username) };
            })} />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(shown.username, 'Usuario')} title="Copiar">
              <Copy size={14} />
            </button>
          </div>
        </label>
        <label>
          <span>Email de login</span>
          <div className="member-creds-row">
            <input className="form-input" value={shown.email || member.email || ''} readOnly />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(shown.email, 'Email')} title="Copiar">
              <Copy size={14} />
            </button>
          </div>
        </label>
        <label>
          <span>Contraseña</span>
          <div className="member-creds-row">
            <input
              className="form-input"
              type={showPass ? 'text' : 'password'}
              value={shown.password}
              readOnly={Boolean(result)}
              onChange={(e) => !result && setCreds((c) => ({ ...c, password: e.target.value }))}
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowPass((v) => !v)} title={showPass ? 'Ocultar' : 'Mostrar'}>
              {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(shown.password, 'Contraseña')} title="Copiar">
              <Copy size={14} />
            </button>
            {!result ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                title="Regenerar"
                onClick={() => {
                  const next = buildCredentials(splitMemberName(member));
                  setCreds(next);
                }}
              >
                <RefreshCw size={14} />
              </button>
            ) : null}
          </div>
        </label>
      </div>

      {copied && copied !== 'error' ? (
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.78rem', color: 'var(--emerald-accent)' }}>{copied} copiado</p>
      ) : null}
      {error ? <p className="conc-error" role="alert" style={{ marginTop: '0.65rem' }}>{error}</p> : null}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: '1rem' }}>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
          {result ? 'Cerrar' : 'Cancelar'}
        </button>
        {!result ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !creds.username || (creds.password || '').length < 6}
            onClick={() => onGenerate?.(creds)}
          >
            <KeyRound size={14} /> {busy ? 'Creando…' : 'Crear acceso'}
          </button>
        ) : null}
      </div>
    </ModalDialog>
  );
}
