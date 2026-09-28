import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X } from 'lucide-react';
import { publicJoinUrl } from '../../domain/members/selfService';
import {
  JOIN_PLAQUE_PRINT_SIZES,
  JOIN_PLAQUE_SOCIAL_SIZES,
  downloadJoinPlaque,
} from '../../domain/members/exportJoinPlaque';

export function JoinClubPlaqueSheet({ url }) {
  const href = url || publicJoinUrl();
  return (
    <article className="join-plaque-sheet" aria-label="Placa para asociarse">
      <header className="join-plaque-top">
        <img src="/logo-jockey-club.png" alt="" className="join-plaque-mark" />
        <p className="join-plaque-kicker">Jockey Club San Juan</p>
      </header>
      <div className="join-plaque-copy">
        <h2>Asociate</h2>
        <p>Escaneá el código y pedí el alta desde el celular.</p>
      </div>
      <div className="join-plaque-qr">
        <QRCodeSVG
          value={href}
          size={220}
          level="M"
          includeMargin={false}
          bgColor="#fffaf4"
          fgColor="#0c1a14"
        />
      </div>
      <p className="join-plaque-url">{href.replace(/^https?:\/\//, '')}</p>
    </article>
  );
}

export default function JoinClubPlaque({ open = false, onClose, url }) {
  const href = url || publicJoinUrl();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const save = async (size, format) => {
    const key = `${size}-${format}`;
    setBusy(key);
    setError('');
    try {
      await downloadJoinPlaque(href, { size, format });
    } catch {
      setError('No se pudo generar el archivo. Probá de nuevo.');
    } finally {
      setBusy('');
    }
  };

  if (!open) return null;

  return (
    <div
      className="join-plaque-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Placa pública para asociarse"
      onClick={onClose}
    >
      <div className="join-plaque-stage" onClick={(event) => event.stopPropagation()}>
        <div className="join-plaque-frame">
          <button type="button" className="join-plaque-close" onClick={onClose} aria-label="Cerrar">
            <X size={18} strokeWidth={2.4} aria-hidden="true" />
          </button>
          <JoinClubPlaqueSheet url={href} />
        </div>
        <aside className="join-plaque-exports" aria-label="Descargar placa">
          <section>
            <p className="join-plaque-exports-title">Imprimir</p>
            <ul>
              {JOIN_PLAQUE_PRINT_SIZES.map((size) => (
                <li key={size.id}>
                  <span>
                    <strong>{size.label}</strong>
                    <em>{size.hint}</em>
                  </span>
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    aria-busy={busy === `${size.id}-pdf`}
                    onClick={() => save(size.id, 'pdf')}
                  >
                    {busy === `${size.id}-pdf` ? '…' : 'PDF'}
                  </button>
                  <button
                    type="button"
                    className="is-ghost"
                    disabled={Boolean(busy)}
                    aria-busy={busy === `${size.id}-jpg`}
                    onClick={() => save(size.id, 'jpg')}
                  >
                    {busy === `${size.id}-jpg` ? '…' : 'JPG'}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <p className="join-plaque-exports-title">Redes</p>
            <ul>
              {JOIN_PLAQUE_SOCIAL_SIZES.map((size) => (
                <li key={size.id}>
                  <span>
                    <strong>{size.label}</strong>
                    <em>{size.hint}</em>
                  </span>
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    aria-busy={busy === `${size.id}-png`}
                    onClick={() => save(size.id, 'png')}
                  >
                    {busy === `${size.id}-png` ? '…' : 'PNG'}
                  </button>
                  <button
                    type="button"
                    className="is-ghost"
                    disabled={Boolean(busy)}
                    aria-busy={busy === `${size.id}-jpg`}
                    onClick={() => save(size.id, 'jpg')}
                  >
                    {busy === `${size.id}-jpg` ? '…' : 'JPG'}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          {error ? <p className="join-plaque-exports-error">{error}</p> : null}
        </aside>
      </div>
    </div>
  );
}
