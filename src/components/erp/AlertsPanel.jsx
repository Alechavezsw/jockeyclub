import { useEffect, useRef, useState } from 'react';
import { BellRing, ImagePlus, Mail, Megaphone, MessageSquare, ShieldAlert, X } from 'lucide-react';
import {
  ALERT_SEVERITY,
  alertDismissKey,
  alertImages,
  filterAlertsForRole,
  isAlertAcknowledged,
  isAlertVisible,
} from '../../domain/alerts/alerts';
import {
  alertDeliverySummary,
  alertDmRecipient,
  alertMailAudience,
  alertMailNeedsPadronPreview,
  buildAlertDmMessage,
} from '../../domain/alerts/alertDelivery';
import { repos } from '../../data/bootstrap';
import { signAlertImage, uploadAlertImage } from '../../data/storage';
import { isSupabaseConfigured } from '../../lib/supabase';

const MAX_ALERT_PHOTOS = 6;

function AlertPhotos({ images = [] }) {
  const list = Array.isArray(images) ? images : [];
  const imageKey = list.map((image) => image.path || image.url || image.name || '').join('|');
  const imagesRef = useRef(list);
  imagesRef.current = list;
  const [urls, setUrls] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const current = imagesRef.current;
    if (!current.length) {
      setUrls([]);
      return undefined;
    }
    Promise.all(current.map(async (image) => {
      if (image.url && String(image.url).startsWith('blob:')) return { ...image, src: image.url };
      const src = image.path ? await signAlertImage(image.path) : (image.url || '');
      return src ? { ...image, src } : null;
    })).then((rows) => {
      if (!cancelled) setUrls(rows.filter(Boolean));
    });
    return () => { cancelled = true; };
  }, [imageKey]);

  if (!urls.length) return null;
  return (
    <div className="alerts-photos">
      {urls.map((image) => (
        <img key={image.path || image.src} src={image.src} alt={image.name || 'Foto de la alerta'} />
      ))}
    </div>
  );
}

export function AlertsBanner({
  alerts,
  alertAcks,
  userRole = 'member',
  onAck,
  /** Si se pasa, solo muestra alertas con estos `source`. */
  onlySources,
  /** Excluye alertas con estos `source` (ej. concession_expiry en el banner global). */
  excludeSources,
  className,
  style,
  maxItems = 3,
}) {
  const [dismissedKeys, setDismissedKeys] = useState(() => new Set());
  const visible = filterAlertsForRole(alerts, userRole).filter((a) => {
    if (onlySources?.length && !onlySources.includes(a.source)) return false;
    if (excludeSources?.length && excludeSources.includes(a.source)) return false;
    if (isAlertAcknowledged(a, alertAcks)) return false;
    const key = alertDismissKey(a);
    if (key && dismissedKeys.has(key)) return false;
    if (a.id && dismissedKeys.has(String(a.id))) return false;
    return true;
  });

  if (visible.length === 0) return null;

  return (
    <div
      className={className}
      style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem', ...style }}
    >
      {visible.slice(0, maxItems).map((alert) => {
        const sev = ALERT_SEVERITY[alert.severity] || ALERT_SEVERITY.info;
        return (
          <div
            key={alert.id}
            role="alert"
            className="alerts-banner-item"
            style={{ borderColor: sev.color }}
          >
            <div className="alerts-banner-copy">
              <ShieldAlert size={18} style={{ color: sev.color, marginTop: 2, flexShrink: 0 }} />
              <div>
                <div className="alerts-banner-title" style={{ color: sev.color }}>{alert.title}</div>
                <div className="alerts-banner-body">{alert.body}</div>
                <AlertPhotos images={alertImages(alert)} />
              </div>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => {
                const key = alertDismissKey(alert);
                setDismissedKeys((prev) => {
                  const next = new Set(prev);
                  if (key) next.add(key);
                  if (alert.id) next.add(String(alert.id));
                  return next;
                });
                onAck?.(alert);
              }}
            >
              Entendido
            </button>
          </div>
        );
      })}
    </div>
  );
}

const EMPTY_FORM = {
  title: '',
  body: '',
  severity: 'warning',
  audience: 'all',
  requiresAck: false,
};

export default function AlertsPanel({
  alerts = [],
  publishAlert,
  deactivateAlert,
  onSendMessage,
  senderName = 'Administración Jockey Club',
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [notifyDm, setNotifyDm] = useState(true);
  const [notifyMail, setNotifyMail] = useState(true);
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const active = alerts.filter((a) => isAlertVisible(a));

  const handlePublish = async (e) => {
    e.preventDefault();
    setError('');
    setMsg('');
    if (!form.title.trim() || !form.body.trim()) {
      setError('Completá título y mensaje.');
      return;
    }

    setBusy(true);
    try {
      const images = [];
      for (const photo of photos) {
        images.push(await uploadAlertImage(photo.file));
      }
      const saved = await publishAlert({
        ...form,
        metadata: { images },
      });
      const bits = { dm: false, mail: false, mailed: null };

      if (notifyDm && typeof onSendMessage === 'function') {
        const dm = buildAlertDmMessage(saved || form, { senderName });
        if (dm) {
          await onSendMessage(dm);
          bits.dm = alertDmRecipient(form.audience);
        }
      }

      if (notifyMail && isSupabaseConfigured && alertMailNeedsPadronPreview(form.audience)) {
        bits.mailPadron = true;
      } else if (notifyMail && isSupabaseConfigured) {
        try {
          const mailed = await repos.sendClubMailCampaign({
            subject: String(form.title || '').trim(),
            text: String(form.body || '').trim(),
            audience: alertMailAudience(form.audience),
          });
          bits.mail = true;
          bits.mailed = mailed;
        } catch (err) {
          const detail = err?.message || 'el mail no salió';
          if (bits.dm) {
            setForm(EMPTY_FORM);
            setPhotos((prev) => {
              prev.forEach((photo) => URL.revokeObjectURL(photo.preview));
              return [];
            });
            setMsg(`Alerta y MD publicados. El mail no: ${detail}`);
            return;
          }
          throw err;
        }
      } else if (notifyMail && !isSupabaseConfigured) {
        setMsg(alertDeliverySummary({ ...bits, dm: bits.dm }) + ' Mail solo en la nube.');
        setForm(EMPTY_FORM);
        setPhotos((prev) => {
          prev.forEach((photo) => URL.revokeObjectURL(photo.preview));
          return [];
        });
        return;
      }

      setForm(EMPTY_FORM);
      setPhotos((prev) => {
        prev.forEach((photo) => URL.revokeObjectURL(photo.preview));
        return [];
      });
      setMsg(alertDeliverySummary(bits));
    } catch (err) {
      setError(err?.message || 'No se pudo publicar la alerta.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fade-in alerts-center" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <h4 className="serif-font" style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <BellRing size={18} /> Centro de Alertas
        </h4>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Alertas operativas, institucionales y automáticas (Zonda). Al publicar, también salen por MD y mail.
        </p>
      </div>

      <form
        onSubmit={(e) => { void handlePublish(e); }}
        style={{ border: '1px solid var(--border-glass)', borderRadius: 12, padding: '1rem', display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
      >
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">Título</label>
          <input
            className="form-input"
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            disabled={busy}
          />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">Mensaje</label>
          <textarea
            className="form-input"
            required
            rows={3}
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            disabled={busy}
          />
          <label className="alerts-photo-add">
            <ImagePlus size={14} aria-hidden="true" />
            Adjuntar fotos
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={busy || photos.length >= MAX_ALERT_PHOTOS}
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                e.target.value = '';
                setError('');
                setPhotos((prev) => {
                  const room = MAX_ALERT_PHOTOS - prev.length;
                  const next = files.slice(0, room).flatMap((file) => {
                    if (file.type && !file.type.startsWith('image/')) return [];
                    if (file.size > 10 * 1024 * 1024) return [];
                    return [{ file, preview: URL.createObjectURL(file), name: file.name }];
                  });
                  if (next.length < files.length) {
                    setError('Solo imágenes de hasta 10 MB, como máximo 6.');
                  }
                  return [...prev, ...next];
                });
              }}
            />
          </label>
          {photos.length ? (
            <div className="alerts-photos">
              {photos.map((photo) => (
                <figure key={photo.preview}>
                  <img src={photo.preview} alt={photo.name || 'Foto adjunta'} />
                  <button
                    type="button"
                    aria-label={`Quitar ${photo.name || 'foto'}`}
                    onClick={() => {
                      URL.revokeObjectURL(photo.preview);
                      setPhotos((prev) => prev.filter((item) => item.preview !== photo.preview));
                    }}
                    disabled={busy}
                  >
                    <X size={12} />
                  </button>
                </figure>
              ))}
            </div>
          ) : null}
        </div>
        <div>
          <label className="form-label">Severidad</label>
          <select
            className="form-input"
            value={form.severity}
            onChange={(e) => setForm({ ...form, severity: e.target.value })}
            disabled={busy}
          >
            <option value="info">Informativa</option>
            <option value="warning">Advertencia</option>
            <option value="critical">Crítica</option>
          </select>
        </div>
        <div>
          <label className="form-label">Audiencia</label>
          <select
            className="form-input"
            value={form.audience}
            onChange={(e) => setForm({ ...form, audience: e.target.value })}
            disabled={busy}
          >
            <option value="all">Todos</option>
            <option value="members">Socios</option>
            <option value="staff">Personal</option>
            <option value="admin">Administración</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'end' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
            <input
              type="checkbox"
              checked={form.requiresAck}
              onChange={(e) => setForm({ ...form, requiresAck: e.target.checked })}
              disabled={busy}
            />
            Requiere acuse
          </label>
        </div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', gap: '0.65rem 1rem' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
            <input
              type="checkbox"
              checked={notifyDm}
              onChange={(e) => setNotifyDm(e.target.checked)}
              disabled={busy}
            />
            <MessageSquare size={14} aria-hidden="true" />
            Enviar MD
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
            <input
              type="checkbox"
              checked={notifyMail}
              onChange={(e) => setNotifyMail(e.target.checked)}
              disabled={busy}
            />
            <Mail size={14} aria-hidden="true" />
            Enviar mail
          </label>
        </div>
        <div>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            disabled={busy}
          >
            <Megaphone size={14} />
            {busy ? 'Publicando…' : 'Publicar alerta'}
          </button>
        </div>
      </form>

      {msg ? <p style={{ color: 'var(--emerald-accent)' }} role="status">{msg}</p> : null}
      {error ? <p style={{ color: 'var(--danger-accent, #ef4444)' }} role="alert">{error}</p> : null}

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
                  <AlertPhotos images={alertImages(alert)} />
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
