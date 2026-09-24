import { useEffect, useMemo, useState } from 'react';
import { Copy, Eye, EyeOff, KeyRound, Mail, RefreshCw, X } from 'lucide-react';

function WhatsAppIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"
      />
    </svg>
  );
}
import ModalDialog from '../ModalDialog';
import { generatePassword, portalLoginFromEmail } from '../../domain/auth/credentials';
import {
  MEMBER_STATUS_REASONS,
  reasonLabel,
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
  sending = '',
  notice = '',
  onClose,
  onGenerate,
  onSendWhatsApp,
  onSendEmail,
}) {
  const seed = useMemo(() => {
    return portalLoginFromEmail(member?.email) || {
      username: '',
      email: '',
      password: generatePassword(),
    };
  }, [member?.memberId, member?.email]);

  const [creds, setCreds] = useState(seed);
  const [showPass, setShowPass] = useState(true);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    if (open && member && !result) setCreds(seed);
  }, [open, member?.memberId, seed, result]);

  if (!open || !member) return null;

  const shown = result?.creds || creds;
  const canSend = String(shown.email || '').includes('@') && String(shown.password || '').length >= 6;

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
            {result ? 'Acceso generado' : 'Generar acceso'}
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
          El socio entra con su email y esta contraseña. Queda vinculado a la ficha.
        </p>
      ) : (
        <p style={{ margin: '0 0 0.85rem', fontSize: '0.82rem', color: 'var(--emerald-accent)' }}>
          Credenciales listas. Copiá y entregá al socio; la contraseña no se vuelve a mostrar completa en el listado.
        </p>
      )}

      <div className="member-creds-grid">
        <label>
          <span>Email</span>
          <div className="member-creds-row">
            <input
              className="form-input"
              type="email"
              value={shown.email}
              readOnly={Boolean(result)}
              autoComplete="off"
              onChange={(e) => {
                if (result) return;
                const email = e.target.value.trim().toLowerCase();
                setCreds((c) => ({ ...c, email, username: email }));
              }}
            />
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
              autoComplete="off"
              spellCheck={false}
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
                onClick={() => setCreds((c) => ({ ...c, password: generatePassword() }))}
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
      {notice ? <p style={{ margin: '0.5rem 0 0', fontSize: '0.78rem', color: 'var(--emerald-accent)' }}>{notice}</p> : null}
      {error ? <p className="conc-error" role="alert" style={{ marginTop: '0.65rem' }}>{error}</p> : null}

      <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8, marginTop: '1rem' }}>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
          {result ? 'Cerrar' : 'Cancelar'}
        </button>
        <button
          type="button"
          className="btn btn-emerald"
          disabled={busy || !canSend || !member.phone}
          title={member.phone ? 'Abrir WhatsApp con las credenciales' : 'La ficha no tiene celular'}
          onClick={() => onSendWhatsApp?.(shown)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <WhatsAppIcon size={16} />
          {sending === 'whatsapp' ? 'Abriendo…' : 'WhatsApp'}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !canSend}
          onClick={() => onSendEmail?.(shown)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Mail size={16} /> {sending === 'email' ? 'Enviando…' : 'Enviar por email'}
        </button>
        {!result ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy || !canSend}
            onClick={() => onGenerate?.(shown)}
          >
            <KeyRound size={14} /> {busy && !sending ? 'Creando…' : 'Crear acceso'}
          </button>
        ) : null}
      </div>
    </ModalDialog>
  );
}
