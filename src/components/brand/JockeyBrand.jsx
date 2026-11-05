import { APP_NAME } from '../../domain/system/appBrand';
import './brand.css';

function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

/** Nombre de la app. El tamaño lo da el `font-size` del contenedor. */
export function JockeyWordmark({ variant = 'inline', className = '' }) {
  return (
    <span
      className={cx('jc-wordmark', variant === 'stacked' && 'jc-wordmark--stacked', className)}
      role="img"
      aria-label={APP_NAME}
    >
      <span className="jc-wordmark__jockey">Jockey</span>
      <span className="jc-wordmark__connect">
        {variant === 'stacked'
          ? Array.from('Connect').map((letter, i) => <span key={i}>{letter}</span>)
          : 'Connect'}
      </span>
    </span>
  );
}

/** Cintillo de rombos de casaca. `running` lo anima (pantallas de carga). */
export function SilksBand({ height = 7, running = false, className = '' }) {
  return (
    <span
      aria-hidden="true"
      className={cx('jc-silks', running && 'jc-silks--run', className)}
      style={{ '--jc-silks-h': `${height}px` }}
    />
  );
}

/** Pantalla de carga con el nombre de la app. */
export function BrandSplash({ message = 'Cargando…', detail, page = false, children }) {
  return (
    <div className={cx('jc-splash', page && 'jc-splash--page')} role="status" aria-live="polite">
      <span style={{ fontSize: '1.9rem' }}>
        <JockeyWordmark variant="stacked" />
      </span>
      <SilksBand height={6} running />
      <p className="jc-splash__msg">{message}</p>
      {detail ? <p className="jc-splash__detail">{detail}</p> : null}
      {children}
    </div>
  );
}
