import { useState } from 'react';
import { FileDown, Mail, X } from 'lucide-react';
import ModalDialog from '../ModalDialog';
import { exportMembershipRequestPdf } from '../../domain/members/exportMembershipRequestPdf';

export default function MemberRequestDetailModal({
  open,
  detail,
  pending = false,
  busy = false,
  invite = null,
  deliverError = '',
  onClose,
  onDeliver,
  onAlta,
  onReject,
}) {
  const [exporting, setExporting] = useState(false);

  if (!open || !detail) return null;

  const download = async () => {
    setExporting(true);
    try {
      await exportMembershipRequestPdf(detail);
    } finally {
      setExporting(false);
    }
  };

  const creds = invite?.creds;

  return (
    <ModalDialog
      open={open}
      onClose={busy ? undefined : onClose}
      labelledBy="member-request-detail-title"
      contentStyle={{
        width: 'min(94vw, 600px)',
        padding: '1.25rem',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-glass)',
        maxHeight: '90vh',
        overflow: 'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: '0.85rem' }}>
        <div>
          <h4 id="member-request-detail-title" className="serif-font" style={{ margin: 0, color: 'var(--text-gold)' }}>
            {detail.title}
          </h4>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {detail.subtitle}
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={busy} aria-label="Cerrar">
          <X size={14} />
        </button>
      </div>

      <dl className="member-request-detail-grid">
        {detail.rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {creds ? (
        <div className="member-request-invite">
          <p className="member-request-invite-ok">
            {invite.emailSent
              ? `Acceso creado y mail enviado a ${invite.emailTo}. Anotá la contraseña: solo se muestra ahora.`
              : 'Acceso creado. Anotá la contraseña: solo se muestra ahora.'}
          </p>
          {invite.emailError ? (
            <p className="member-request-invite-miss" role="alert">{invite.emailError}</p>
          ) : null}
          <dl className="member-request-detail-grid">
            {creds.username && creds.username !== creds.email ? (
              <div>
                <dt>Usuario</dt>
                <dd>{creds.username}</dd>
              </div>
            ) : null}
            <div>
              <dt>Email de ingreso</dt>
              <dd>{creds.email}</dd>
            </div>
            <div>
              <dt>Contraseña</dt>
              <dd>{creds.password}</dd>
            </div>
            <div>
              <dt>Link del portal</dt>
              <dd><a href={invite.portalUrl} target="_blank" rel="noopener noreferrer">{invite.portalUrl}</a></dd>
            </div>
          </dl>
          <div className="member-request-detail-actions">
            {invite.whatsappUrl ? (
              <a className="btn btn-emerald" href={invite.whatsappUrl} target="_blank" rel="noopener noreferrer">
                Enviar por WhatsApp
              </a>
            ) : (
              <p className="member-request-invite-miss">Sin celular válido para WhatsApp.</p>
            )}
            {invite.emailSent ? (
              <p className="member-request-invite-ok">Resend ya mandó la plantilla al socio.</p>
            ) : invite.mailUrl ? (
              <a className="btn btn-tan" href={invite.mailUrl}>
                <Mail size={16} /> Abrir mail
              </a>
            ) : (
              <p className="member-request-invite-miss">Sin email de contacto.</p>
            )}
            <button type="button" className="btn btn-secondary" onClick={download} disabled={exporting}>
              <FileDown size={16} /> {exporting ? 'Generando…' : 'Descargar PDF'}
            </button>
          </div>
        </div>
      ) : (
        <div className="member-request-detail-actions">
          {pending && onDeliver ? (
            <button type="button" className="btn btn-emerald" onClick={onDeliver} disabled={busy}>
              {busy ? 'Generando acceso y enviando mail…' : 'Generar acceso y enviar mail'}
            </button>
          ) : null}
          {pending && detail.kind === 'alta' && onAlta ? (
            <button type="button" className="btn btn-secondary" onClick={onAlta} disabled={busy}>
              Completar ficha a mano
            </button>
          ) : null}
          <button type="button" className="btn btn-tan" onClick={download} disabled={exporting || busy}>
            <FileDown size={16} /> {exporting ? 'Generando…' : 'Descargar PDF'}
          </button>
          {pending && onReject ? (
            <button type="button" className="btn btn-secondary" onClick={onReject} disabled={busy}>
              Rechazar
            </button>
          ) : null}
        </div>
      )}

      {deliverError ? <p className="member-access-error" role="alert">{deliverError}</p> : null}
    </ModalDialog>
  );
}
